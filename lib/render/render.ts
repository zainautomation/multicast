import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { contrastRatio, ensureContrast, isDark } from "@/lib/contrast";
import { loadFonts } from "@/lib/render/fonts";
import { computeSizes, SlideTemplate, type Slide } from "@/lib/render/templates";
import { isLargeText } from "@/lib/render/layout";
import { readObject } from "@/lib/storage";
import { signatureFor, type Brand } from "@/lib/brand";

export type RenderInput = {
  platform: string;
  w: number;
  h: number;
  slides: Slide[];
  bgHex: string;
  bg2Hex?: string | null;
  fgHex: string;
  include: { logo: boolean; sig: boolean; headline: boolean };
  brand: Brand;
  format?: "png" | "jpeg";
  /** Optional full-bleed background (e.g. a Figma frame or Higgsfield image); text is overlaid. */
  bgImage?: Buffer | null;
};

export type RenderOutput = { images: Buffer[]; mime: string; warnings: string[]; fgUsed: string };

async function logoFor(brand: Brand, bg: string, warnings: string[]) {
  const dark = isDark(bg);
  const url = dark && brand.autoReverse ? brand.logos.reverse ?? brand.logos.primary : brand.logos.primary ?? brand.logos.reverse ?? brand.logos.icon;
  if (!url) {
    warnings.push("No logo uploaded in the brand kit, so the image has no logo.");
    return null;
  }
  try {
    const buf = await readObject(url);
    const isSvg = /\.svg(\?|$)/i.test(url) || buf.subarray(0, 200).toString("utf8").includes("<svg");
    const meta = await sharp(buf).metadata();
    const aspect = meta.width && meta.height ? meta.width / meta.height : 1;
    // Rasterise SVG logos to PNG so Satori/resvg treat all logos the same.
    const png = isSvg ? await sharp(buf, { density: 300 }).png().toBuffer() : buf;
    const mime = isSvg ? "image/png" : meta.format === "jpeg" ? "image/jpeg" : "image/png";
    return { src: `data:${mime};base64,${png.toString("base64")}`, aspect };
  } catch {
    warnings.push("The logo file could not be read, so the image has no logo.");
    return null;
  }
}

/** Render one image (or one per slide for carousels) at the exact pixel size. */
export async function renderSlides(input: RenderInput): Promise<RenderOutput> {
  const warnings: string[] = [];
  const { brand } = input;
  const palette = brand.textColors.map((c) => c.hex);

  // Contrast rule (spec §7): body-size text needs 4.5:1, text ≥ 24 px needs 3:1. With a
  // gradient, the weaker stop counts. On failure fall back to the best-contrast kit colour.
  const sizes = computeSizes({ w: input.w, h: input.h, platform: input.platform, slide: input.slides[0], sigSize: brand.sigSize });
  const smallestPx = Math.min(sizes.sub, sizes.item, input.include.sig ? sizes.sig : Infinity, input.include.headline ? sizes.head : Infinity);
  const required = isLargeText(smallestPx) ? 3 : 4.5;
  const weakestBg = input.bg2Hex && contrastRatio(input.bg2Hex, input.fgHex) < contrastRatio(input.bgHex, input.fgHex) ? input.bg2Hex : input.bgHex;
  const fix = ensureContrast(weakestBg, input.fgHex, palette, required);
  if (fix.fellBack) {
    warnings.push(`Text colour ${input.fgHex} was below ${required}:1 on ${weakestBg}; used ${fix.fg} (${fix.ratio.toFixed(1)}:1) instead.`);
  }
  const fg = fix.fg;

  const logo = input.include.logo ? await logoFor(brand, input.bgHex, warnings) : null;
  const signature = input.include.sig ? signatureFor(input.platform, brand) || null : null;
  const fonts = await loadFonts(brand.customFonts);
  const families = new Set(fonts.map((f) => f.name));
  const headlineFont = families.has(brand.headlineFont) ? brand.headlineFont : "Fraunces";
  const bodyFont = families.has(brand.bodyFont) ? brand.bodyFont : "IBM Plex Sans";
  if (headlineFont !== brand.headlineFont || bodyFont !== brand.bodyFont) warnings.push("A brand font could not be loaded; used the default font.");

  const bgImage = input.bgImage
    ? `data:image/png;base64,${(await sharp(input.bgImage).resize(input.w, input.h, { fit: "cover" }).png().toBuffer()).toString("base64")}`
    : null;

  const images: Buffer[] = [];
  for (let i = 0; i < input.slides.length; i++) {
    const el = SlideTemplate({
      platform: input.platform,
      w: input.w,
      h: input.h,
      slide: input.slides[i],
      bg: input.bgHex,
      bg2: input.bg2Hex,
      fg,
      headlineFont,
      bodyFont,
      logo,
      bgImage,
      logoPos: brand.logoPosition,
      logoSize: brand.logoSize,
      signature,
      sigPlacement: brand.sigPlacement,
      sigSize: brand.sigSize,
      showHeadline: input.include.headline,
      slideIndex: i,
      slideCount: input.slides.length,
    });
    const svg = await satori(el, { width: input.w, height: input.h, fonts: fonts as never });
    const png = new Resvg(svg, { fitTo: { mode: "width", value: input.w } }).render().asPng();
    images.push(input.format === "jpeg" ? await sharp(png).flatten({ background: input.bgHex }).jpeg({ quality: 92 }).toBuffer() : Buffer.from(png));
  }
  return { images, mime: input.format === "jpeg" ? "image/jpeg" : "image/png", warnings, fgUsed: fg };
}
