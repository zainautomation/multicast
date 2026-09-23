import { z } from "zod";
import { body, route } from "@/lib/api";
import { db } from "@/lib/db";
import { loadDraftDTO, ownedDraft, packWarnings, revalidate } from "@/lib/drafts";
import { HttpError } from "@/lib/errors";

/** Approve (or un-approve). Blocked while the draft breaks platform rules (spec 9.4). */
export const POST = route<{ id: string }>(async (req, ctx, { id }) => {
  const { approved } = await body(req, z.object({ approved: z.boolean() }));
  const d = await ownedDraft(ctx.workspaceId, id);
  if (d.status === "generating") throw new HttpError(409, "Still generating");
  if (["scheduled", "published"].includes(d.status)) throw new HttpError(400, d.status === "scheduled" ? "Unschedule this post first." : "This post is already live.");
  const v = await revalidate(ctx.workspaceId, id);
  if (approved) {
    if (v.errors.length) {
      await db.draft.update({ where: { id }, data: { warnings: packWarnings(v.errors, v.notes), status: "warning" } });
      throw new HttpError(400, `Edit before approving: ${v.errors.join(" ")}`);
    }
    if (!d.hasPost && !d.images.some((i) => i.status === "ready" || i.status === "approved")) throw new HttpError(400, "The image isn't ready yet");
  }
  await db.draft.update({ where: { id }, data: { status: approved ? "approved" : v.errors.length ? "warning" : "ready", warnings: packWarnings(v.errors, v.notes) } });
  if (d.images.length) await db.imageAsset.updateMany({ where: { draftId: id, status: { in: ["ready", "approved"] } }, data: { status: approved ? "approved" : "ready" } });
  return { draft: await loadDraftDTO(id) };
});
