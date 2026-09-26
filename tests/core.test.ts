import { describe, expect, it, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { contrastRatio, contrastVerdict, ensureContrast, isDark } from "@/lib/contrast";
import { countHashtags, findBanned, hashtagMaxFromRule, validateDraft } from "@/lib/generation/validate";
import { assembleTextPrompt, extractLink, substitute } from "@/lib/prompts/assemble";
import { DEFAULT_RULES, DEFAULT_TEXT_PROMPTS } from "@/lib/prompts/defaults";
import { findSize, hardLimitsBlock, normalizeSubreddit, PLATFORM_IDS, PLATFORMS } from "@/lib/platforms";
import { reminderTime, suggestMany, suggestSlot } from "@/lib/schedule/suggest";
import { windowLabel, zonedParts, zonedToUtc } from "@/lib/schedule/time";
import { toLittleText } from "@/lib/publishers/linkedin";
import { costMicroUsd, modelInfo } from "@/lib/models";

describe("platform config", () => {
  it("has all 8 platforms with a default size", () => {
    expect(PLATFORM_IDS).toHaveLength(8);
    for (const id of PLATFORM_IDS) expect(PLATFORMS[id].sizes.length).toBeGreaterThan(0);
  });
  it("defaults Instagram to 1080 × 1350", () => {
    expect(findSize("ig")).toMatchObject({ w: 1080, h: 1350 });
  });
  it("accepts custom sizes and clamps them", () => {
    expect(findSize("fb", "900x9000")).toMatchObject({ w: 900, h: 4000, label: "Custom" });
  });
  it("renders a hard limits block with the Instagram hashtag cap", () => {
    expect(hardLimitsBlock("ig")).toContain("At most 5 hashtags");
    expect(hardLimitsBlock("lip")).toContain("first_comment");
  });
  it("normalises subreddit names", () => {
    expect(normalizeSubreddit("startups")).toBe("r/startups");
    expect(normalizeSubreddit("/r/startups/")).toBe("r/startups");
  });
});

describe("contrast", () => {
  it("matches WCAG reference values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(contrastVerdict("#1B1A17", "#F4F1EA").level).toBe("pass");
    expect(contrastVerdict("#F4F1EA", "#FFFFFF").level).toBe("fail");
  });
  it("detects dark backgrounds below luminance 0.4", () => {
    expect(isDark("#1B1A17")).toBe(true);
    expect(isDark("#F4F1EA")).toBe(false);
  });
  it("falls back to the best kit colour when a pair fails", () => {
    const r = ensureContrast("#F4F1EA", "#FFFFFF", ["#F4F1EA", "#1B1A17", "#A8461F", "#FFFFFF"]);
    expect(r.fellBack).toBe(true);
    expect(r.fg).toBe("#1B1A17");
    expect(r.ratio).toBeGreaterThanOrEqual(4.5);
  });
});

describe("validators", () => {
  it("counts unique hashtags across body and array", () => {
    expect(countHashtags("Hi #a #b\n#a", ["c", "#b"])).toBe(3);
  });
  it("rejects more than 5 Instagram hashtags", () => {
    const v = validateDraft("ig", { body: "Hook\n\n#a #b #c #d #e #f", hashtags: [] });
    expect(v.errors.join(" ")).toMatch(/6 hashtags; the maximum is 5/);
  });
  it("enforces the output-rule hashtag setting", () => {
    const v = validateDraft("fb", { body: "Post #tag" }, { hashtagRule: "None" });
    expect(v.errors.length).toBe(1);
    expect(hashtagMaxFromRule("1–3")).toBe(3);
  });
  it("rejects over-limit bodies", () => {
    const v = validateDraft("lip", { body: "x".repeat(3001) });
    expect(v.errors[0]).toMatch(/limit is 3,000/);
  });
  it("blocks links in the LinkedIn Profile body (first comment rule)", () => {
    const v = validateDraft("lip", { body: "Read it here: https://example.com" });
    expect(v.errors.join(" ")).toMatch(/first comment/);
    expect(validateDraft("lip", { body: "Link in the first comment." }).errors).toHaveLength(0);
  });
  it("requires a Reddit title under 300 characters", () => {
    expect(validateDraft("reddit", { body: "b", title: "" }).errors.join(" ")).toMatch(/Title is required/);
    expect(validateDraft("reddit", { body: "b", title: "t".repeat(301) }).errors.join(" ")).toMatch(/limit is 300/);
  });
  it("finds banned phrases as whole words", () => {
    expect(findBanned("A revolutionary idea", ["revolutionary"])).toEqual(["revolutionary"]);
    expect(findBanned("seamlessly", ["seamless"])).toEqual([]);
  });
  it("notes placeholders without blocking", () => {
    const v = validateDraft("fb", { body: "Grab it: [YOUR LINK]" });
    expect(v.errors).toHaveLength(0);
    expect(v.notes[0]).toContain("[YOUR LINK]");
  });
});

describe("prompt assembly", () => {
  it("substitutes variables and marks empty ones", () => {
    expect(substitute("for {subreddit}", { subreddit: "r/x" })).toBe("for r/x");
    expect(substitute("for {subreddit}", { subreddit: null })).toBe("for [no subreddit]");
    expect(substitute("{unknown}", {})).toBe("{unknown}");
  });
  it("extracts the link from the brief", () => {
    expect(extractLink("Guide out now.\nLink: https://x.test/guide")).toBe("https://x.test/guide");
    expect(extractLink("see https://a.test/b.")).toBe("https://a.test/b.");
    expect(extractLink("no link")).toBeNull();
  });
  it("layers brand voice, platform prompt, hard limits and rules", () => {
    const { system, user } = assembleTextPrompt({
      platform: "reddit",
      brandVoice: DEFAULT_TEXT_PROMPTS.brand,
      platformPrompt: DEFAULT_TEXT_PROMPTS.reddit,
      rules: DEFAULT_RULES.reddit,
      bannedPhrases: ["synergy"],
      brief: { text: "Guide", goal: "Awareness", tone: "Bold", subreddit: "r/startups", subredditRules: "1. No spam" },
    });
    expect(system.indexOf("You write social content")).toBeLessThan(system.indexOf("PLATFORM: Reddit"));
    expect(system).toContain("Write a Reddit text post for r/startups");
    expect(system).toContain("1. No spam");
    expect(system).toContain("HARD LIMITS");
    expect(system).toContain("BANNED PHRASES (never use): synergy");
    expect(user).toContain("TONE OVERRIDE: Bold");
    expect(user).toContain("SUBREDDIT RULES:\n1. No spam");
  });
});

describe("scheduling", () => {
  const tz = "Europe/London";
  it("converts zoned wall time to UTC across DST", () => {
    expect(zonedToUtc(2026, 7, 1, 9, 0, tz).toISOString()).toBe("2026-07-01T08:00:00.000Z"); // BST
    expect(zonedToUtc(2026, 12, 1, 9, 0, tz).toISOString()).toBe("2026-12-01T09:00:00.000Z"); // GMT
    expect(zonedParts(new Date("2026-09-29T08:00:00Z"), tz)).toMatchObject({ h: 9, weekday: 1 });
  });
  const win = { days: [1, 2, 3], startMin: 8 * 60 + 30, endMin: 10 * 60 + 30 }; // Tue–Thu 08:30–10:30
  it("suggests the next slot inside the window, not in the past", () => {
    const now = new Date("2026-09-28T12:00:00Z"); // Mon 13:00 London
    const s = suggestSlot({ window: win, tz, now, taken: [] })!;
    expect(s.toISOString()).toBe("2026-09-29T07:30:00.000Z"); // Tue 08:30 BST
  });
  it("keeps ≥ 3 h between posts on the same account", () => {
    const now = new Date("2026-09-28T12:00:00Z");
    const taken = [new Date("2026-09-29T07:30:00Z")];
    const s = suggestSlot({ window: win, tz, now, taken })!;
    // Tue 08:30–10:30 is all within 3 h of the taken slot, so Wednesday 08:30
    expect(s.toISOString()).toBe("2026-09-30T07:30:00.000Z");
  });
  it("suggestMany spaces drafts for the same platform", () => {
    const now = new Date("2026-09-28T12:00:00Z");
    const r = suggestMany(
      [
        { id: "a", platform: "lip" },
        { id: "b", platform: "lip" },
      ],
      { windows: { lip: win }, tz, now, takenByPlatform: {} },
    );
    expect(r.a!.getTime()).not.toBe(r.b!.getTime());
    expect(Math.abs(r.a!.getTime() - r.b!.getTime())).toBeGreaterThanOrEqual(3 * 3600_000);
  });
  it("computes reminder lead times including 'morning of'", () => {
    const run = new Date("2026-09-29T13:00:00Z"); // 14:00 BST
    expect(reminderTime(run, 15, tz).toISOString()).toBe("2026-09-29T12:45:00.000Z");
    expect(reminderTime(run, -1, tz).toISOString()).toBe("2026-09-29T07:00:00.000Z"); // 08:00 BST
  });
  it("labels windows like the design", () => {
    expect(windowLabel([1, 2, 3], 510, 630)).toBe("Tue–Thu · 08:30–10:30");
  });
});

describe("LinkedIn little text", () => {
  it("escapes reserved characters and templates hashtags", () => {
    expect(toLittleText("Hi (all) #GlobalHiring")).toBe("Hi \\(all\\) {hashtag|\\#|GlobalHiring}");
  });
});

describe("models", () => {
  it("knows per-model request capabilities", () => {
    expect(modelInfo("claude-opus-5-5").forcedToolChoice).toBe(false);
    expect(modelInfo("claude-sonnet-5").supportsTemperature).toBe(false);
    expect(modelInfo("claude-haiku-4-5-20251001").supportsTemperature).toBe(true);
  });
  it("estimates cost in micro-dollars", () => {
    expect(costMicroUsd("claude-sonnet-5", 1_000_000, 0)).toBe(2_000_000);
  });
});

describe("crypto", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });
  it("round-trips with unique IVs", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto");
    const a = encrypt("sk-ant-secret");
    const b = encrypt("sk-ant-secret");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("sk-ant-secret");
    // Tamper with a middle character of the ciphertext (the last base64 char can be pure padding bits).
    const parts = a.split(".");
    const ct = parts[6];
    const mid = Math.floor(ct.length / 2);
    parts[6] = ct.slice(0, mid) + (ct[mid] === "A" ? "B" : "A") + ct.slice(mid + 1);
    expect(() => decrypt(parts.join("."))).toThrow();
  });
});
