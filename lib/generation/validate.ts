import { PLATFORMS, type PlatformId } from "@/lib/platforms";

export type DraftContent = {
  title?: string | null;
  body?: string | null;
  firstComment?: string | null;
  hashtags?: string[];
};

export type Validation = {
  /** Hard violations: block Approve until fixed. */
  errors: string[];
  /** Soft notes shown on the card; do not block. */
  notes: string[];
};

const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+\.\S+/i;
const LINK_PLACEHOLDER_RE = /\[(?:YOUR )?LINK\]/i;
const HASHTAG_RE = /(^|\s)#([\p{L}\p{N}_]+)/gu;

export function inlineHashtags(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(HASHTAG_RE)) out.push(m[2].toLowerCase());
  return out;
}

/** Unique hashtags across the body and the hashtags array. */
export function countHashtags(body: string, tags: string[] = []): number {
  const set = new Set(inlineHashtags(body));
  for (const t of tags) set.add(t.replace(/^#/, "").toLowerCase());
  return set.size;
}

export function bodyLength(d: DraftContent): number {
  return (d.body ?? "").length;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findBanned(text: string, banned: string[]): string[] {
  const hits: string[] = [];
  for (const phrase of banned) {
    const p = phrase.trim();
    if (!p) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(p)}(?=$|[^\\p{L}\\p{N}])`, "iu");
    if (re.test(text)) hits.push(p);
  }
  return hits;
}

/** Validate a draft against /lib/platforms.ts and the brand kit (spec 9.4). */
export function validateDraft(
  platform: PlatformId,
  d: DraftContent,
  opts: { bannedPhrases?: string[]; linkPolicy?: string; link?: string | null; hashtagRule?: string } = {},
): Validation {
  const p = PLATFORMS[platform];
  const errors: string[] = [];
  const notes: string[] = [];
  const body = d.body ?? "";
  const title = d.title ?? "";

  if (!body.trim()) errors.push("Body is empty.");
  if (p.textLimit && body.length > p.textLimit)
    errors.push(`Body is ${body.length.toLocaleString("en-US")} characters; the limit is ${p.textLimit.toLocaleString("en-US")}.`);

  if (p.title) {
    if (p.title.required && !title.trim()) errors.push(`${p.title.label} is required.`);
    if (p.title.limit && title.length > p.title.limit) errors.push(`${p.title.label} is ${title.length} characters; the limit is ${p.title.limit}.`);
    if (p.title.idealMax && title.length > p.title.idealMax) notes.push(`${p.title.label} is ${title.length} characters; under ${p.title.idealMax} reads best.`);
  }

  const ruleMax = hashtagMaxFromRule(opts.hashtagRule);
  const max = p.hashtags.max === null ? ruleMax : ruleMax === null ? p.hashtags.max : Math.min(p.hashtags.max, ruleMax);
  if (max !== null) {
    const n = platform === "medium" ? (d.hashtags ?? []).length : countHashtags(body, d.hashtags);
    const what = platform === "medium" ? "topics" : "hashtags";
    if (max === 0 && n > 0) errors.push(`${p.name} posts should not use ${what} here (found ${n}).`);
    else if (max > 0 && n > max) errors.push(`${n} ${what}; the maximum is ${max}.`);
  }

  const policy = opts.linkPolicy ?? p.linkPolicy;
  if (policy === "first_comment" || policy === "link_in_bio") {
    const hasLink = URL_RE.test(body) || LINK_PLACEHOLDER_RE.test(body) || (!!opts.link && body.includes(opts.link));
    if (hasLink)
      errors.push(policy === "first_comment" ? "Move the link out of the body and into the first comment." : 'Links are not clickable here: remove the URL and say "link in bio".');
  }

  const banned = findBanned(`${title}\n${body}`, opts.bannedPhrases ?? []);
  if (banned.length) errors.push(`Uses banned phrase${banned.length > 1 ? "s" : ""}: ${banned.map((b) => `"${b}"`).join(", ")}.`);

  const ph = [...new Set([...`${title}\n${body}\n${d.firstComment ?? ""}`.matchAll(/\[[A-Z][A-Z0-9 _/-]{2,40}\]/g)].map((m) => m[0]))];
  if (ph.length) notes.push(`Fill in before posting: ${ph.join(", ")}`);

  return { errors, notes };
}

/** "None" → 0, "1–3" → 3, "3–5" → 5, "Up to 5 topics" → 5; unknown → no extra limit. */
export function hashtagMaxFromRule(rule?: string): number | null {
  if (!rule) return null;
  if (/^none$/i.test(rule.trim())) return 0;
  const nums = rule.match(/\d+/g);
  return nums ? Math.max(...nums.map(Number)) : null;
}

/** Maps output-rule CTA choice to the validator's link policy. */
export function linkPolicyFromRules(cta: string | undefined, fallback?: string) {
  if (cta === "First comment") return "first_comment";
  if (cta === "Link in bio") return "link_in_bio";
  if (cta === "No link") return "none";
  if (cta === "In post body") return "body";
  return fallback;
}
