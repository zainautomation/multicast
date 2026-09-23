import { z } from "zod";
import { body, route } from "@/lib/api";
import { db } from "@/lib/db";
import { isValidTz } from "@/lib/schedule/time";

/** Store the owner's time zone (auto-detected from the browser by default). */
export const PUT = route(async (req, ctx) => {
  const { timezone } = await body(req, z.object({ timezone: z.string().max(64).refine(isValidTz, "Unknown time zone") }));
  await db.workspace.update({ where: { id: ctx.workspaceId }, data: { timezone } });
  return { ok: true };
});
