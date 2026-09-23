import { createHmac, timingSafeEqual } from "node:crypto";
import type { Draft, ImageAsset } from "@prisma/client";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";
import { getIntegration } from "@/lib/integrations/store";

// Slack: bot token (chat:write + interactivity, full Block Kit with buttons) or incoming
// webhook (notifications only, one channel). Section text is capped at 3,000 chars.

export type SlackBlock = Record<string, unknown>;

const APP = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

function chunks(text: string, size = 2900): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [""];
}

/** Slack mrkdwn escaping for user content. */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function draftBlocks(d: Draft & { images?: ImageAsset[] }, interactive: boolean): SlackBlock[] {
  const p = PLATFORMS[d.platform as PlatformId];
  const blocks: SlackBlock[] = [{ type: "section", text: { type: "mrkdwn", text: `*${p.name} draft*${d.title ? `\n*${esc(d.title)}*` : ""}` } }];
  if (d.hasPost && d.body) for (const c of chunks(esc(d.body))) blocks.push({ type: "section", text: { type: "mrkdwn", text: c } });
  else blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "Image only · no post text for this platform" }] });
  if (d.firstComment) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `First comment: ${esc(d.firstComment)}` }] });
  const img = d.images?.find((i) => i.mimeType.startsWith("image/"))?.urls[0];
  if (img && /^https:\/\//.test(img)) blocks.push({ type: "image", image_url: img, alt_text: `${p.name} image` });
  const open = { type: "button", text: { type: "plain_text", text: "Open in Multicast" }, url: `${APP()}/compose?brief=${d.briefId}`, action_id: "open" };
  if (interactive) {
    const approve =
      p.publish.kind === "copy"
        ? null
        : { type: "button", style: "primary", text: { type: "plain_text", text: "Approve & post" }, action_id: "approve_post", value: d.id };
    blocks.push({
      type: "actions",
      elements: [approve, { type: "button", text: { type: "plain_text", text: "Regenerate" }, action_id: "regenerate", value: d.id }, open].filter(Boolean),
    });
  } else {
    blocks.push({ type: "actions", elements: [open] });
  }
  blocks.push({ type: "divider" });
  return blocks;
}

export async function slackConfig(workspaceId: string) {
  const it = await getIntegration(workspaceId, "slack");
  if (!it) return null;
  return {
    method: (it.meta.method as "bot" | "hook") ?? "bot",
    token: it.creds.botToken,
    webhookUrl: it.creds.webhookUrl,
    signingSecret: it.creds.signingSecret,
    channel: (it.meta.channel as string) || "#social-drafts",
  };
}

export async function postToSlack(workspaceId: string, text: string, blocks: SlackBlock[]): Promise<void> {
  const cfg = await slackConfig(workspaceId);
  if (!cfg) return;
  // Slack caps a message at 50 blocks.
  for (let i = 0; i < blocks.length; i += 48) {
    const part = blocks.slice(i, i + 48);
    await sendRaw(cfg, text, part);
  }
}

export async function sendRaw(cfg: NonNullable<Awaited<ReturnType<typeof slackConfig>>>, text: string, blocks: SlackBlock[]) {
  if (cfg.method === "hook") {
    const res = await fetch(cfg.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, blocks }) });
    if (!res.ok) throw new Error(`Slack webhook failed (${res.status}: ${await res.text()})`);
    return;
  }
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel: cfg.channel, text, blocks, unfurl_links: false }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`Slack error: ${body.error}`);
}

/** Verify a Slack request signature (v0 scheme, 5-minute replay window). */
export function verifySlackSignature(secret: string, timestamp: string | null, rawBody: string, signature: string | null): boolean {
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 * 5) return false;
  const mac = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  const a = Buffer.from(mac);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
