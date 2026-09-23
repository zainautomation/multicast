import { route, rateLimit } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { postToSlack } from "@/lib/notify/slack";
import { getIntegration } from "@/lib/integrations/store";

/** "Send test message" for Slack. */
export const POST = route<{ type: string }>(async (_req, ctx, { type }) => {
  if (type !== "slack") throw new HttpError(404, "Not found");
  rateLimit(`slacktest:${ctx.workspaceId}`, 6, 60_000);
  if (!(await getIntegration(ctx.workspaceId, "slack"))) throw new HttpError(400, "Connect Slack first");
  await postToSlack(ctx.workspaceId, "Multicast test message", [
    { type: "section", text: { type: "mrkdwn", text: "*Multicast is connected.* Drafts, go-live confirmations and failure alerts will arrive here." } },
  ]);
  return { ok: true };
});
