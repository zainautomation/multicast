import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { isPlatformId } from "@/lib/platforms";
import { HttpError } from "@/lib/errors";

// "meta" and "linkedin" disconnect both of their platforms.
const GROUP: Record<string, string[]> = { meta: ["fb", "ig"], linkedin: ["lip", "lic"] };

/**
 * Disconnect a platform, or with ?account=<id> just one of its accounts (e.g. a teammate's
 * LinkedIn profile). Removing the profile that linked the company page removes the page too,
 * since the page posts with that person's token.
 */
export const DELETE = route<{ platform: string }>(async (req, ctx, { platform }) => {
  const list = GROUP[platform] ?? (isPlatformId(platform) ? [platform] : null);
  if (!list) throw new HttpError(404, "Unknown account");

  const accountId = req.nextUrl.searchParams.get("account");
  if (!accountId) {
    await db.publishingAccount.deleteMany({ where: { workspaceId: ctx.workspaceId, platform: { in: list } } });
    return { ok: true };
  }

  const row = await db.publishingAccount.findFirst({ where: { id: accountId, workspaceId: ctx.workspaceId, platform: { in: list } } });
  if (!row) throw new HttpError(404, "Account not found");
  await db.publishingAccount.delete({ where: { id: row.id } });
  let removedPage = false;
  if (row.platform === "lip" && row.accountKey) {
    const page = await db.publishingAccount.findFirst({ where: { workspaceId: ctx.workspaceId, platform: "lic" } });
    if (page && (page.meta as { linkedBy?: string } | null)?.linkedBy === row.accountKey) {
      await db.publishingAccount.delete({ where: { id: page.id } });
      removedPage = true;
    }
  }
  return { ok: true, removedPage };
});
