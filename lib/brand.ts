import type { BrandKit } from "@prisma/client";
import { db } from "@/lib/db";
import type { CustomFont } from "@/lib/render/fonts";

export type BrandColor = { id: string; name: string; hex: string; hex2?: string | null; isDefault?: boolean };

export type Brand = {
  logos: { primary: string | null; reverse: string | null; icon: string | null };
  logoPosition: "tl" | "tr" | "bl" | "br";
  logoSize: "S" | "M" | "L";
  autoReverse: boolean;
  sigCompany: string;
  sigPersonal: string;
  sigPlacement: "opposite" | "center" | "top";
  sigSize: "S" | "M" | "L";
  backgrounds: BrandColor[];
  textColors: BrandColor[];
  headlineFont: string;
  bodyFont: string;
  customFonts: CustomFont[];
  bannedPhrases: string[];
};

export function toBrand(k: BrandKit): Brand {
  return {
    logos: { primary: k.logoPrimaryUrl, reverse: k.logoReverseUrl, icon: k.logoIconUrl },
    logoPosition: (k.logoPosition as Brand["logoPosition"]) ?? "tl",
    logoSize: (k.logoSize as Brand["logoSize"]) ?? "M",
    autoReverse: k.autoReverse,
    sigCompany: k.sigCompany ?? "",
    sigPersonal: k.sigPersonal ?? "",
    sigPlacement: (k.sigPlacement as Brand["sigPlacement"]) ?? "opposite",
    sigSize: (k.sigSize as Brand["sigSize"]) ?? "S",
    backgrounds: (k.backgrounds as unknown as BrandColor[]) ?? [],
    textColors: (k.textColors as unknown as BrandColor[]) ?? [],
    headlineFont: k.headlineFont,
    bodyFont: k.bodyFont,
    customFonts: (k.customFonts as unknown as CustomFont[]) ?? [],
    bannedPhrases: k.bannedPhrases,
  };
}

export async function loadBrand(workspaceId: string): Promise<Brand> {
  const k = await db.brandKit.findUniqueOrThrow({ where: { workspaceId } });
  return toBrand(k);
}

/** Which signature a platform uses (spec §7). */
export function signatureFor(platform: string, b: Brand): string {
  if (platform === "lip" || platform === "medium") return b.sigPersonal;
  return b.sigCompany;
}

const POS = { tl: "top-left", tr: "top-right", bl: "bottom-left", br: "bottom-right" } as const;

export function logoPositionLabel(p: Brand["logoPosition"]) {
  return POS[p];
}

export function brandSummary(b: Brand, platform: string): string {
  return [
    "BRAND KIT:",
    `- Logo: ${b.logos.primary || b.logos.reverse ? `uploaded, placed ${POS[b.logoPosition]}` : "not uploaded"}`,
    `- Signature line: "${signatureFor(platform, b) || "(none)"}"`,
    `- Backgrounds: ${b.backgrounds.map((c) => `${c.name} ${c.hex}${c.hex2 ? `→${c.hex2}` : ""}`).join(", ")}`,
    `- Text colours: ${b.textColors.map((c) => `${c.name} ${c.hex}`).join(", ")}`,
    `- Headline font: ${b.headlineFont}; body font: ${b.bodyFont}`,
  ].join("\n");
}
