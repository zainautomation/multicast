import type { LayerId, PlatformId } from "@/lib/platforms";

export type OutputRules = {
  length: string;
  hashtags: string;
  emoji: string;
  voice: string;
  cta: string;
  variants: number;
};

export type ImageStyle = "Typographic" | "Illustration" | "Photographic" | "Diagram / checklist";
export type ImageFormat = "Single image" | "Carousel";
export type GeneratorId = "builtin" | "canva" | "figma" | "higgsfield" | "custom";

export type ImageDefaults = {
  sizeKey: string;
  bgHex: string;
  fgHex: string;
  generator: GeneratorId;
  style: ImageStyle;
  format: ImageFormat;
  include: { logo: boolean; sig: boolean; headline: boolean };
};

export const RULE_OPTIONS = {
  length: ["Short", "Medium", "Long"],
  hashtags: ["None", "1–3", "3–5"],
  emoji: ["None", "Sparingly", "Freely"],
  voice: ["First person (I)", "Brand (we)"],
  cta: ["In post body", "First comment", "Link in bio", "No link"],
  variants: [1, 2, 3],
} as const;

export const STYLE_OPTIONS: ImageStyle[] = ["Typographic", "Illustration", "Photographic", "Diagram / checklist"];
export const FORMAT_OPTIONS: ImageFormat[] = ["Single image", "Carousel"];

export const TEXT_VARIABLES = ["{brief}", "{goal}", "{tone}", "{link}", "{subreddit}", "{brand_voice}"];
export const IMAGE_VARIABLES = ["{brief}", "{post_text}", "{visual_brief}", "{bg_color}", "{text_color}", "{logo_position}", "{signature}"];

export const DEFAULT_BANNED_PHRASES = [
  "revolutionary",
  "game-changing",
  "game changer",
  "disruptive",
  "cutting-edge",
  "world-class",
  "best-in-class",
  "synergy",
  "supercharge",
  "seamless",
  "next-level",
  "unleash",
];

export const DEFAULT_TEXT_PROMPTS: Record<LayerId, string> = {
  brand: `You write social content for [YOUR COMPANY], which [WHAT YOU DO] for [WHO YOU SERVE].

Voice: clear, confident, practical. Explain like a knowledgeable peer, never like an ad.
Always: plain words, concrete specifics from the brief, one idea per post.
Never: invent statistics, customer names or quotes; use hype words (revolutionary, game-changing); make legal or financial guarantees.
If the brief lacks a fact you need, write [PLACEHOLDER] instead of guessing.`,
  fb: `Write a Facebook Page post from the brief.

Open with a line that works on its own before "See more" (under 125 characters).
Keep it conversational and community-minded. Short paragraphs, 2–4 in total.
End with one clear call to action and the link.
No hashtags unless the brief asks for them.`,
  ig: `Write an Instagram caption from the brief.

First line is the hook; it must stand alone in the feed.
Use short lines and simple arrows or line breaks for scannability.
Links are not clickable in captions: say "link in bio".
End with up to 5 specific hashtags. Never exceed 5.
Also return a VISUAL_BRIEF: format (single, carousel or reel), slide count and on-image text per slide.`,
  lip: `Write a LinkedIn post in first person, as the account owner.

Opening two lines carry the post: a clear observation or tension, under 210 characters combined.
Share a point of view or lesson, not an announcement. One idea only.
Short paragraphs, one to two sentences each, with blank lines between.
No hashtags, no emoji. Put links in the first comment and say so in the last line.
No engagement bait ("Agree?", "Comment YES").`,
  lic: `Write a LinkedIn Company Page post in the brand voice (we).

Lead with what the reader gets, not what we did.
Use up to 3 short bullets for scannable value.
Include the link in the body and end with 1–3 relevant hashtags.
Professional, specific, no superlatives.`,
  quora: `Pick or propose a real question the brief answers, and write a Quora answer to it.

Answer the question directly in the first sentence.
Be genuinely useful on its own: numbered points, concrete examples, no sales pitch.
Mention our resource once, near the end, only where it adds value.
Return QUESTION and ANSWER separately.`,
  medium: `Write a Medium article from the brief.

Return TITLE (under 60 characters), SUBTITLE (one sentence) and BODY in Markdown.
Structure: a short story or problem opening, 3–5 H2 sections, a practical takeaway, then the call to action.
Suggest up to 5 topic tags.`,
  reddit: `Write a Reddit text post for {subreddit}.

Read the subreddit rules in {subreddit_rules} and follow them strictly.
Title: specific and plain, never clickbait, under 300 characters.
Body: lead with value for the community; no marketing language.
Disclose any affiliation openly. Offer the link in comments unless the rules allow self-promotion.`,
};

export const DEFAULT_IMAGE_PROMPTS: Record<LayerId, string> = {
  brand: `Global image style, applied before every platform image prompt.

Clean, editorial layouts on flat brand-colour backgrounds. Large headline type with generous margins.
Place the logo and signature line where the brand kit says.
Avoid stock clichés (handshakes, globes, laptops on beaches) and never show invented people, logos of other companies or fake UI.
Keep all on-image text short and spelled exactly as given.`,
  fb: `Create a Facebook feed image for {brief}.

Headline overlay: the post's hook in 8 words or fewer.
Keep text to a small share of the image; let the headline breathe.
Background {bg_color}, text {text_color}.
Logo {logo_position}, signature line along the bottom edge.`,
  ig: `Create an Instagram carousel from {visual_brief}.

Slide 1: the hook, 7 words or fewer, very large type.
Slides 2–4: one point per slide, 20 words or fewer.
Last slide: "Link in bio" with logo and signature line.
Keep a 120 px safe margin; nothing important in the bottom 15% (UI overlays).`,
  lip: `Create one LinkedIn image to support a first-person post.

Pull the single most quotable line from {post_text} and set it as large type.
Signature line = author name and title from the brand kit.
No logo on personal posts unless the brief asks.`,
  lic: `Create a LinkedIn Company Page image.

Headline = the resource or announcement title.
Sub-line = who it is for, 8 words or fewer.
Logo top-left, signature line = company website.`,
  quora: `Optional supporting graphic for the answer.

A simple numbered summary of the answer's main points on a light background.
No marketing copy, no logo.`,
  medium: `Create a Medium header image for {title}.

Abstract or typographic, relating to the article's theme.
No text other than the title. Keep the centre clear because Medium crops headers.`,
  reddit: `Only if {subreddit} allows image posts.

A plain, informative graphic such as a checklist or simple diagram.
No logo, no signature line, no promotional wording.`,
};

export const DEFAULT_RULES: Record<PlatformId, OutputRules> = {
  fb: { length: "Short (40–120 words)", hashtags: "None", emoji: "Sparingly", voice: "Brand (we)", cta: "In post body", variants: 1 },
  ig: { length: "Medium (80–150 words)", hashtags: "3–5", emoji: "Sparingly", voice: "Brand (we)", cta: "Link in bio", variants: 1 },
  lip: { length: "Medium (120–220 words)", hashtags: "None", emoji: "None", voice: "First person (I)", cta: "First comment", variants: 1 },
  lic: { length: "Short (60–150 words)", hashtags: "1–3", emoji: "None", voice: "Brand (we)", cta: "In post body", variants: 1 },
  quora: { length: "Long (250–500 words)", hashtags: "None", emoji: "None", voice: "First person (I)", cta: "In post body", variants: 1 },
  medium: { length: "Long (800–1,500 words)", hashtags: "Up to 5 topics", emoji: "None", voice: "First person (I)", cta: "In post body", variants: 1 },
  reddit: { length: "Medium (150–300 words)", hashtags: "None", emoji: "None", voice: "First person (I)", cta: "No link", variants: 1 },
};

const INK = "#1B1A17";
const CLAY = "#A8461F";
const IVORY = "#F4F1EA";
const WHITE = "#FFFFFF";

export const DEFAULT_IMAGE_DEFAULTS: Record<PlatformId, ImageDefaults> = {
  fb: { sizeKey: "1080x1350", bgHex: INK, fgHex: IVORY, generator: "builtin", style: "Typographic", format: "Single image", include: { logo: true, sig: true, headline: true } },
  ig: { sizeKey: "1080x1350", bgHex: CLAY, fgHex: WHITE, generator: "builtin", style: "Typographic", format: "Carousel", include: { logo: true, sig: true, headline: true } },
  lip: { sizeKey: "1080x1350", bgHex: IVORY, fgHex: INK, generator: "builtin", style: "Typographic", format: "Single image", include: { logo: false, sig: true, headline: true } },
  lic: { sizeKey: "1200x627", bgHex: INK, fgHex: IVORY, generator: "builtin", style: "Typographic", format: "Single image", include: { logo: true, sig: true, headline: true } },
  quora: { sizeKey: "1200x630", bgHex: WHITE, fgHex: INK, generator: "builtin", style: "Diagram / checklist", format: "Single image", include: { logo: false, sig: false, headline: true } },
  medium: { sizeKey: "1400x788", bgHex: IVORY, fgHex: INK, generator: "builtin", style: "Illustration", format: "Single image", include: { logo: false, sig: false, headline: true } },
  reddit: { sizeKey: "1200x900", bgHex: WHITE, fgHex: INK, generator: "builtin", style: "Diagram / checklist", format: "Single image", include: { logo: false, sig: false, headline: true } },
};

export const BRAND_IMAGE_DEFAULTS: ImageDefaults = {
  sizeKey: "1080x1350",
  bgHex: INK,
  fgHex: IVORY,
  generator: "builtin",
  style: "Typographic",
  format: "Single image",
  include: { logo: true, sig: true, headline: true },
};

export const SEED_BACKGROUNDS = [
  { id: "ink", name: "Ink", hex: INK, isDefault: true },
  { id: "clay", name: "Clay", hex: CLAY },
  { id: "ivory", name: "Ivory", hex: IVORY },
  { id: "white", name: "White", hex: WHITE },
];

export const SEED_TEXT_COLORS = [
  { id: "ivory", name: "Ivory", hex: IVORY },
  { id: "ink", name: "Ink", hex: INK },
  { id: "clay", name: "Clay", hex: CLAY },
  { id: "white", name: "White", hex: WHITE },
];

export const DEFAULT_WINDOWS: Record<PlatformId, { days: number[]; startMin: number; endMin: number }> = {
  lip: { days: [1, 2, 3], startMin: 8 * 60 + 30, endMin: 10 * 60 + 30 },
  lic: { days: [1, 2, 3], startMin: 11 * 60, endMin: 13 * 60 },
  fb: { days: [0, 1, 2, 3, 4], startMin: 12 * 60, endMin: 14 * 60 },
  ig: { days: [0, 1, 2, 3, 4, 5], startMin: 17 * 60 + 30, endMin: 19 * 60 + 30 },
  reddit: { days: [0, 1, 2], startMin: 15 * 60, endMin: 17 * 60 },
  quora: { days: [0, 1, 2, 3, 4], startMin: 10 * 60, endMin: 12 * 60 },
  medium: { days: [1, 2, 3], startMin: 9 * 60, endMin: 11 * 60 },
};

export function rulesToSentences(r: OutputRules): string {
  const out: string[] = ["OUTPUT RULES:"];
  out.push(`- Target length: ${r.length}.`);
  const tags = r.hashtags;
  if (/^none$/i.test(tags)) out.push("- Do not use hashtags.");
  else out.push(`- Hashtags: ${tags}.`);
  if (/^none$/i.test(r.emoji)) out.push("- Do not use emoji.");
  else if (/sparingly/i.test(r.emoji)) out.push("- Emoji: at most one or two, only where they aid scanning.");
  else out.push("- Emoji are welcome where they fit the tone.");
  out.push(r.voice.startsWith("First") ? '- Write in the first person singular ("I").' : '- Write as the brand ("we").');
  const cta: Record<string, string> = {
    "In post body": "- Put the link and call to action in the post body.",
    "First comment": '- Do not put the link in the body; put it in "first_comment" and say it is in the first comment.',
    "Link in bio": '- Do not put a URL in the body; say "link in bio".',
    "No link": "- Do not include a link in the body. Offer it in comments only if the community rules allow.",
  };
  out.push(cta[r.cta] ?? `- Link / CTA placement: ${r.cta}.`);
  return out.join("\n");
}
