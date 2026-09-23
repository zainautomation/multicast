import { z } from "zod";
import { body, rateLimit, route } from "@/lib/api";
import { db } from "@/lib/db";
import { regenerateImage, rerenderImage } from "@/lib/generation/run";
import { loadDraftDTO, ownedDraft } from "@/lib/drafts";
import { HttpError } from "@/lib/errors";
import { connectedTypes } from "@/lib/integrations/store";

const Req = z.object({
  imageId: z.string().optional(),
  sizeKey: z.string().regex(/^\d{2,4}x\d{2,4}$/).optional(),
  /** true = new size from the stored spec (no Claude call); false = fresh on-image text. */
  rerender: z.boolean().default(false),
  generator: z.enum(["builtin", "canva", "figma", "higgsfield", "custom"]).optional(),
});

export const POST = route<{ id: string }>(async (req, ctx, { id }) => {
  rateLimit(`gen:${ctx.workspaceId}`, 30, 60_000);
  const r = await body(req, Req);
  const d = await ownedDraft(ctx.workspaceId, id);
  if (["scheduled", "published"].includes(d.status)) throw new HttpError(400, "Unschedule this post before changing its image.");
  if (r.generator && r.generator !== "builtin" && !(await connectedTypes(ctx.workspaceId)).has(r.generator)) throw new HttpError(400, "Connect that tool first");
  if (r.rerender && r.imageId && r.sizeKey) return { draft: await rerenderImage(ctx.workspaceId, id, r.imageId, r.sizeKey) };
  return { draft: await regenerateImage(ctx.workspaceId, id, { imageId: r.imageId, sizeKey: r.sizeKey, generator: r.generator }) };
});

/** Remove one image from the draft. */
export const DELETE = route<{ id: string }>(async (req, ctx, { id }) => {
  const imageId = req.nextUrl.searchParams.get("imageId");
  const d = await ownedDraft(ctx.workspaceId, id);
  if (["scheduled", "published"].includes(d.status)) throw new HttpError(400, "Unschedule this post before changing its image.");
  if (!imageId || !d.images.some((i) => i.id === imageId)) throw new HttpError(404, "Image not found");
  await db.imageAsset.delete({ where: { id: imageId } });
  return { draft: await loadDraftDTO(id) };
});

// Generation, rendering and publishing can take minutes (Vercel function limit).
export const maxDuration = 300;
