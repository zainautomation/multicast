import { z } from "zod";
import { body, route } from "@/lib/api";
import { db } from "@/lib/db";
import { suggestionsFor } from "@/lib/schedule/service";

/** Suggested slots for the given drafts, respecting windows, the 3 h gap and each other. */
export const POST = route(async (req, ctx) => {
  const { draftIds } = await body(req, z.object({ draftIds: z.array(z.string()).max(50) }));
  const drafts = await db.draft.findMany({ where: { id: { in: draftIds }, workspaceId: ctx.workspaceId }, select: { id: true, platform: true } });
  const order = new Map(draftIds.map((id, i) => [id, i]));
  drafts.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const s = await suggestionsFor(ctx.workspaceId, drafts);
  return { suggestions: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v?.toISOString() ?? null])) };
});
