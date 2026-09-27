import { createHmac, randomBytes } from "node:crypto";

// OAuth 1.0a request signing (HMAC-SHA1, RFC 5849), as used by X for user-context calls.
// Only oauth_* params and URL-encoded form / query params are signed; JSON and multipart
// bodies are not part of the signature.

/** RFC 3986 percent-encoding (stricter than encodeURIComponent). */
export const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export type OAuth1Keys = { consumerKey: string; consumerSecret: string; token?: string; tokenSecret?: string };

export function signatureBase(method: string, url: string, params: Record<string, string>): string {
  const u = new URL(url);
  const all: [string, string][] = [...Object.entries(params)];
  u.searchParams.forEach((v, k) => all.push([k, v]));
  const norm = all
    .map(([k, v]) => [pct(k), pct(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;
  return [method.toUpperCase(), pct(baseUrl), pct(norm)].join("&");
}

export function sign(base: string, consumerSecret: string, tokenSecret = ""): string {
  return createHmac("sha1", `${pct(consumerSecret)}&${pct(tokenSecret)}`).update(base).digest("base64");
}

/**
 * Authorization header for a request. `formParams` are URL-encoded body params that must be
 * signed (e.g. oauth_verifier); `extraOauth` adds oauth_* params such as oauth_callback.
 * nonce/timestamp are injectable for tests.
 */
export function authHeader(
  method: string,
  url: string,
  keys: OAuth1Keys,
  opts: { formParams?: Record<string, string>; extraOauth?: Record<string, string>; nonce?: string; timestamp?: string } = {},
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: keys.consumerKey,
    oauth_nonce: opts.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: opts.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
    ...(keys.token ? { oauth_token: keys.token } : {}),
    ...(opts.extraOauth ?? {}),
  };
  const base = signatureBase(method, url, { ...oauth, ...(opts.formParams ?? {}) });
  oauth.oauth_signature = sign(base, keys.consumerSecret, keys.tokenSecret);
  return (
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${pct(k)}="${pct(oauth[k])}"`)
      .join(", ")
  );
}

export function xKeys(): { consumerKey: string; consumerSecret: string } {
  const consumerKey = process.env.X_CONSUMER_KEY;
  const consumerSecret = process.env.X_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) throw new Error("X_CONSUMER_KEY and X_CONSUMER_SECRET are not set on the server");
  return { consumerKey, consumerSecret };
}
