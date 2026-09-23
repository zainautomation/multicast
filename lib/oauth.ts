import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { decryptJson } from "@/lib/crypto";
import { HttpError } from "@/lib/errors";
import { GRAPH } from "@/lib/publishers/meta";
import { saveAccount } from "@/lib/publishers/accounts";
import { liHeaders } from "@/lib/publishers/linkedin";
import { saveIntegration } from "@/lib/integrations/store";

// OAuth for publishing accounts (Meta, LinkedIn, Reddit) and Canva. The `state` value and
// (for Canva) the PKCE verifier live in a short-lived httpOnly cookie and must match on return.

export const PROVIDERS = ["meta", "linkedin", "reddit", "canva"] as const;
export type Provider = (typeof PROVIDERS)[number];

const APP = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
export const redirectUri = (p: Provider) => `${APP()}/api/oauth/${p}/callback`;
const cookieName = (p: Provider) => `mc_oauth_${p}`;

const b64url = (b: Buffer) => b.toString("base64url");

function need(name: string) {
  const v = process.env[name];
  if (!v) throw new HttpError(400, `${name} is not set on the server. Add your app credentials to .env first.`);
  return v;
}

async function canvaCreds(workspaceId: string) {
  const row = await db.integration.findUnique({ where: { workspaceId_type: { workspaceId, type: "canva" } } });
  if (!row) throw new HttpError(400, "Enter your Canva client ID and secret first");
  return decryptJson<Record<string, string>>(row.credentialsEnc);
}

export async function startUrl(p: Provider, workspaceId: string): Promise<string> {
  const state = b64url(randomBytes(24));
  const jar = await cookies();
  const payload: Record<string, string> = { state };
  let url: URL;
  switch (p) {
    case "meta": {
      url = new URL(`https://www.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}/dialog/oauth`);
      url.search = new URLSearchParams({
        client_id: need("META_APP_ID"),
        redirect_uri: redirectUri(p),
        state,
        response_type: "code",
        scope: ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish", "business_management"].join(","),
      }).toString();
      break;
    }
    case "linkedin": {
      const scopes = ["openid", "profile", "w_member_social"];
      if (process.env.LINKEDIN_COMPANY_ENABLED === "true") scopes.push("w_organization_social", "r_organization_admin");
      url = new URL("https://www.linkedin.com/oauth/v2/authorization");
      url.search = new URLSearchParams({ response_type: "code", client_id: need("LINKEDIN_CLIENT_ID"), redirect_uri: redirectUri(p), state, scope: scopes.join(" ") }).toString();
      break;
    }
    case "reddit": {
      url = new URL("https://www.reddit.com/api/v1/authorize");
      url.search = new URLSearchParams({ client_id: need("REDDIT_CLIENT_ID"), response_type: "code", state, redirect_uri: redirectUri(p), duration: "permanent", scope: "identity submit read flair" }).toString();
      break;
    }
    case "canva": {
      const creds = await canvaCreds(workspaceId);
      const verifier = b64url(randomBytes(48));
      payload.verifier = verifier;
      const challenge = b64url(createHash("sha256").update(verifier).digest());
      url = new URL("https://www.canva.com/api/oauth/authorize");
      url.search = new URLSearchParams({
        code_challenge: challenge,
        code_challenge_method: "S256",
        response_type: "code",
        client_id: creds.clientId,
        redirect_uri: redirectUri(p),
        state,
        scope: ["design:content:read", "design:content:write", "design:meta:read", "asset:read", "asset:write", "brandtemplate:meta:read", "brandtemplate:content:read", "profile:read"].join(" "),
      }).toString();
      break;
    }
  }
  jar.set(cookieName(p), JSON.stringify(payload), { httpOnly: true, sameSite: "lax", secure: APP().startsWith("https"), path: `/api/oauth/${p}`, maxAge: 600 });
  return url.toString();
}

async function readState(p: Provider, state: string | null) {
  const jar = await cookies();
  const raw = jar.get(cookieName(p))?.value;
  jar.delete(cookieName(p));
  if (!raw || !state) throw new HttpError(400, "Sign-in expired. Try connecting again.");
  const payload = JSON.parse(raw) as Record<string, string>;
  if (payload.state !== state) throw new HttpError(400, "OAuth state mismatch. Try connecting again.");
  return payload;
}

async function j(res: Response, what: string) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(400, `${what} failed: ${body.error_description || body.error?.message || body.error || body.message || res.status}`);
  return body;
}

export type MetaPage = { id: string; name: string; token: string; ig?: { id: string; username: string } | null };

export async function finish(p: Provider, workspaceId: string, code: string, state: string | null) {
  const saved = await readState(p, state);
  switch (p) {
    case "meta": {
      const id = need("META_APP_ID");
      const secret = need("META_APP_SECRET");
      const short = await j(await fetch(`${GRAPH()}/oauth/access_token?${new URLSearchParams({ client_id: id, client_secret: secret, redirect_uri: redirectUri(p), code })}`), "Meta token exchange");
      const long = await j(
        await fetch(`${GRAPH()}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: id, client_secret: secret, fb_exchange_token: short.access_token })}`),
        "Meta long-lived token",
      );
      const pagesRes = await j(await fetch(`${GRAPH()}/me/accounts?${new URLSearchParams({ fields: "id,name,access_token,instagram_business_account{id,username}", access_token: long.access_token })}`), "Meta page list");
      const pages: MetaPage[] = (pagesRes.data ?? []).map((x: { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username: string } }) => ({
        id: x.id,
        name: x.name,
        token: x.access_token,
        ig: x.instagram_business_account ?? null,
      }));
      if (!pages.length) throw new HttpError(400, "No Facebook Pages found on this account. You need to be a Page admin.");
      await saveMetaPage(workspaceId, long.access_token, pages, pages.find((x) => x.ig) ?? pages[0]);
      return;
    }
    case "linkedin": {
      const t = await j(
        await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(p), client_id: need("LINKEDIN_CLIENT_ID"), client_secret: need("LINKEDIN_CLIENT_SECRET") }),
        }),
        "LinkedIn token exchange",
      );
      const expiresAt = new Date(Date.now() + (t.expires_in ?? 5_184_000) * 1000);
      const me = await j(await fetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` } }), "LinkedIn profile");
      const tokens = { accessToken: t.access_token, refreshToken: t.refresh_token, scope: t.scope };
      await saveAccount(workspaceId, "lip", { tokens, expiresAt, displayName: me.name ?? "LinkedIn member", meta: { personUrn: `urn:li:person:${me.sub}` } });
      if (process.env.LINKEDIN_COMPANY_ENABLED === "true") {
        const acl = await fetch(`https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`, { headers: liHeaders(t.access_token) })
          .then((r) => (r.ok ? r.json() : { elements: [] }))
          .catch(() => ({ elements: [] }));
        const orgUrn: string | undefined = acl.elements?.[0]?.organization;
        if (orgUrn) {
          const orgId = orgUrn.split(":").pop();
          const org: { localizedName?: string } = await fetch(`https://api.linkedin.com/rest/organizations/${orgId}`, { headers: liHeaders(t.access_token) })
            .then((r) => (r.ok ? r.json() : {}))
            .catch(() => ({}));
          await saveAccount(workspaceId, "lic", { tokens, expiresAt, displayName: org.localizedName ?? "Company page", meta: { orgUrn, orgs: acl.elements.map((e: { organization: string }) => e.organization) } });
        }
      }
      return;
    }
    case "reddit": {
      const t = await j(
        await fetch("https://www.reddit.com/api/v1/access_token", {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${need("REDDIT_CLIENT_ID")}:${need("REDDIT_CLIENT_SECRET")}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": process.env.REDDIT_USER_AGENT || "web:multicast:v0.1",
          },
          body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(p) }),
        }),
        "Reddit token exchange",
      );
      const me = await j(await fetch("https://oauth.reddit.com/api/v1/me", { headers: { Authorization: `Bearer ${t.access_token}`, "User-Agent": process.env.REDDIT_USER_AGENT || "web:multicast:v0.1" } }), "Reddit identity");
      await saveAccount(workspaceId, "reddit", {
        tokens: { accessToken: t.access_token, refreshToken: t.refresh_token, scope: t.scope },
        expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000),
        displayName: `u/${me.name}`,
        meta: { username: me.name },
      });
      return;
    }
    case "canva": {
      const creds = await canvaCreds(workspaceId);
      const t = await j(
        await fetch("https://api.canva.com/rest/v1/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")}` },
          body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: saved.verifier, redirect_uri: redirectUri(p) }),
        }),
        "Canva token exchange",
      );
      const row = await db.integration.findUniqueOrThrow({ where: { workspaceId_type: { workspaceId, type: "canva" } } });
      await saveIntegration(
        workspaceId,
        "canva",
        { ...creds, accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: String(Date.now() + (t.expires_in ?? 14400) * 1000) },
        (row.meta ?? {}) as Record<string, unknown>,
        "clientId",
      );
      return;
    }
  }
}

/**
 * Store the chosen Page. Tokens (page tokens included) only ever go in the encrypted
 * tokens blob; meta holds non-secret ids and names for display.
 */
export async function saveMetaPage(workspaceId: string, userToken: string, pages: MetaPage[], page: MetaPage) {
  await saveAccount(workspaceId, "fb", {
    tokens: { accessToken: page.token, userToken, pages } as never,
    displayName: page.name,
    meta: { pageId: page.id, pages: pages.map((x) => ({ id: x.id, name: x.name, ig: x.ig?.username ?? null })) },
  });
  if (page.ig) {
    await saveAccount(workspaceId, "ig", { tokens: { accessToken: page.token }, displayName: `@${page.ig.username}`, meta: { igUserId: page.ig.id, pageId: page.id } });
  } else {
    await db.publishingAccount.deleteMany({ where: { workspaceId, platform: "ig" } });
  }
}
