import { rateLimit, route } from "@/lib/api";
import { loadDraftDTO, ownedDraft } from "@/lib/drafts";
import { startAvatarVideo } from "@/lib/integrations/heygen";
import { HttpError } from "@/lib/errors";

/** Turn the post into a HeyGen avatar video; renders in the background, the card polls. */
export const POST = route<{ id: string }>(async (_req, ctx, { id }) => {
  rateLimit(`video:${ctx.workspaceId}`, 5, 60_000);
  const d = await ownedDraft(ctx.workspaceId, id);
  if (!d.hasPost || !d.body) throw new HttpError(400, "Write the post first; the video script is based on it.");
  if (["scheduled", "published"].includes(d.status)) throw new HttpError(400, "Unschedule this post first.");
  await startAvatarVideo(ctx.workspaceId, id);
  return { draft: await loadDraftDTO(id) };
});
