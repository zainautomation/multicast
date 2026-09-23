import { z } from "zod";
import { body, route } from "@/lib/api";
import { db } from "@/lib/db";

const Patch = z.object({
  leadMinutes: z.union([z.literal(0), z.literal(15), z.literal(60), z.literal(-1)]).optional(),
  slack: z.boolean().optional(),
  email: z.boolean().optional(),
  browser: z.boolean().optional(),
  events: z.array(z.enum(["ready", "published", "failed", "visual", "weekly"])).optional(),
});

export const PUT = route(async (req, ctx) => {
  const p = await body(req, Patch);
  await db.notificationPref.update({ where: { workspaceId: ctx.workspaceId }, data: p });
  return { ok: true };
});
