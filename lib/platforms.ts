// Single source of truth for platform rules. Prompts (HARD LIMITS block), validators,
// the Compose / Prompts / Schedule UI and the publishers all read these values.
// [verify] every number against the platform's current docs before each release.

export const PLATFORM_IDS = ["fb", "ig", "lip", "lic", "quora", "medium", "reddit"] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];
export type LayerId = PlatformId | "brand";

export type SizePreset = { key: string; w: number; h: number; label: string };

export type PublishKind = "auto" | "copy" | "token-draft";

export interface PlatformSpec {
  id: PlatformId;
  name: string;
  short: string;
  mono: string;
  color: string;
  /** Max characters of body text (0 = no hard limit). */
  textLimit: number;
  /** Title rules; null = platform has no title field. */
  title: { label: string; required: boolean; limit: number | null; idealMax?: number } | null;
  /** Approximate characters visible before "See more". */
  visibleBeforeMore: number | null;
  hashtags: { max: number | null; label: string };
  sizes: SizePreset[]; // first entry is the default
  publish: {
    kind: PublishKind;
    label: string; // tile label on Compose, e.g. "Auto-post · Meta Graph"
    note: string; // Publishing note on the Prompts screen
    requiresMedia?: boolean;
  };
  /** Link placement rules that the validator enforces. */
  linkPolicy?: "body" | "first_comment" | "link_in_bio" | "none";
  /** Spec rows shown in the "Hard limits · enforced" panel. */
  specRows: { k: string; v: string }[];
  /** Where a reminder deep-links for manual posting. */
  composeUrl: (ctx: { subreddit?: string | null }) => string;
}

const s = (w: number, h: number, label: string): SizePreset => ({ key: `${w}x${h}`, w, h, label });

export const PLATFORMS: Record<PlatformId, PlatformSpec> = {
  fb: {
    id: "fb",
    name: "Facebook Page",
    short: "Facebook",
    mono: "Fb",
    color: "#2F4B8A",
    textLimit: 63206,
    title: null,
    visibleBeforeMore: 125,
    hashtags: { max: null, label: "None by default" },
    sizes: [s(1080, 1350, "Feed 4:5"), s(1080, 1080, "Square"), s(1200, 630, "Link"), s(1080, 1920, "Story")],
    publish: {
      kind: "auto",
      label: "Auto-post · Meta Graph",
      note: "Auto-posts to a Facebook Page through the Meta Graph API. Requires a Page access token with publishing permission.",
    },
    linkPolicy: "body",
    specRows: [
      { k: "Max length", v: "63,206 chars" },
      { k: 'Visible before "See more"', v: "~125 chars" },
      { k: "Image", v: "1080×1080 or 1080×1350" },
      { k: "Link preview", v: "1200×630" },
    ],
    composeUrl: () => "https://business.facebook.com/latest/composer",
  },
  ig: {
    id: "ig",
    name: "Instagram",
    short: "Instagram",
    mono: "Ig",
    color: "#8E3A5E",
    textLimit: 2200,
    title: null,
    visibleBeforeMore: 125,
    hashtags: { max: 5, label: "Max 5 per post" }, // platform-enforced since Dec 2025 [verify]
    sizes: [s(1080, 1350, "Feed 4:5"), s(1080, 1080, "Square"), s(1080, 1920, "Story / Reel")],
    publish: {
      kind: "auto",
      label: "Auto-post · Business acct",
      note: "Auto-posts through the Instagram Graph API. Needs a Business or Creator account linked to a Facebook Page, and every post needs an image or video.",
      requiresMedia: true,
    },
    linkPolicy: "link_in_bio",
    specRows: [
      { k: "Caption", v: "2,200 chars" },
      { k: "Hashtags", v: "Max 5 per post" },
      { k: "Feed image", v: "1080×1350 (4:5)" },
      { k: "Reel / Story", v: "1080×1920 (9:16)" },
    ],
    composeUrl: () => "https://www.instagram.com/",
  },
  lip: {
    id: "lip",
    name: "LinkedIn Profile",
    short: "LinkedIn Profile",
    mono: "in",
    color: "#1D5C8C",
    textLimit: 3000,
    title: null,
    visibleBeforeMore: 210,
    hashtags: { max: null, label: "None by default" },
    sizes: [s(1080, 1350, "Portrait"), s(1200, 1200, "Square"), s(1200, 627, "Landscape")],
    publish: {
      kind: "auto",
      label: "Auto-post · Personal",
      note: "Auto-posts to your personal profile through LinkedIn OAuth (Share on LinkedIn).",
    },
    linkPolicy: "first_comment",
    specRows: [
      { k: "Max length", v: "3,000 chars" },
      { k: 'Visible before "see more"', v: "~210 chars" },
      { k: "Image", v: "1200×1200 or 1080×1350" },
      { k: "Document post", v: "PDF, up to 300 pages" },
    ],
    composeUrl: () => "https://www.linkedin.com/feed/?shareActive=true",
  },
  lic: {
    id: "lic",
    name: "LinkedIn Company",
    short: "LinkedIn Company",
    mono: "in",
    color: "#174A70",
    textLimit: 3000,
    title: null,
    visibleBeforeMore: 210,
    hashtags: { max: 3, label: "1–3 recommended" },
    sizes: [s(1200, 627, "Landscape"), s(1200, 1200, "Square"), s(1080, 1350, "Portrait")],
    publish: {
      kind: "auto",
      label: "Auto-post · Company page",
      note: "Auto-posts through the LinkedIn Community Management API. Your app needs approval for company pages and you must be a page admin.",
    },
    linkPolicy: "body",
    specRows: [
      { k: "Max length", v: "3,000 chars" },
      { k: 'Visible before "see more"', v: "~210 chars" },
      { k: "Image", v: "1200×627 or 1200×1200" },
      { k: "Hashtags", v: "1–3 recommended" },
    ],
    composeUrl: () => "https://www.linkedin.com/company/admin/",
  },
  quora: {
    id: "quora",
    name: "Quora",
    short: "Quora",
    mono: "Q",
    color: "#8A2B2B",
    textLimit: 0,
    title: { label: "Question", required: true, limit: null },
    visibleBeforeMore: null,
    hashtags: { max: 0, label: "—" },
    sizes: [s(1200, 630, "Landscape"), s(1080, 1080, "Square"), s(1080, 1350, "Portrait")],
    publish: {
      kind: "copy",
      label: "Draft + copy · no API",
      note: "Quora has no public posting API. Drafts are prepared here for you to copy and paste.",
    },
    linkPolicy: "body",
    specRows: [
      { k: "Answer length", v: "No hard limit" },
      { k: "Format", v: "Question + answer" },
      { k: "Links", v: "1 recommended" },
    ],
    composeUrl: () => "https://www.quora.com/",
  },
  medium: {
    id: "medium",
    name: "Medium",
    short: "Medium",
    mono: "M",
    color: "#2B2924",
    textLimit: 0,
    title: { label: "Title", required: true, limit: null, idealMax: 60 },
    visibleBeforeMore: null,
    hashtags: { max: 5, label: "Max 5 topics" },
    sizes: [s(1400, 788, "Header 16:9"), s(1400, 1050, "4:3"), s(1200, 630, "Social share")],
    publish: {
      kind: "token-draft",
      label: "Draft + copy · API limited",
      note: "Medium no longer issues new API tokens. If you have an existing integration token it can post as a draft; otherwise copy and paste.",
    },
    linkPolicy: "body",
    specRows: [
      { k: "Title", v: "< 60 chars ideal" },
      { k: "Topics", v: "Max 5" },
      { k: "Format", v: "Markdown / HTML" },
    ],
    composeUrl: () => "https://medium.com/new-story",
  },
  reddit: {
    id: "reddit",
    name: "Reddit",
    short: "Reddit",
    mono: "r/",
    color: "#A5421A",
    textLimit: 40000,
    title: { label: "Title", required: true, limit: 300 },
    visibleBeforeMore: null,
    hashtags: { max: 0, label: "—" },
    sizes: [s(1200, 900, "4:3"), s(1080, 1080, "Square"), s(1080, 1350, "Portrait")],
    publish: {
      kind: "auto",
      label: "Auto-post · Reddit API",
      note: "Auto-posts through the Reddit API with an OAuth app. Each subreddit has its own self-promotion rules; the agent checks them first.",
    },
    linkPolicy: "none",
    specRows: [
      { k: "Title", v: "300 chars" },
      { k: "Body", v: "40,000 chars" },
      { k: "Flair", v: "If subreddit requires" },
    ],
    composeUrl: ({ subreddit }) =>
      subreddit ? `https://www.reddit.com/${normalizeSubreddit(subreddit)}/submit` : "https://www.reddit.com/submit",
  },
};

export const PLATFORM_LIST: PlatformSpec[] = PLATFORM_IDS.map((id) => PLATFORMS[id]);

export const BRAND_LAYER = {
  id: "brand" as const,
  name: "Brand voice",
  sub: "Applies to all platforms",
  mono: "Aa",
  color: "#A8461F",
  specRows: [{ k: "Scope", v: "Prepended to every call" }],
  pub: "Not a platform. Edits here change every draft on the next run.",
};

export function isPlatformId(x: unknown): x is PlatformId {
  return typeof x === "string" && (PLATFORM_IDS as readonly string[]).includes(x);
}

export function normalizeSubreddit(input: string): string {
  const name = input.trim().replace(/^\/?r\//i, "").replace(/\/.*$/, "");
  return `r/${name}`;
}

export function findSize(platform: PlatformId, key?: string | null): SizePreset {
  const p = PLATFORMS[platform];
  const hit = key ? p.sizes.find((z) => z.key === key) : undefined;
  if (hit) return hit;
  const m = key?.match(/^(\d{2,4})x(\d{2,4})$/);
  if (m) {
    const w = Math.min(4000, Math.max(200, +m[1]));
    const h = Math.min(4000, Math.max(200, +m[2]));
    return { key: `${w}x${h}`, w, h, label: "Custom" };
  }
  return p.sizes[0];
}

export function sizeLabel(z: SizePreset) {
  return `${z.w} × ${z.h} · ${z.label}`;
}

/** Whether a platform can auto-publish given what is connected. */
export function canAutoPublish(platform: PlatformId, connected: boolean): boolean {
  const kind = PLATFORMS[platform].publish.kind;
  if (kind === "copy") return false;
  return connected;
}

/** Hard-limits block appended to the system prompt, generated from this file. */
export function hardLimitsBlock(platform: PlatformId): string {
  const p = PLATFORMS[platform];
  const lines: string[] = ["HARD LIMITS (enforced in code; drafts that break them are rejected):"];
  if (p.textLimit) lines.push(`- Body must be at most ${p.textLimit.toLocaleString("en-US")} characters.`);
  else lines.push("- No hard body limit; keep it as long as the content needs and no longer.");
  if (p.visibleBeforeMore)
    lines.push(`- Only about the first ${p.visibleBeforeMore} characters show before "see more"; front-load the hook.`);
  if (p.title) {
    const lim = p.title.limit ? ` of at most ${p.title.limit} characters` : "";
    const ideal = p.title.idealMax ? ` (ideally under ${p.title.idealMax} characters)` : "";
    lines.push(`- A ${p.title.label.toLowerCase()}${lim}${ideal} is required; return it in "title".`);
  } else {
    lines.push('- This platform has no title field; set "title" to null.');
  }
  if (p.hashtags.max === 0) lines.push("- No hashtags.");
  else if (p.hashtags.max) lines.push(`- At most ${p.hashtags.max} hashtags. Never exceed ${p.hashtags.max}.`);
  if (p.linkPolicy === "first_comment")
    lines.push('- No URLs in the body. Put the link in "first_comment" and mention that it is in the first comment.');
  if (p.linkPolicy === "link_in_bio") lines.push('- No URLs in the body (links are not clickable). Say "link in bio" instead.');
  if (platform === "medium") lines.push('- Return the one-sentence subtitle in "subtitle" and the Markdown article in "body". Put topic tags in "hashtags" without the # sign.');
  else lines.push('- Set "subtitle" to null.');
  if (platform === "ig") lines.push('- Always return "visual_brief" describing the image or carousel.');
  lines.push('- Return hashtags both inline where the platform expects them and in the "hashtags" array (without duplicates).');
  lines.push('- List every [PLACEHOLDER]-style token you used in "placeholders".');
  return lines.join("\n");
}
