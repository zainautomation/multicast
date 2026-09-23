import { rateLimit, route } from "@/lib/api";
import { regenerateText } from "@/lib/generation/run";
import { ownedDraft } from "@/lib/drafts";
import { HttpError } from "@/lib/errors";

/** Regenerate this platform's post text only (images are kept). */
export const POST = route<{ id: string }>(async (_req, ctx, { id }) => {
  rateLimit(`gen:${ctx.workspaceId}`, 30, 60_000);
  const d = await ownedDraft(ctx.workspaceId, id);
  if (!d.hasPost) throw new HttpError(400, "This card is image only; use Regenerate image.");
  if (["scheduled", "published"].includes(d.status)) throw new HttpError(400, "Unschedule this post before regenerating it.");
  return { draft: await regenerateText(ctx.workspaceId, id) };
});
