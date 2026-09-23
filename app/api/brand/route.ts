import { body, route } from "@/lib/api";
import { db } from "@/lib/db";
import { BrandPatch } from "@/lib/brand-schema";

export const PUT = route(async (req, ctx) => {
  const p = await body(req, BrandPatch);
  if (p.backgrounds && !p.backgrounds.some((c) => c.isDefault)) p.backgrounds[0].isDefault = true;
  await db.brandKit.update({ where: { workspaceId: ctx.workspaceId }, data: p });
  return { ok: true };
});
