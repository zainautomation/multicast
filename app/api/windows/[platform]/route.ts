import { z } from "zod";
import { body, route } from "@/lib/api";
import { db } from "@/lib/db";
import { isPlatformId } from "@/lib/platforms";
import { HttpError } from "@/lib/errors";

export const PUT = route<{ platform: string }>(async (req, ctx, { platform }) => {
  if (!isPlatformId(platform)) throw new HttpError(404, "Unknown platform");
  const w = await body(
    req,
    z
      .object({ days: z.array(z.number().int().min(0).max(6)).max(7), startMin: z.number().int().min(0).max(1439), endMin: z.number().int().min(1).max(1440) })
      .refine((x) => x.endMin > x.startMin, "The window must end after it starts"),
  );
  const days = [...new Set(w.days)].sort();
  await db.postingWindow.upsert({
    where: { workspaceId_platform: { workspaceId: ctx.workspaceId, platform } },
    create: { workspaceId: ctx.workspaceId, platform, days, startMin: w.startMin, endMin: w.endMin },
    update: { days, startMin: w.startMin, endMin: w.endMin },
  });
  return { ok: true };
});
