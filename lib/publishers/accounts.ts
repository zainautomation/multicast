import type { PublishingAccount } from "@prisma/client";
import { db } from "@/lib/db";
import { decryptJson, encryptJson } from "@/lib/crypto";
import type { PlatformId } from "@/lib/platforms";

export type Tokens = { accessToken: string; refreshToken?: string; tokenType?: string; scope?: string };

export type Account = { row: PublishingAccount; tokens: Tokens; meta: Record<string, unknown> };

export class ReconnectError extends Error {
  constructor(public platform: string, message: string) {
    super(message);
  }
}

export async function getAccount(workspaceId: string, platform: PlatformId): Promise<Account | null> {
  const row = await db.publishingAccount.findUnique({ where: { workspaceId_platform: { workspaceId, platform } } });
  if (!row) return null;
  return { row, tokens: decryptJson<Tokens>(row.tokensEnc), meta: (row.meta ?? {}) as Record<string, unknown> };
}

export async function saveAccount(
  workspaceId: string,
  platform: PlatformId,
  a: { tokens: Tokens; displayName: string; expiresAt?: Date | null; meta?: Record<string, unknown> },
) {
  const data = {
    tokensEnc: encryptJson(a.tokens),
    displayName: a.displayName,
    expiresAt: a.expiresAt ?? null,
    status: "connected",
    meta: (a.meta ?? {}) as object,
  };
  return db.publishingAccount.upsert({
    where: { workspaceId_platform: { workspaceId, platform } },
    create: { workspaceId, platform, ...data },
    update: data,
  });
}

export async function markNeedsReconnect(workspaceId: string, platform: PlatformId, reason: string) {
  await db.publishingAccount.updateMany({ where: { workspaceId, platform }, data: { status: "needs_reconnect" } });
  const { notify } = await import("@/lib/notify");
  await notify(workspaceId, "failed", { title: `${platform} needs reconnecting`, error: reason }).catch(() => undefined);
}

async function refreshReddit(workspaceId: string, a: Account): Promise<string> {
  if (!a.tokens.refreshToken) throw new ReconnectError("reddit", "Reddit session expired; reconnect Reddit");
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": process.env.REDDIT_USER_AGENT || "web:multicast:v0.1",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: a.tokens.refreshToken }),
  });
  const t = await res.json().catch(() => ({}));
  if (!res.ok || !t.access_token) throw new ReconnectError("reddit", `Reddit token refresh failed (${t.error ?? res.status}); reconnect Reddit`);
  await db.publishingAccount.update({
    where: { id: a.row.id },
    data: { tokensEnc: encryptJson({ ...a.tokens, accessToken: t.access_token }), expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000), status: "connected" },
  });
  return t.access_token;
}

/**
 * A valid access token for a platform, refreshed if needed (spec §10: refresh before each
 * publish). Expired/revoked tokens mark the account "Needs reconnect" and alert.
 */
export async function accountToken(workspaceId: string, platform: PlatformId): Promise<string | null> {
  const a = await getAccount(workspaceId, platform);
  if (!a) return null;
  try {
    if (a.row.status === "needs_reconnect") throw new ReconnectError(platform, `${a.row.displayName} needs reconnecting`);
    const expSoon = a.row.expiresAt && a.row.expiresAt.getTime() < Date.now() + 60_000;
    if (!expSoon) return a.tokens.accessToken;
    if (platform === "reddit") return await refreshReddit(workspaceId, a);
    // LinkedIn member tokens last ~60 days and refresh tokens are partner-only; Meta page
    // tokens derived from a long-lived user token do not expire.
    throw new ReconnectError(platform, "Access token expired; reconnect the account");
  } catch (e) {
    if (e instanceof ReconnectError && a.row.status !== "needs_reconnect") await markNeedsReconnect(workspaceId, platform, e.message);
    throw e;
  }
}
