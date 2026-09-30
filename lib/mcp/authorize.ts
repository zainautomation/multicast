import { db } from "@/lib/db";

export type AuthorizeParams = {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  state?: string;
  scope?: string;
  resource?: string;
};

export const AUTHORIZE_KEYS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"] as const;

/**
 * Check an authorization request. Problems with the client or redirect URI are shown on
 * our page, never redirected, so a bad redirect_uri can't become an open redirect.
 */
export async function checkAuthorize(p: AuthorizeParams) {
  const client = p.client_id ? await db.oAuthClient.findUnique({ where: { id: p.client_id } }) : null;
  if (!client) return { error: "This app isn't registered with Multicast. Remove the connector and add it again." } as const;
  const redirectUri = p.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) return { error: "The app sent a redirect address it didn't register." } as const;
  if (p.response_type !== "code") return { error: "Unsupported response_type; only code is supported." } as const;
  if (!p.code_challenge || p.code_challenge_method !== "S256") return { error: "The app must use PKCE (S256)." } as const;
  return { client, redirectUri } as const;
}
