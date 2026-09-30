import { route } from "@/lib/api";
import { attachMedia } from "@/lib/drafts";
import { HttpError } from "@/lib/errors";

/** "Upload my own": attach an image or video to this platform's draft. */
export const POST = route<{ id: string }>(async (req, ctx, { id }) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file");
  return { draft: await attachMedia(ctx.workspaceId, id, file, form.get("replace") === "true") };
});
