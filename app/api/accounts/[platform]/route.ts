import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { isPlatformId } from "@/lib/platforms";
import { HttpError } from "@/lib/errors";

export const DELETE = route<{ platform: string }>(async (_req, ctx, { platform }) => {
  // "meta" and "linkedin" disconnect both of their platforms.
  const group: Record<string, string[]> = { meta: ["fb", "ig"], linkedin: ["lip", "lic"] };
  const list = group[platform] ?? (isPlatformId(platform) ? [platform] : null);
  if (!list) throw new HttpError(404, "Unknown account");
  await db.publishingAccount.deleteMany({ where: { workspaceId: ctx.workspaceId, platform: { in: list } } });
  return { ok: true };
});
