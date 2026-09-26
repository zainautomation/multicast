import { z } from "zod";
import { FORMAT_OPTIONS, STYLE_OPTIONS } from "@/lib/prompts/defaults";

export const LAYER_IDS = ["brand", "fb", "ig", "lip", "lic", "quora", "medium", "blog", "reddit"] as const;

export const RulesPatch = z
  .object({
    length: z.string().max(80),
    hashtags: z.string().max(40),
    emoji: z.string().max(40),
    voice: z.string().max(40),
    cta: z.string().max(40),
    variants: z.number().int().min(1).max(3),
  })
  .partial();

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const ImageDefaultsPatch = z
  .object({
    sizeKey: z.string().regex(/^\d{2,4}x\d{2,4}$/),
    bgHex: hex,
    fgHex: hex,
    generator: z.enum(["builtin", "canva", "figma", "higgsfield", "custom"]),
    style: z.enum(STYLE_OPTIONS as [string, ...string[]]),
    format: z.enum(FORMAT_OPTIONS as [string, ...string[]]),
    include: z.object({ logo: z.boolean(), sig: z.boolean(), headline: z.boolean() }).partial(),
  })
  .partial();

export const LayerPatch = z.object({
  textPrompt: z.string().max(20_000).optional(),
  imagePrompt: z.string().max(20_000).optional(),
  rules: RulesPatch.optional(),
  imageDefaults: ImageDefaultsPatch.optional(),
  enabled: z.boolean().optional(),
});
