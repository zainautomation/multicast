import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colours must be #RRGGBB");
const Color = z.object({ id: z.string().max(40), name: z.string().trim().min(1).max(40), hex, hex2: hex.nullable().optional(), isDefault: z.boolean().optional() });

export const BrandPatch = z.object({
  logoPosition: z.enum(["tl", "tr", "bl", "br"]).optional(),
  logoSize: z.enum(["S", "M", "L"]).optional(),
  autoReverse: z.boolean().optional(),
  sigCompany: z.string().max(200).optional(),
  sigPersonal: z.string().max(200).optional(),
  sigPlacement: z.enum(["opposite", "center", "top"]).optional(),
  sigSize: z.enum(["S", "M", "L"]).optional(),
  backgrounds: z.array(Color).min(1).max(16).optional(),
  textColors: z.array(Color.omit({ hex2: true, isDefault: true })).min(1).max(16).optional(),
  headlineFont: z.string().max(80).optional(),
  bodyFont: z.string().max(80).optional(),
  bannedPhrases: z.array(z.string().trim().min(1).max(60)).max(200).optional(),
});
