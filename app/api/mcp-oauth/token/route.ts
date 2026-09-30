import { db } from "@/lib/db";
import { rateLimit } from "@/lib/api";
import { CORS } from "@/lib/mcp/oauth-meta";
import { issueOAuthTokens, pkceMatches, refreshOAuthTokens, sha256 } from "@/lib/tokens";

// OAuth 2.1 token endpoint: authorization_code (with PKCE S256) and refresh_token.

const NO_STORE = { ...CORS, "Cache-Control": "no-store" };
const err = (error: string, description: string, status = 400) => Response.json({ error, error_description: description }, { status, headers: NO_STORE });

async function params(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v)]));
  }
  return Object.fromEntries(new URLSearchParams(await req.text()));
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  try {
    rateLimit(`oauth-token:${ip}`, 60, 60_000);
  } catch {
    return err("slow_down", "Too many requests", 429);
  }
  const p = await params(req);
  const client = p.client_id ? await db.oAuthClient.findUnique({ where: { id: p.client_id } }) : null;
  if (!client) return err("invalid_client", "Unknown client_id", 401);

  if (p.grant_type === "authorization_code") {
    if (!p.code || !p.code_verifier) return err("invalid_request", "code and code_verifier are required");
    // Single use: delete first, so a replayed code never works twice.
    const code = await db.oAuthCode.delete({ where: { codeHash: sha256(p.code) } }).catch(() => null);
    if (!code || code.expiresAt < new Date()) return err("invalid_grant", "The authorization code is invalid or expired");
    if (code.clientId !== client.id) return err("invalid_grant", "The code was issued to another client");
    if (p.redirect_uri && p.redirect_uri !== code.redirectUri) return err("invalid_grant", "redirect_uri does not match");
    if (!pkceMatches(p.code_verifier, code.codeChallenge)) return err("invalid_grant", "PKCE verification failed");
    return Response.json(await issueOAuthTokens(code.workspaceId, client.id, client.name), { headers: NO_STORE });
  }

  if (p.grant_type === "refresh_token") {
    if (!p.refresh_token) return err("invalid_request", "refresh_token is required");
    const tokens = await refreshOAuthTokens(p.refresh_token, client.id);
    if (!tokens) return err("invalid_grant", "The refresh token is invalid, expired or revoked");
    return Response.json(tokens, { headers: NO_STORE });
  }

  return err("unsupported_grant_type", "Use authorization_code or refresh_token");
}

export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
