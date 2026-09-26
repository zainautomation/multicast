import { describe, expect, it } from "vitest";
import { findSize, hardLimitsBlock, PLATFORMS } from "@/lib/platforms";
import { slugify, validateDraft } from "@/lib/generation/validate";
import { assembleTextPrompt } from "@/lib/prompts/assemble";
import { DEFAULT_RULES, DEFAULT_TEXT_PROMPTS } from "@/lib/prompts/defaults";
import { normalise } from "@/lib/generation/text";
import { toHtml, toMarkdown, wordCount } from "@/lib/export";

const body = "Hiring abroad is hard.\n\n## Key takeaways\n\n- One\n- Two\n\n## Contracts\n\nUse a local contract. Read more at https://acme.test/guide";

describe("blog platform", () => {
  it("is configured as long-form copy mode with an OG default size", () => {
    expect(PLATFORMS.blog.publish.kind).toBe("copy");
    expect(PLATFORMS.blog.longForm).toBe(true);
    expect(findSize("blog")).toMatchObject({ w: 1200, h: 630 });
  });
  it("tells Claude about the meta description, slug, tags and Markdown", () => {
    const h = hardLimitsBlock("blog");
    expect(h).toContain("at most 70 characters");
    expect(h).toContain("meta description");
    expect(h).toContain("at most 160 characters");
    expect(h).toContain('"slug"');
    expect(h).toContain("do not write hashtags in the body");
    expect(h).toContain("Markdown");
  });
  it("passes the target keyword to the prompt", () => {
    const { system, user } = assembleTextPrompt({
      platform: "blog",
      brandVoice: DEFAULT_TEXT_PROMPTS.brand,
      platformPrompt: DEFAULT_TEXT_PROMPTS.blog,
      rules: DEFAULT_RULES.blog,
      bannedPhrases: [],
      brief: { text: "Guide", goal: "Traffic / downloads", tone: "Use platform default", keyword: "hire remote engineers" },
    });
    expect(system).toContain("Target keyword: hire remote engineers");
    expect(user).toContain("TARGET KEYWORD: hire remote engineers");
  });
});

describe("blog validation", () => {
  const ok = { title: "How to hire remote engineers", subtitle: "A practical guide to contracts, compliance and payroll when you hire engineers in another country.", slug: "hire-remote-engineers", body, hashtags: ["hiring", "remote"] };
  it("accepts a well-formed post (Markdown headings are not hashtags)", () => {
    expect(validateDraft("blog", ok).errors).toEqual([]);
  });
  it("rejects an over-long meta description and SEO title", () => {
    const v = validateDraft("blog", { ...ok, subtitle: "x".repeat(161), title: "t".repeat(71) });
    expect(v.errors.join(" ")).toMatch(/Meta description is 161 characters; the limit is 160/);
    expect(v.errors.join(" ")).toMatch(/SEO title is 71 characters; the limit is 70/);
  });
  it("caps tags at 8 and checks the slug", () => {
    const v = validateDraft("blog", { ...ok, hashtags: Array.from({ length: 9 }, (_, i) => `t${i}`), slug: "Bad Slug!" });
    expect(v.errors.join(" ")).toMatch(/9 tags; the maximum is 8/);
    expect(v.errors.join(" ")).toMatch(/slug may only use/);
  });
  it("notes a missing meta description without blocking", () => {
    const v = validateDraft("blog", { ...ok, subtitle: "" });
    expect(v.errors).toEqual([]);
    expect(v.notes.join(" ")).toMatch(/meta description/);
  });
  it("normalises the slug from the model or the title", () => {
    expect(normalise({ title: "Hiring Remote Engineers: A Guide!", body: "b", slug: null }, "blog").slug).toBe("hiring-remote-engineers-a-guide");
    expect(normalise({ title: "T", body: "b", slug: "My Slug" }, "blog").slug).toBe("my-slug");
    expect(normalise({ title: null, body: "b", slug: "x" }, "fb").slug).toBeNull();
    expect(slugify("Café & Crème")).toBe("cafe-creme");
  });
});

describe("blog export", () => {
  const d = { title: 'Hiring "remote" engineers', subtitle: "A guide.", slug: "hiring-remote-engineers", body, hashtags: ["hiring", "remote"] };
  it("writes Markdown with YAML front matter", () => {
    const md = toMarkdown(d, { imageUrl: "https://cdn.test/h.png" });
    expect(md).toMatch(/^---\ntitle: "Hiring \\"remote\\" engineers"\ndescription: "A guide."\nslug: "hiring-remote-engineers"\ntags: \["hiring", "remote"\]\nimage: "https:\/\/cdn.test\/h.png"\ndate: \d{4}-\d{2}-\d{2}\n---\n\nHiring abroad/);
  });
  it("renders HTML with headings and lists", () => {
    const html = toHtml(d);
    expect(html).toContain("<h2>Key takeaways</h2>");
    expect(html).toContain("<li>One</li>");
  });
  it("counts words, ignoring Markdown syntax", () => {
    expect(wordCount("## Title\n\n- one two\n- **three**")).toBe(4);
  });
});
