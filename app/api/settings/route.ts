import { z } from "zod";
import { body, route } from "@/lib/api";
import { db } from "@/lib/db";
import { CHECKER_MODEL_OPTIONS, DRAFT_MODEL_OPTIONS } from "@/lib/models";

const Patch = z.object({
  draftModel: z.enum(DRAFT_MODEL_OPTIONS as [string, ...string[]]).optional(),
  checkerModel: z.enum(CHECKER_MODEL_OPTIONS as [string, ...string[]]).optional(),
  creativity: z.enum(["precise", "balanced", "creative"]).optional(),
  monthlyCapCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
});

export const PUT = route(async (req, ctx) => {
  const p = await body(req, Patch);
  await db.settings.update({ where: { workspaceId: ctx.workspaceId }, data: p });
  return { ok: true };
});
