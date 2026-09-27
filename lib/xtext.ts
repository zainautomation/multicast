// X (Twitter) weighted length, following twitter-text v3 defaults: max weight 280, each URL
// counts as 23, code points in the "light" ranges count 1, everything else (CJK, most
// emoji, many symbols) counts 2. Client-safe. [verify] against X's current counting rules.

const LIGHT_RANGES: [number, number][] = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];
const URL_RE = /\bhttps?:\/\/[^\s<>"]+|\bwww\.[^\s<>"]+\.[^\s<>"]+/gi;
export const X_LIMIT = 280;
export const X_URL_WEIGHT = 23;

function weightOf(cp: number) {
  return LIGHT_RANGES.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2;
}

/** Weighted length of a post as X counts it. */
export function xLength(text: string): number {
  let total = 0;
  const withoutUrls = text.replace(URL_RE, () => {
    total += X_URL_WEIGHT;
    return "";
  });
  // Emoji sequences (ZWJ, skin tones, variation selectors) count once, as 2.
  const seg = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  const graphemes = seg ? [...seg.segment(withoutUrls)].map((s) => s.segment) : [...withoutUrls];
  for (const g of graphemes) {
    const cps = [...g].map((c) => c.codePointAt(0)!);
    const isEmoji = /\p{Extended_Pictographic}/u.test(g);
    total += isEmoji ? 2 : cps.reduce((s, cp) => s + weightOf(cp), 0);
  }
  return total;
}
