import { z } from "zod";
import { body, route } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { scheduleDraft, unschedule } from "@/lib/schedule/service";

/** Reschedule (drag on the calendar) or switch Auto-publish / Remind me. */
export const PATCH = route<{ id: string }>(async (req, ctx, { id }) => {
  const p = await body(req, z.object({ runAtUtc: z.string().datetime().optional(), mode: z.enum(["auto", "remind"]).optional() }));
  const item = await db.scheduleItem.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!item) throw new HttpError(404, "Not found");
  if (!["pending", "failed"].includes(item.status)) throw new HttpError(400, "Only upcoming posts can be moved");
  const s = await scheduleDraft(ctx.workspaceId, item.draftId, p.runAtUtc ? new Date(p.runAtUtc) : item.runAtUtc, (p.mode ?? item.mode) as "auto" | "remind");
  return { item: { id: s.id, runAtUtc: s.runAtUtc.toISOString(), mode: s.mode, status: s.status } };
});

export const DELETE = route<{ id: string }>(async (_req, ctx, { id }) => {
  await unschedule(ctx.workspaceId, id);
  return { ok: true };
});
