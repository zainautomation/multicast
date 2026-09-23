import type { Draft, ImageAsset, ScheduleItem } from "@prisma/client";
import { db } from "@/lib/db";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";
import { draftBlocks, esc, postToSlack, slackConfig, type SlackBlock } from "@/lib/notify/slack";
import { button, emailConfigured, emailLayout, escHtml, sendEmail } from "@/lib/notify/email";
import { sendPush } from "@/lib/notify/push";
import { errMsg } from "@/lib/util";

export type EventKind = "ready" | "published" | "failed" | "visual" | "weekly" | "reminder";

type DraftWithImages = Draft & { images?: ImageAsset[] };

export type Payloads = {
  ready: { briefId: string; drafts: DraftWithImages[] };
  published: { draft: Draft; url: string };
  failed: { draft?: Draft; item?: ScheduleItem; title?: string; error: string };
  visual: { draft: Draft };
  weekly: { from: Date; to: Date; published: Draft[]; upcoming: (ScheduleItem & { draft: Draft })[] };
  reminder: { item: ScheduleItem; draft: DraftWithImages & { brief?: { subreddit: string | null } } };
};

const APP = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const pname = (p: string) => PLATFORMS[p as PlatformId]?.name ?? p;

async function ownerEmail(workspaceId: string) {
  if (process.env.EMAIL_TO) return process.env.EMAIL_TO;
  const u = await db.user.findFirst({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
  return u?.email ?? null;
}

async function safe(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    console.warn(`[notify:${label}]`, errMsg(e));
  }
}

/**
 * Fan an event out to the channels the owner enabled. Slack gets the events ticked on the
 * Integrations screen; reminders go to the channels chosen under Schedule → Reminders;
 * go-live confirmations and failure alerts go to every enabled channel.
 */
export async function notify<K extends EventKind>(workspaceId: string, kind: K, payload: Payloads[K]) {
  const pref = await db.notificationPref.findUnique({ where: { workspaceId } });
  if (!pref) return;
  const slack = await slackConfig(workspaceId);
  const slackWants = !!slack && (kind === "reminder" ? pref.slack : pref.events.includes(kind));
  const emailWants = emailConfigured() && pref.email && ["reminder", "published", "failed", "weekly"].includes(kind);
  const pushWants = pref.browser && ["reminder", "published", "failed"].includes(kind);
  const interactive = slack?.method === "bot";

  switch (kind) {
    case "ready": {
      const p = payload as Payloads["ready"];
      if (slackWants) {
        const names = p.drafts.map((d) => PLATFORMS[d.platform as PlatformId]?.short ?? d.platform).join(", ");
        const blocks: SlackBlock[] = [{ type: "section", text: { type: "mrkdwn", text: `*${p.drafts.length} draft${p.drafts.length === 1 ? " is" : "s are"} ready for review:* ${names}.` } }];
        for (const d of p.drafts) blocks.push(...draftBlocks(d, interactive));
        if (!interactive) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `<${APP()}/compose?brief=${p.briefId}|Open in Multicast to approve>` }] });
        await safe("slack", () => postToSlack(workspaceId, `${p.drafts.length} drafts are ready for review`, blocks));
      }
      const needVisual = p.drafts.filter((d) => d.platform === "ig" && d.hasPost && !d.images?.length);
      for (const d of needVisual) await notify(workspaceId, "visual", { draft: d });
      return;
    }
    case "visual": {
      const p = payload as Payloads["visual"];
      if (slackWants)
        await safe("slack", () =>
          postToSlack(workspaceId, `${pname(p.draft.platform)} draft needs a visual`, [
            { type: "section", text: { type: "mrkdwn", text: `*${pname(p.draft.platform)} draft needs a visual* before it can publish. <${APP()}/compose?brief=${p.draft.briefId}|Add an image>` } },
          ]),
        );
      return;
    }
    case "published": {
      const p = payload as Payloads["published"];
      const title = `${pname(p.draft.platform)} post is live`;
      if (slackWants) await safe("slack", () => postToSlack(workspaceId, title, [{ type: "section", text: { type: "mrkdwn", text: `*${title}* · <${p.url}|View post>` } }]));
      if (emailWants) {
        const to = await ownerEmail(workspaceId);
        if (to) await safe("email", () => sendEmail(to, title, emailLayout(title, `<p>Your post went out.</p>${button(p.url, "View post", true)}`), `${title}: ${p.url}`));
      }
      if (pushWants) await safe("push", () => sendPush(workspaceId, { title, body: "Tap to view the live post.", url: p.url }));
      return;
    }
    case "failed": {
      const p = payload as Payloads["failed"];
      const title = p.title ?? `${p.draft ? pname(p.draft.platform) : "A"} post failed`;
      const retry = p.item ? `${APP()}/schedule?retry=${p.item.id}` : `${APP()}/compose${p.draft ? `?brief=${p.draft.briefId}` : ""}`;
      if (slackWants) {
        const blocks: SlackBlock[] = [{ type: "section", text: { type: "mrkdwn", text: `*${esc(title)}*\n${esc(p.error)}` } }];
        const els: SlackBlock[] = [];
        if (interactive && p.item) els.push({ type: "button", text: { type: "plain_text", text: "Retry" }, action_id: "retry_publish", value: p.item.id, style: "danger" });
        els.push({ type: "button", text: { type: "plain_text", text: "Open in Multicast" }, url: retry, action_id: "open" });
        blocks.push({ type: "actions", elements: els });
        await safe("slack", () => postToSlack(workspaceId, title, blocks));
      }
      if (emailWants) {
        const to = await ownerEmail(workspaceId);
        if (to) await safe("email", () => sendEmail(to, title, emailLayout(title, `<p style="color:#9B2C1F">${escHtml(p.error)}</p>${button(retry, "Retry", true)}`), `${title}\n${p.error}\nRetry: ${retry}`));
      }
      if (pushWants) await safe("push", () => sendPush(workspaceId, { title, body: p.error.slice(0, 180), url: retry }));
      return;
    }
    case "reminder": {
      const { item, draft } = payload as Payloads["reminder"];
      const spec = PLATFORMS[draft.platform as PlatformId];
      const when = item.runAtUtc.toISOString();
      const compose = spec.composeUrl({ subreddit: draft.brief?.subreddit });
      const markUrl = `${APP()}/schedule?posted=${item.id}`;
      const imgs = (draft.images ?? []).flatMap((i) => i.urls);
      const title = `Time to post on ${spec.name}`;
      if (slackWants) {
        const blocks: SlackBlock[] = [
          { type: "section", text: { type: "mrkdwn", text: `*${title}* · scheduled <!date^${Math.floor(item.runAtUtc.getTime() / 1000)}^{date_short_pretty} at {time}|${when}>` } },
          ...draftBlocks(draft, false).filter((b) => b.type !== "actions" && b.type !== "divider"),
        ];
        if (imgs.length) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: imgs.map((u, i) => `<${u}|Download image ${i + 1}>`).join(" · ") }] });
        const els: SlackBlock[] = [{ type: "button", style: "primary", text: { type: "plain_text", text: `Open ${spec.short}` }, url: compose, action_id: "open_compose" }];
        els.push(interactive ? { type: "button", text: { type: "plain_text", text: "Mark as posted" }, action_id: "mark_posted", value: item.id } : { type: "button", text: { type: "plain_text", text: "Mark as posted" }, url: markUrl, action_id: "mark_link" });
        blocks.push({ type: "actions", elements: els });
        await safe("slack", () => postToSlack(workspaceId, title, blocks));
      }
      if (emailWants) {
        const to = await ownerEmail(workspaceId);
        const body = [draft.title ? `<p style="font-weight:600">${escHtml(draft.title)}</p>` : "", `<pre style="white-space:pre-wrap;font-family:inherit;font-size:14.5px;line-height:1.55;background:#FBFAF7;border:1px solid #EEEAE1;border-radius:10px;padding:14px">${escHtml(draft.body ?? "")}</pre>`];
        if (draft.firstComment) body.push(`<p><b>First comment:</b> ${escHtml(draft.firstComment)}</p>`);
        if (imgs.length) body.push(`<p>${imgs.map((u, i) => `<a href="${escHtml(u)}">Download image ${i + 1}</a>`).join(" · ")}</p>`);
        body.push(button(compose, `Open ${spec.short}`, true), button(markUrl, "Mark as posted"));
        const text = `${title}\n\n${draft.title ? draft.title + "\n\n" : ""}${draft.body ?? ""}\n\n${imgs.join("\n")}\n\nOpen: ${compose}\nMark as posted: ${markUrl}`;
        if (to) await safe("email", () => sendEmail(to, title, emailLayout(title, body.join("")), text));
      }
      if (pushWants) await safe("push", () => sendPush(workspaceId, { title, body: (draft.body ?? "").slice(0, 140), url: `${APP()}/schedule?open=${item.id}` }));
      return;
    }
    case "weekly": {
      const p = payload as Payloads["weekly"];
      const lines = [
        `*Weekly summary* · ${p.published.length} published, ${p.upcoming.length} coming up`,
        ...p.published.map((d) => `• ${pname(d.platform)}: ${d.externalUrl ? `<${d.externalUrl}|live post>` : "posted"}`),
        ...(p.upcoming.length ? ["*Next 7 days*", ...p.upcoming.map((u) => `• ${pname(u.platform)} · <!date^${Math.floor(u.runAtUtc.getTime() / 1000)}^{date_short} {time}|${u.runAtUtc.toISOString()}> · ${u.mode === "auto" ? "auto-publish" : "reminder"}`)] : []),
      ];
      if (slackWants) await safe("slack", () => postToSlack(workspaceId, "Weekly summary", [{ type: "section", text: { type: "mrkdwn", text: lines.join("\n").slice(0, 2900) } }]));
      return;
    }
  }
}
