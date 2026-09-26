import { marked } from "marked";

// Long-form exports (blog, Medium). Client-safe: no Node APIs.

export type LongFormDraft = {
  title: string | null;
  subtitle: string | null; // meta description (blog) / subtitle (Medium)
  slug: string | null;
  body: string | null;
  hashtags: string[];
};

const yamlString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`;

export function wordCount(text: string | null | undefined): number {
  const t = (text ?? "").replace(/[#>*_`~\-[\]()!|]/g, " ").trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Markdown with YAML front matter (works with Hugo, Jekyll, Astro, Next.js MDX, Ghost import…). */
export function toMarkdown(d: LongFormDraft, opts: { imageUrl?: string | null; descriptionKey?: string } = {}): string {
  const fm: string[] = ["---"];
  if (d.title) fm.push(`title: ${yamlString(d.title)}`);
  if (d.subtitle) fm.push(`${opts.descriptionKey ?? "description"}: ${yamlString(d.subtitle)}`);
  if (d.slug) fm.push(`slug: ${yamlString(d.slug)}`);
  if (d.hashtags.length) fm.push(`tags: [${d.hashtags.map(yamlString).join(", ")}]`);
  if (opts.imageUrl) fm.push(`image: ${yamlString(opts.imageUrl)}`);
  fm.push(`date: ${new Date().toISOString().slice(0, 10)}`, "---", "");
  return fm.join("\n") + "\n" + (d.body ?? "").trim() + "\n";
}

/** Article body as HTML, for pasting into a CMS's HTML/code view. */
export function toHtml(d: LongFormDraft, opts: { includeTitle?: boolean; imageUrl?: string | null } = {}): string {
  const parts: string[] = [];
  if (opts.includeTitle && d.title) parts.push(`<h1>${escapeHtml(d.title)}</h1>`);
  if (opts.imageUrl) parts.push(`<p><img src="${escapeHtml(opts.imageUrl)}" alt="${escapeHtml(d.title ?? "")}" /></p>`);
  parts.push(marked.parse(d.body ?? "", { async: false, gfm: true }) as string);
  return parts.join("\n");
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
