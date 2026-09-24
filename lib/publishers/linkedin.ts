import type { ImageAsset } from "@prisma/client";
import { jsonOrThrow, PublishError, type Publisher } from "@/lib/publishers/types";
import { readObject } from "@/lib/storage";

// LinkedIn Posts API (versioned /rest endpoints). [verify] LinkedIn-Version header and scopes.
const API = "https://api.linkedin.com/rest";

export function liHeaders(token: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": process.env.LINKEDIN_API_VERSION || "202608",
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
    ...extra,
  };
}

/**
 * LinkedIn "little text" commentary: reserved characters must be backslash-escaped, and
 * hashtags use the {hashtag|\#|tag} template so they render as links.
 */
export function toLittleText(text: string): string {
  const escaped = text.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
  return escaped.replace(/(^|\s)\\#([\p{L}\p{N}_]+)/gu, (_m, pre: string, tag: string) => `${pre}{hashtag|\\#|${tag}}`);
}

async function uploadImage(token: string, owner: string, img: ImageAsset, url: string): Promise<string> {
  const init = await jsonOrThrow(
    await fetch(`${API}/images?action=initializeUpload`, { method: "POST", headers: liHeaders(token), body: JSON.stringify({ initializeUploadRequest: { owner } }) }),
    "LinkedIn image init",
  );
  const { uploadUrl, image } = init.value as { uploadUrl: string; image: string };
  const bytes = await readObject(url);
  const put = await fetch(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": img.mimeType }, body: new Uint8Array(bytes) });
  if (!put.ok) throw new PublishError(`LinkedIn image upload failed (${put.status})`);
  return image;
}

function makePublisher(platform: "lip" | "lic"): Publisher {
  return {
    platform,
    canAutoPublish: (a) => !!a && a.row.status === "connected" && (platform === "lip" || !!a.meta.orgUrn),
    validate(d) {
      const e: string[] = [];
      if (!d.hasPost && !d.body) e.push("LinkedIn posts need text");
      if ((d.body ?? "").length > 3000) e.push("Post is over 3,000 characters");
      return e;
    },
    async publish(d, images, account, token) {
      const author = platform === "lip" ? (account.meta.personUrn as string) : (account.meta.orgUrn as string);
      if (!author) throw new PublishError(platform === "lic" ? "No company page linked; reconnect LinkedIn as a page admin" : "LinkedIn profile not linked", false);

      const imgs = images.filter((i) => i.mimeType.startsWith("image/"));
      const urns: string[] = [];
      for (const img of imgs) for (const u of img.urls.slice(0, 20)) urns.push(await uploadImage(token, author, img, u));

      const post: Record<string, unknown> = {
        author,
        commentary: toLittleText(d.body ?? ""),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      };
      if (urns.length === 1) post.content = { media: { id: urns[0] } };
      if (urns.length > 1) post.content = { multiImage: { images: urns.map((id) => ({ id })) } };

      const res = await fetch(`${API}/posts`, { method: "POST", headers: liHeaders(token), body: JSON.stringify(post) });
      if (!res.ok) await jsonOrThrow(res, "LinkedIn post");
      const urn = res.headers.get("x-restli-id") || res.headers.get("x-linkedin-id") || "";
      if (!urn) throw new PublishError("LinkedIn did not return a post id", false);

      // First-comment link (spec §10): post it as a comment after publishing.
      if (d.firstComment) {
        await fetch(`${API}/socialActions/${encodeURIComponent(urn)}/comments`, {
          method: "POST",
          headers: liHeaders(token),
          body: JSON.stringify({ actor: author, object: urn, message: { text: d.firstComment } }),
        })
          .then((r) => (r.ok ? null : jsonOrThrow(r, "LinkedIn first comment")))
          .catch((e) => console.warn("[linkedin] first comment failed:", e.message));
      }
      return { externalId: urn, url: `https://www.linkedin.com/feed/update/${urn}/` };
    },
  };
}

export const linkedinProfilePublisher = makePublisher("lip");
export const linkedinCompanyPublisher = makePublisher("lic");
