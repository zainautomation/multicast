import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

// Bearer tokens for the MCP endpoint. Only a SHA-256 hash is stored, so a database leak
// doesn't hand out working tokens. Prefixes make them recognisable in logs and scanners.

export const ACCESS_TTL_MS = 7 * 24 * 3600_000;
export const REFRESH_TTL_MS = 90 * 24 * 3600_000;
export const CODE_TTL_MS = 5 * 60_000;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function newSecret(prefix: "mc_key" | "mc_at" | "mc_rt" | "mc_code") {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

/** Hint shown in Settings: prefix plus the first few characters of the random part. */
export const hintOf = (secret: string) => secret.slice(0, secret.lastIndexOf("_") + 7) + "…";

export type TokenCtx = { workspaceId: string; tokenId: string; kind: string; name: string };

/** Resolve a bearer token to its workspace, or null if unknown, expired or revoked. */
export async function verifyBearer(header: string | null): Promise<TokenCtx | null> {
  const m = header?.match(/^Bearer\s+(\S+)$/i);
  if (!m || !/^mc_(key|at)_/.test(m[1])) return null;
  const t = await db.apiToken.findUnique({ where: { tokenHash: sha256(m[1]) } });
  if (!t || (t.expiresAt && t.expiresAt < new Date())) return null;
  // Throttle the write: one lastUsedAt update per token per minute is plenty.
  if (!t.lastUsedAt || Date.now() - t.lastUsedAt.getTime() > 60_000) {
    await db.apiToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
  return { workspaceId: t.workspaceId, tokenId: t.id, kind: t.kind, name: t.name };
}

/** Create an API key for Settings; the secret is returned once and never again. */
export async function createApiKey(workspaceId: string, name: string) {
  const secret = newSecret("mc_key");
  const row = await db.apiToken.create({ data: { workspaceId, kind: "key", name, tokenHash: sha256(secret), hint: hintOf(secret) } });
  return { id: row.id, secret };
}

/** Issue an access + refresh token pair to an OAuth client. */
export async function issueOAuthTokens(workspaceId: string, clientId: string, clientName: string) {
  const access = newSecret("mc_at");
  const refresh = newSecret("mc_rt");
  await db.apiToken.create({
    data: {
      workspaceId,
      kind: "oauth",
      name: clientName,
      clientId,
      tokenHash: sha256(access),
      hint: hintOf(access),
      refreshHash: sha256(refresh),
      expiresAt: new Date(Date.now() + ACCESS_TTL_MS),
      refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });
  return { access_token: access, token_type: "Bearer", expires_in: Math.floor(ACCESS_TTL_MS / 1000), refresh_token: refresh };
}

/** Rotate: the old pair stops working and a new one is issued for the same connection. */
export async function refreshOAuthTokens(refresh: string, clientId: string) {
  const t = await db.apiToken.findUnique({ where: { refreshHash: sha256(refresh) } });
  if (!t || t.clientId !== clientId || (t.refreshExpiresAt && t.refreshExpiresAt < new Date())) return null;
  await db.apiToken.delete({ where: { id: t.id } });
  return issueOAuthTokens(t.workspaceId, clientId, t.name);
}

/** PKCE S256: BASE64URL(SHA256(verifier)) must equal the stored challenge. */
export function pkceMatches(verifier: string, challenge: string) {
  const a = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}
