import type { ImageAsset } from "@prisma/client";
import { authHeader, xKeys } from "@/lib/oauth1";
import { jsonOrThrow, PublishError, type Publisher } from "@/lib/publishers/types";
import { readObject } from "@/lib/storage";
import { xLength } from "@/lib/xtext";

// X API v2 with OAuth 1.0a user context. [verify] media upload endpoint and access tier
// (posting needs an app with "Read and write" permission).
const TWEETS = "https://api.x.com/2/tweets";
const MEDIA_V2 = "https://api.x.com/2/media/upload";
const MEDIA_V11 = "https://upload.twitter.com/1.1/media/upload.json";

type Keys = { consumerKey: string; consumerSecret: string; token: string; tokenSecret: string };

async function xFetch(url: string, keys: Keys, init: { body: BodyInit; json?: boolean }) {
  return fetch(url, {
    method: "POST",
    headers: { Authorization: authHeader("POST", url, keys), ...(init.json ? { "Content-Type": "application/json" } : {}) },
    body: init.body,
  });
}

function explain(status: number, body: string) {
  if (status === 401) return new PublishError("X rejected the access token; reconnect X", false);
  if (status === 403) {
    if (/oauth1-permissions|not permitted|read-only|Read-only/i.test(body))
      return new PublishError('X app has no write access. In the X developer portal set App permissions to "Read and write", then reconnect X.', false);
    if (/duplicate/i.test(body)) return new PublishError("X rejected this as a duplicate of a recent post", false);
    return new PublishError(`X refused the post (403): ${body.slice(0, 200)}`, false);
  }
  if (status === 429) return new PublishError("X rate limit reached; will retry", true);
  return new PublishError(`X error (${status}): ${body.slice(0, 200)}`, status >= 500);
}

async function uploadImage(keys: Keys, img: ImageAsset, url: string): Promise<string> {
  const bytes = new Uint8Array(await readObject(url));
  const form = () => {
    const f = new FormData();
    f.append("media", new Blob([bytes], { type: img.mimeType }), img.mimeType === "image/jpeg" ? "image.jpg" : "image.png");
    f.append("media_category", "tweet_image");
    return f;
  };
  let res = await xFetch(MEDIA_V2, keys, { body: form() });
  if (res.status === 404 || res.status === 410) res = await xFetch(MEDIA_V11, keys, { body: form() });
  const text = await res.text();
  if (!res.ok) throw explain(res.status, text);
  const j = JSON.parse(text);
  const id = j.data?.id ?? j.media_id_string;
  if (!id) throw new PublishError("X media upload returned no id", true);
  return String(id);
}

export const xPublisher: Publisher = {
  platform: "x",
  canAutoPublish: (a) => !!a && a.row.status === "connected",
  validate(d, images) {
    const e: string[] = [];
    const n = xLength(d.body ?? "");
    if (!d.body?.trim() && !images.length) e.push("Nothing to post");
    if (n > 280) e.push(`Post is ${n} characters as X counts them; the limit is 280`);
    if (images.some((i) => i.mimeType.startsWith("video/"))) e.push("Video posts to X aren't supported yet; remove the video or post it manually");
    if (images.flatMap((i) => i.urls).length > 4) e.push("X allows at most 4 images per post");
    return e;
  },
  async publish(d, images, account, token) {
    const secret = account.tokens.tokenSecret;
    if (!secret) throw new PublishError("X session incomplete; reconnect X", false);
    const keys: Keys = { ...xKeys(), token, tokenSecret: secret };

    const media: string[] = [];
    for (const img of images.filter((i) => i.mimeType.startsWith("image/"))) for (const u of img.urls.slice(0, 4 - media.length)) media.push(await uploadImage(keys, img, u));

    const post: Record<string, unknown> = { text: d.body ?? "" };
    if (media.length) post.media = { media_ids: media };
    const res = await xFetch(TWEETS, keys, { body: JSON.stringify(post), json: true });
    const text = await res.text();
    if (!res.ok) throw explain(res.status, text);
    const id = JSON.parse(text).data?.id as string;
    const username = (account.meta.username as string) || "i";

    // "First comment" link placement → post the link as a reply.
    if (d.firstComment) {
      await xFetch(TWEETS, keys, { body: JSON.stringify({ text: d.firstComment, reply: { in_reply_to_tweet_id: id } }), json: true })
        .then((r) => (r.ok ? null : jsonOrThrow(r, "X reply")))
        .catch((e) => console.warn("[x] reply failed:", e.message));
    }
    return { externalId: id, url: `https://x.com/${username}/status/${id}` };
  },
};
