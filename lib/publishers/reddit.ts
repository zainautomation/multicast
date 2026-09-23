import { jsonOrThrow, PublishError, type Publisher } from "@/lib/publishers/types";
import { normalizeSubreddit } from "@/lib/platforms";
import { fetchSubredditInfo } from "@/lib/reddit-rules";
import { readObject } from "@/lib/storage";

// Reddit OAuth API. Descriptive User-Agent is required. [verify] media upload flow.
const UA = () => process.env.REDDIT_USER_AGENT || "web:multicast:v0.1 (by /u/multicast)";

async function reddit(path: string, token: string, form: Record<string, string>) {
  const res = await fetch(`https://oauth.reddit.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "User-Agent": UA(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  return jsonOrThrow(res, `Reddit ${path}`);
}

/** Upload an image to Reddit's media store and return its URL for kind=image. */
async function uploadMedia(token: string, url: string, mime: string): Promise<string> {
  const lease = await reddit("/api/media/asset.json", token, { filepath: `multicast.${mime === "image/jpeg" ? "jpg" : "png"}`, mimetype: mime });
  const action = `https:${lease.args.action}`;
  const form = new FormData();
  for (const f of lease.args.fields as { name: string; value: string }[]) form.append(f.name, f.value);
  form.append("file", new Blob([new Uint8Array(await readObject(url))], { type: mime }));
  const up = await fetch(action, { method: "POST", body: form });
  if (!up.ok) throw new PublishError(`Reddit media upload failed (${up.status})`);
  const key = (lease.args.fields as { name: string; value: string }[]).find((f) => f.name === "key")?.value;
  return `${action}/${key}`;
}

export const redditPublisher: Publisher = {
  platform: "reddit",
  canAutoPublish: (a) => !!a && a.row.status === "connected",
  validate(d) {
    const e: string[] = [];
    if (!d.title?.trim()) e.push("Reddit posts need a title");
    if ((d.title ?? "").length > 300) e.push("Title is over 300 characters");
    if ((d.body ?? "").length > 40000) e.push("Body is over 40,000 characters");
    return e;
  },
  async publish(d, images, _account, token) {
    const sub = d.brief?.subreddit;
    if (!sub) throw new PublishError("No subreddit set on this brief", false);
    const sr = normalizeSubreddit(sub).slice(2);
    const info = await fetchSubredditInfo(sub, token).catch(() => null);
    if (info?.flairRequired) {
      // Flair choice isn't modelled in v1; fail clearly instead of getting removed by automod.
      const flairs = await fetch(`https://oauth.reddit.com/r/${sr}/api/link_flair_v2`, { headers: { Authorization: `Bearer ${token}`, "User-Agent": UA() } })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []);
      if (!Array.isArray(flairs) || !flairs.length) throw new PublishError(`r/${sr} requires flair; post manually and pick one`, false);
      (d as { _flair?: string })._flair = flairs[0].id;
    }
    const img = images.find((i) => i.mimeType.startsWith("image/"));
    const form: Record<string, string> = { sr, title: d.title ?? "", api_type: "json", resubmit: "true", sendreplies: "true" };
    const flair = (d as { _flair?: string })._flair;
    if (flair) form.flair_id = flair;
    if (img && info?.allowImages !== false) {
      form.kind = "image";
      form.url = await uploadMedia(token, img.urls[0], img.mimeType);
      if (d.body) form.text = d.body;
    } else {
      form.kind = "self";
      form.text = d.body ?? "";
    }
    const r = await reddit("/api/submit", token, form);
    const errs = r.json?.errors as unknown[][] | undefined;
    if (errs?.length) throw new PublishError(`Reddit rejected the post: ${errs.map((e) => e.join(" ")).join("; ")}`, false);
    const data = r.json?.data ?? {};
    const url = data.url || data.user_submitted_page || `https://www.reddit.com/r/${sr}/new/`;
    return { externalId: data.name || data.id || url, url };
  },
};
