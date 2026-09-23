import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { decryptJson } from "@/lib/crypto";
import { verifySlackSignature, draftBlocks, postToSlack } from "@/lib/notify/slack";
import { canAuto, publishDraft } from "@/lib/publishers";
import { regenerateText } from "@/lib/generation/run";
import { markPosted, retryItem } from "@/lib/schedule/service";
import { revalidate, packWarnings } from "@/lib/drafts";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";
import { errMsg } from "@/lib/util";

// Slack interactivity (bot-token mode). Public endpoint: every request must carry a valid
// Slack signature. Slack needs a reply within 3 s, so work runs after the ack and the result
// goes back through response_url.

type Payload = {
  type: string;
  response_url?: string;
  actions?: { action_id: string; value?: string }[];
  user?: { name?: string };
};

async function workspaceForSignature(raw: string, ts: string | null, sig: string | null) {
  const rows = await db.integration.findMany({ where: { type: "slack", status: "connected" } });
  for (const r of rows) {
    const creds = decryptJson<Record<string, string>>(r.credentialsEnc);
    if (creds.signingSecret && verifySlackSignature(creds.signingSecret, ts, raw, sig)) return r.workspaceId;
  }
  return null;
}

async function reply(url: string | undefined, text: string) {
  if (!url) return;
  await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ response_type: "in_channel", replace_original: false, text }) }).catch(() => undefined);
}

async function handle(workspaceId: string, p: Payload) {
  const a = p.actions?.[0];
  if (!a?.value) return;
  const who = p.user?.name ? ` by ${p.user.name}` : "";
  try {
    switch (a.action_id) {
      case "approve_post": {
        const d = await db.draft.findFirst({ where: { id: a.value, workspaceId } });
        if (!d) return reply(p.response_url, "That draft no longer exists.");
        const name = PLATFORMS[d.platform as PlatformId].name;
        if (["scheduled", "published"].includes(d.status)) return reply(p.response_url, `${name} draft is already ${d.status}.`);
        const v = await revalidate(workspaceId, d.id);
        if (v.errors.length) return reply(p.response_url, `${name} draft needs edits before it can post: ${v.errors.join(" ")}`);
        await db.draft.update({ where: { id: d.id }, data: { status: "approved", warnings: packWarnings(v.errors, v.notes) } });
        if (!(await canAuto(workspaceId, d.platform as PlatformId))) return reply(p.response_url, `${name} draft approved${who}. It can't auto-post; schedule it with a reminder in Multicast.`);
        const r = await publishDraft(workspaceId, d.id);
        return reply(p.response_url, `${name} post is live${who}: ${r.url}`);
      }
      case "regenerate": {
        const dto = await regenerateText(workspaceId, a.value);
        const d = await db.draft.findUniqueOrThrow({ where: { id: dto.id }, include: { images: true } });
        await postToSlack(workspaceId, "Regenerated draft", draftBlocks(d, true));
        return;
      }
      case "mark_posted":
        await markPosted(workspaceId, a.value, null);
        return reply(p.response_url, `Marked as posted${who}. Add the live link in Multicast if you want it on the calendar.`);
      case "retry_publish":
        await retryItem(workspaceId, a.value);
        return reply(p.response_url, `Retrying now${who}.`);
    }
  } catch (e) {
    await reply(p.response_url, `That didn't work: ${errMsg(e)}`);
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const workspaceId = await workspaceForSignature(raw, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature"));
  if (!workspaceId) return new Response("invalid signature", { status: 401 });
  const payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "{}") as Payload;
  if (payload.type === "block_actions") void handle(workspaceId, payload);
  return new Response("", { status: 200 });
}
