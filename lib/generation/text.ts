import type Anthropic from "@anthropic-ai/sdk";
import { callTool } from "@/lib/claude";
import { assembleTextPrompt, RETURN_DRAFT_TOOL, type BriefInput, type DraftOutput } from "@/lib/prompts/assemble";
import type { Layer } from "@/lib/prompts/layers";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";
import { linkPolicyFromRules, validateDraft, type Validation } from "@/lib/generation/validate";
import type { Creativity } from "@/lib/models";

export type TextResult = {
  output: DraftOutput;
  variants: DraftOutput[];
  validation: Validation;
  repaired: boolean;
  usage: { model: string; kind: "draft" | "repair"; tokensIn: number; tokensOut: number }[];
};

export type GenContext = {
  client: Anthropic;
  draftModel: string;
  checkerModel: string;
  creativity: Creativity;
  brandLayer: Layer;
  bannedPhrases: string[];
};

function normalise(o: DraftOutput, platform: PlatformId): DraftOutput {
  const p = PLATFORMS[platform];
  return {
    title: p.title ? (o.title ?? "").trim() || null : null,
    subtitle: platform === "medium" ? (o.subtitle ?? "").trim() || null : null,
    body: (o.body ?? "").replace(/\r\n/g, "\n").trim(),
    first_comment: o.first_comment?.trim() || null,
    hashtags: Array.from(new Set((o.hashtags ?? []).map((h) => h.replace(/^#/, "").trim()).filter(Boolean))),
    visual_brief: o.visual_brief ?? null,
    placeholders: o.placeholders ?? [],
  };
}

export function validateOutput(platform: PlatformId, o: DraftOutput, layer: Layer, bannedPhrases: string[], link?: string | null) {
  return validateDraft(
    platform,
    { title: o.title, body: o.body, firstComment: o.first_comment, hashtags: o.hashtags },
    { bannedPhrases, linkPolicy: linkPolicyFromRules(layer.rules.cta, PLATFORMS[platform].linkPolicy), link, hashtagRule: layer.rules.hashtags },
  );
}

async function repair(ctx: GenContext, platform: PlatformId, system: string, draft: DraftOutput, errors: string[]) {
  const user = [
    "This draft breaks platform rules. Fix exactly these violations and change nothing else:",
    ...errors.map((e) => `- ${e}`),
    "",
    "DRAFT (JSON):",
    JSON.stringify(draft, null, 2),
    "",
    "Return the corrected draft with the return_draft tool.",
  ].join("\n");
  return callTool<DraftOutput>({ client: ctx.client, model: ctx.checkerModel, system, user, tool: RETURN_DRAFT_TOOL as Anthropic.Tool, creativity: "precise" });
}

/** Generate one platform's draft: N variants, validate the first, one repair call on failure. */
export async function generateText(ctx: GenContext, platform: PlatformId, layer: Layer, brief: BriefInput): Promise<TextResult> {
  const { system, user } = assembleTextPrompt({
    platform,
    brandVoice: ctx.brandLayer.textPrompt,
    platformPrompt: layer.textPrompt,
    rules: layer.rules,
    bannedPhrases: ctx.bannedPhrases,
    brief,
  });
  const n = Math.min(3, Math.max(1, layer.rules.variants || 1));
  const usage: TextResult["usage"] = [];
  const runs = await Promise.all(
    Array.from({ length: n }, () =>
      callTool<DraftOutput>({ client: ctx.client, model: ctx.draftModel, system, user, tool: RETURN_DRAFT_TOOL as Anthropic.Tool, creativity: ctx.creativity }),
    ),
  );
  for (const r of runs) usage.push({ model: r.model, kind: "draft", tokensIn: r.tokensIn, tokensOut: r.tokensOut });
  const outputs = runs.map((r) => normalise(r.input, platform));

  // Prefer the first variant that already passes.
  const checked = outputs.map((o) => ({ o, v: validateOutput(platform, o, layer, ctx.bannedPhrases, brief.link) }));
  const passing = checked.findIndex((c) => c.v.errors.length === 0);
  const pick = passing >= 0 ? passing : 0;
  let output = checked[pick].o;
  let validation = checked[pick].v;
  let repaired = false;

  if (validation.errors.length) {
    const fixed = await repair(ctx, platform, system, output, validation.errors);
    usage.push({ model: fixed.model, kind: "repair", tokensIn: fixed.tokensIn, tokensOut: fixed.tokensOut });
    const candidate = normalise(fixed.input, platform);
    const v2 = validateOutput(platform, candidate, layer, ctx.bannedPhrases, brief.link);
    repaired = true;
    if (v2.errors.length < validation.errors.length || v2.errors.length === 0) {
      output = candidate;
      validation = v2;
    }
  }
  const variants = outputs.filter((_, i) => i !== pick);
  return { output, variants, validation, repaired, usage };
}
