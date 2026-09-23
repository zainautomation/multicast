import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { draftDTO } from "@/lib/dto";
import { HttpError } from "@/lib/errors";

export const GET = route<{ id: string }>(async (_req, ctx, { id }) => {
  const brief = await db.brief.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    include: { drafts: { include: { images: true, schedule: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!brief) throw new HttpError(404, "Brief not found");
  const { drafts, ...rest } = brief;
  return { brief: rest, drafts: drafts.map(draftDTO) };
});

export const DELETE = route<{ id: string }>(async (_req, ctx, { id }) => {
  const scheduled = await db.scheduleItem.count({ where: { draft: { briefId: id }, status: "pending" } });
  if (scheduled) throw new HttpError(400, "This brief has scheduled posts. Unschedule them first.");
  await db.brief.deleteMany({ where: { id, workspaceId: ctx.workspaceId } });
  return { ok: true };
});
