import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { loadDraftDTO, ownedDraft } from "@/lib/drafts";
import { HttpError } from "@/lib/errors";
import { MEDIA_TYPES, storeUpload } from "@/lib/uploads";

/** "Upload my own": attach an image or video to this platform's draft. */
export const POST = route<{ id: string }>(async (req, ctx, { id }) => {
  const d = await ownedDraft(ctx.workspaceId, id);
  if (["scheduled", "published"].includes(d.status)) throw new HttpError(400, "Unschedule this post before changing its media.");
  const form = await req.formData();
  const file = form.get("file");
  const replace = form.get("replace") === "true";
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file");
  const isVideo = file.type.startsWith("video/");
  const s = await storeUpload(file, isVideo ? "video" : "image", { allow: MEDIA_TYPES, prefix: `uploads/${d.platform}`, toJpeg: d.platform === "ig" });
  if (replace) await db.imageAsset.deleteMany({ where: { draftId: id } });
  await db.imageAsset.create({
    data: {
      draftId: id,
      platform: d.platform,
      sizeKey: `${s.width ?? 0}x${s.height ?? 0}`,
      width: s.width ?? 0,
      height: s.height ?? 0,
      generator: "upload",
      spec: {},
      urls: [s.url],
      mimeType: s.mimeType,
      note: isVideo ? "Your video" : "Your upload",
      status: "ready",
    },
  });
  // Media is attached, so Instagram's "needs media" note no longer applies; approval restarts.
  await db.draft.update({
    where: { id },
    data: { warnings: d.warnings.filter((w) => !w.includes("Instagram needs an image")),
      lastError: null,
      ...(d.status === "failed" && !d.hasPost ? { status: "ready" } : {}), ...(d.status === "approved" ? { status: "ready" } : {}) },
  });
  return { draft: await loadDraftDTO(id) };
});
