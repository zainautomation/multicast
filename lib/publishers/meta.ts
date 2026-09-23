import type { Draft, ImageAsset } from "@prisma/client";
import { jsonOrThrow, PublishError, type Publisher } from "@/lib/publishers/types";
import { poll } from "@/lib/integrations/store";

// Meta Graph API: Facebook Page + Instagram professional account. [verify] version and fields.
export const GRAPH = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}`;

async function graph(path: string, token: string, params: Record<string, string> = {}, method: "GET" | "POST" = "POST") {
  const url = new URL(`${GRAPH()}${path}`);
  const body = new URLSearchParams({ ...params, access_token: token });
  const res =
    method === "GET"
      ? await fetch(`${url}?${body}`, { cache: "no-store" })
      : await fetch(url, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  return jsonOrThrow(res, `Meta ${path}`);
}

const imageUrls = (images: ImageAsset[]) => images.filter((i) => i.mimeType.startsWith("image/")).flatMap((i) => i.urls);
const videoUrls = (images: ImageAsset[]) => images.filter((i) => i.mimeType.startsWith("video/")).flatMap((i) => i.urls);

function withTags(d: Draft) {
  // Hashtags are already inline when the platform uses them; append any that are missing.
  const body = d.body ?? "";
  const missing = d.hashtags.filter((t) => !body.toLowerCase().includes(`#${t.toLowerCase()}`));
  return missing.length ? `${body}\n\n${missing.map((t) => `#${t}`).join(" ")}` : body;
}

export const facebookPublisher: Publisher = {
  platform: "fb",
  canAutoPublish: (a) => !!a && a.row.status === "connected",
  validate(d, images) {
    const e: string[] = [];
    if (!d.hasPost && !images.length) e.push("Nothing to post");
    return e;
  },
  async publish(d, images, account, pageToken) {
    const pageId = account.meta.pageId as string;
    if (!pageId) throw new PublishError("No Facebook Page selected; reconnect Meta", false);
    const message = d.hasPost ? withTags(d) : "";
    const imgs = imageUrls(images);
    const vids = videoUrls(images);
    let postId: string;

    if (vids.length) {
      const r = await graph(`/${pageId}/videos`, pageToken, { file_url: vids[0], description: message });
      postId = r.id;
    } else if (imgs.length === 1) {
      const r = await graph(`/${pageId}/photos`, pageToken, { url: imgs[0], caption: message });
      postId = r.post_id ?? r.id;
    } else if (imgs.length > 1) {
      const media: string[] = [];
      for (const url of imgs) {
        const r = await graph(`/${pageId}/photos`, pageToken, { url, published: "false" });
        media.push(r.id);
      }
      const params: Record<string, string> = { message };
      media.forEach((id, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id })));
      const r = await graph(`/${pageId}/feed`, pageToken, params);
      postId = r.id;
    } else {
      const link = (d.body ?? "").match(/https?:\/\/\S+/)?.[0];
      const r = await graph(`/${pageId}/feed`, pageToken, link ? { message, link } : { message });
      postId = r.id;
    }
    const perma = await graph(`/${postId}`, pageToken, { fields: "permalink_url" }, "GET").catch(() => null);
    return { externalId: postId, url: (perma?.permalink_url as string) || `https://www.facebook.com/${postId}` };
  },
};

async function waitForContainer(id: string, token: string) {
  await poll(
    async () => {
      const s = await graph(`/${id}`, token, { fields: "status_code,status" }, "GET");
      if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new PublishError(`Instagram media container ${s.status_code}: ${s.status ?? ""}`, false);
      return s.status_code === "FINISHED" || s.status_code === "PUBLISHED" ? true : null;
    },
    { intervalMs: 3000, timeoutMs: 5 * 60_000 },
  );
}

export const instagramPublisher: Publisher = {
  platform: "ig",
  canAutoPublish: (a) => !!a && a.row.status === "connected",
  validate(d, images) {
    const e: string[] = [];
    const imgs = imageUrls(images);
    const vids = videoUrls(images);
    if (!imgs.length && !vids.length) e.push("Instagram needs an image or video");
    if (imgs.some((u) => !/^https:\/\//.test(u))) e.push("Instagram needs images at a public HTTPS URL (configure S3 storage)");
    if (images.some((i) => i.mimeType === "image/png")) e.push("Instagram needs JPEG images; regenerate the image");
    if (imgs.length > 10) e.push("Instagram carousels take at most 10 items");
    if ((d.body ?? "").length > 2200) e.push("Caption is over 2,200 characters");
    return e;
  },
  async publish(d, images, account, token) {
    const igId = account.meta.igUserId as string;
    if (!igId) throw new PublishError("No Instagram professional account linked to the Page", false);

    // Respect the daily publishing limit.
    const lim = await graph(`/${igId}/content_publishing_limit`, token, { fields: "quota_usage,config" }, "GET").catch(() => null);
    const q = lim?.data?.[0];
    if (q && q.config?.quota_total && q.quota_usage >= q.config.quota_total) throw new PublishError("Instagram daily publishing limit reached; it resets within 24 hours", true);

    const caption = d.hasPost ? withTags(d) : "";
    const imgs = imageUrls(images);
    const vids = videoUrls(images);
    let creationId: string;
    if (vids.length) {
      const c = await graph(`/${igId}/media`, token, { media_type: "REELS", video_url: vids[0], caption });
      await waitForContainer(c.id, token);
      creationId = c.id;
    } else if (imgs.length === 1) {
      const c = await graph(`/${igId}/media`, token, { image_url: imgs[0], caption });
      await waitForContainer(c.id, token);
      creationId = c.id;
    } else {
      const children: string[] = [];
      for (const url of imgs.slice(0, 10)) {
        const c = await graph(`/${igId}/media`, token, { image_url: url, is_carousel_item: "true" });
        children.push(c.id);
      }
      for (const c of children) await waitForContainer(c, token);
      const parent = await graph(`/${igId}/media`, token, { media_type: "CAROUSEL", children: children.join(","), caption });
      await waitForContainer(parent.id, token);
      creationId = parent.id;
    }
    const pub = await graph(`/${igId}/media_publish`, token, { creation_id: creationId });
    const info = await graph(`/${pub.id}`, token, { fields: "permalink" }, "GET").catch(() => null);
    return { externalId: pub.id, url: (info?.permalink as string) || `https://www.instagram.com/` };
  },
};
