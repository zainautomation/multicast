import type { PublishingAccount } from "@prisma/client";
import { db } from "@/lib/db";
import { decryptJson, encryptJson } from "@/lib/crypto";
import type { PlatformId } from "@/lib/platforms";

export type Tokens = { accessToken: string; refreshToken?: string; tokenType?: string; scope?: string; /** OAuth 1.0a (X) */ tokenSecret?: string };

export type Account = { row: PublishingAccount; tokens: Tokens; meta: Record<string, unknown> };

export class ReconnectError extends Error {
  constructor(public platform: string, message: string) {
    super(message);
  }
}

const toAccount = (row: PublishingAccount): Account => ({ row, tokens: decryptJson<Tokens>(row.tokensEnc), meta: (row.meta ?? {}) as Record<string, unknown> });

/**
 * The account to post as on a platform. With an id, that exact account (null if it was
 * disconnected, so a post never silently goes out as someone else); without one, the
 * platform's default account, which is the oldest one connected.
 */
export async function getAccount(workspaceId: string, platform: PlatformId, accountId?: string | null): Promise<Account | null> {
  const row = accountId
    ? await db.publishingAccount.findFirst({ where: { id: accountId, workspaceId, platform } })
    : await db.publishingAccount.findFirst({ where: { workspaceId, platform }, orderBy: { createdAt: "asc" } });
  return row ? toAccount(row) : null;
}

/** All accounts on a platform, default first. */
export async function listAccounts(workspaceId: string, platform: PlatformId) {
  return db.publishingAccount.findMany({ where: { workspaceId, platform }, orderBy: { createdAt: "asc" } });
}

/**
 * Create or update an account. `accountKey` identifies the person/page on platforms that
 * can hold several accounts (LinkedIn profiles); omit it for single-account platforms.
 */
export async function saveAccount(
  workspaceId: string,
  platform: PlatformId,
  a: { tokens: Tokens; displayName: string; expiresAt?: Date | null; meta?: Record<string, unknown>; accountKey?: string },
) {
  const accountKey = a.accountKey ?? "";
  const data = {
    tokensEnc: encryptJson(a.tokens),
    displayName: a.displayName,
    expiresAt: a.expiresAt ?? null,
    status: "connected",
    meta: (a.meta ?? {}) as object,
  };
  return db.publishingAccount.upsert({
    where: { workspaceId_platform_accountKey: { workspaceId, platform, accountKey } },
    create: { workspaceId, platform, accountKey, ...data },
    update: data,
  });
}

export async function markNeedsReconnect(a: Account, reason: string) {
  await db.publishingAccount.update({ where: { id: a.row.id }, data: { status: "needs_reconnect" } });
  const { notify } = await import("@/lib/notify");
  await notify(a.row.workspaceId, "failed", { title: `${a.row.platform} (${a.row.displayName}) needs reconnecting`, error: reason }).catch(() => undefined);
}

async function refreshReddit(a: Account): Promise<string> {
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
 * A valid access token for an account, refreshed if needed (spec §10: refresh before each
 * publish). Expired/revoked tokens mark the account "Needs reconnect" and alert.
 */
export async function tokenFor(a: Account): Promise<string> {
  const platform = a.row.platform as PlatformId;
  try {
    if (a.row.status === "needs_reconnect") throw new ReconnectError(platform, `${a.row.displayName} needs reconnecting`);
    const expSoon = a.row.expiresAt && a.row.expiresAt.getTime() < Date.now() + 60_000;
    if (!expSoon) return a.tokens.accessToken;
    if (platform === "reddit") return await refreshReddit(a);
    // LinkedIn member tokens last ~60 days and refresh tokens are partner-only; Meta page
    // tokens derived from a long-lived user token do not expire.
    throw new ReconnectError(platform, `Access token for ${a.row.displayName} expired; reconnect the account`);
  } catch (e) {
    if (e instanceof ReconnectError && a.row.status !== "needs_reconnect") await markNeedsReconnect(a, e.message);
    throw e;
  }
}

/** Token for the platform's default account (or a given one); null when none is connected. */
export async function accountToken(workspaceId: string, platform: PlatformId, accountId?: string | null): Promise<string | null> {
  const a = await getAccount(workspaceId, platform, accountId);
  return a ? tokenFor(a) : null;
}
