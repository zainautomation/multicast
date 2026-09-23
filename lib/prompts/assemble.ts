import { PLATFORMS, hardLimitsBlock, type PlatformId } from "@/lib/platforms";
import { rulesToSentences, type OutputRules } from "@/lib/prompts/defaults";

export type BriefInput = {
  text: string;
  goal: string;
  tone: string;
  link?: string | null;
  subreddit?: string | null;
  subredditRules?: string | null;
};

export const GOALS = ["Traffic / downloads", "Awareness", "Engagement", "Leads"];
export const TONES = ["Use platform default", "Professional", "Conversational", "Bold"];

/** Replace {variables}. Unknown variables are left as-is so a typo is visible in "Test". */
export function substitute(template: string, vars: Record<string, string | null | undefined>): string {
  return template.replace(/\{([a-z_]+)\}/g, (m, k: string) => {
    const v = vars[k];
    return v === undefined || v === null || v === "" ? (k in vars ? `[no ${k.replace(/_/g, " ")}]` : m) : v;
  });
}

/** Pull a link out of the brief ("Link: …" line or the first URL). */
export function extractLink(text: string): string | null {
  const line = text.match(/^\s*link\s*:\s*(\S+)/im);
  if (line) return line[1];
  const url = text.match(/https?:\/\/[^\s)>\]]+/i);
  return url ? url[0] : null;
}

export function briefVars(b: BriefInput, brandVoice: string): Record<string, string | null> {
  return {
    brief: b.text,
    goal: b.goal,
    tone: b.tone === TONES[0] ? "platform default" : b.tone,
    link: b.link ?? null,
    subreddit: b.subreddit ?? null,
    subreddit_rules: b.subredditRules ?? null,
    brand_voice: brandVoice,
  };
}

export function assembleTextPrompt(opts: {
  platform: PlatformId;
  brandVoice: string;
  platformPrompt: string;
  rules: OutputRules;
  bannedPhrases: string[];
  brief: BriefInput;
}): { system: string; user: string } {
  const vars = briefVars(opts.brief, opts.brandVoice);
  const p = PLATFORMS[opts.platform];
  const sections = [
    substitute(opts.brandVoice, vars),
    `PLATFORM: ${p.name}\n\n${substitute(opts.platformPrompt, vars)}`,
    hardLimitsBlock(opts.platform),
    rulesToSentences(opts.rules),
  ];
  if (opts.bannedPhrases.length) sections.push(`BANNED PHRASES (never use): ${opts.bannedPhrases.join(", ")}.`);

  const user: string[] = [`BRIEF:\n${opts.brief.text.trim()}`, `GOAL: ${opts.brief.goal}`];
  if (opts.brief.tone && opts.brief.tone !== TONES[0]) user.push(`TONE OVERRIDE: ${opts.brief.tone}. This overrides the platform's usual tone.`);
  user.push(`LINK: ${opts.brief.link ?? "[YOUR LINK] (no link given; use this placeholder where a link belongs)"}`);
  if (opts.platform === "reddit") {
    user.push(`SUBREDDIT: ${opts.brief.subreddit ?? "[SUBREDDIT]"}`);
    user.push(`SUBREDDIT RULES:\n${opts.brief.subredditRules ?? "(rules could not be fetched; be conservative: no self-promotion, disclose affiliation)"}`);
  }
  user.push(`Write the ${p.name} draft now and return it with the return_draft tool.`);
  return { system: sections.join("\n\n---\n\n"), user: user.join("\n\n") };
}

/** The forced tool that makes every draft valid JSON (spec 9.3), strict-compatible. */
export const RETURN_DRAFT_TOOL = {
  name: "return_draft",
  description: "Return the finished platform draft.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    required: ["title", "subtitle", "body", "first_comment", "hashtags", "visual_brief", "placeholders"],
    properties: {
      title: { type: ["string", "null"], description: "Quora question, Medium title or Reddit title; null if the platform has no title." },
      subtitle: { type: ["string", "null"], description: "Medium subtitle; null elsewhere." },
      body: { type: "string", description: "The post body with line breaks preserved." },
      first_comment: { type: ["string", "null"], description: "Text for the first comment (e.g. the link), or null." },
      hashtags: { type: "array", items: { type: "string" } },
      visual_brief: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["format", "slides"],
            properties: {
              format: { type: "string", enum: ["single", "carousel"] },
              slides: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["headline", "subline"],
                  properties: { headline: { type: "string" }, subline: { type: ["string", "null"] } },
                },
              },
            },
          },
        ],
      },
      placeholders: { type: "array", items: { type: "string" } },
    },
  },
};

export type DraftOutput = {
  title: string | null;
  subtitle?: string | null;
  body: string;
  first_comment: string | null;
  hashtags: string[];
  visual_brief: { format: "single" | "carousel"; slides: { headline: string; subline: string | null }[] } | null;
  placeholders: string[];
};
