import { db } from "@/lib/db";
import { route } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { appUrl } from "@/lib/env";
import { AUTHORIZE_KEYS, checkAuthorize, type AuthorizeParams } from "@/lib/mcp/authorize";
import { CODE_TTL_MS, newSecret, sha256 } from "@/lib/tokens";

/** The consent form posts here: Allow issues a one-time code, Deny returns access_denied. */
export const POST = route(async (req, ctx) => {
  const form = await req.formData();
  const p = Object.fromEntries(AUTHORIZE_KEYS.map((k) => [k, (form.get(k) as string | null) || undefined])) as AuthorizeParams;
  const c = await checkAuthorize(p);
  if ("error" in c) throw new HttpError(400, c.error ?? "Invalid request");
  const back = new URL(c.redirectUri);
  if (p.state) back.searchParams.set("state", p.state);
  if (form.get("decision") !== "allow") {
    back.searchParams.set("error", "access_denied");
    return Response.redirect(back, 303);
  }
  const code = newSecret("mc_code");
  await db.oAuthCode.create({
    data: { codeHash: sha256(code), clientId: c.client.id, workspaceId: ctx.workspaceId, redirectUri: c.redirectUri, codeChallenge: p.code_challenge!, expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });
  back.searchParams.set("code", code);
  back.searchParams.set("iss", appUrl());
  return Response.redirect(back, 303);
});
