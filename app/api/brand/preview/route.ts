import { z } from "zod";
import { body, rateLimit, route } from "@/lib/api";
import { loadBrand } from "@/lib/brand";
import { renderSlides } from "@/lib/render/render";
import { BrandPatch } from "@/lib/brand-schema";

/** Render the unsaved brand kit with the real built-in renderer (no Claude call). */
export const POST = route(async (req, ctx) => {
  rateLimit(`preview:${ctx.workspaceId}`, 60, 60_000);
  const p = await body(
    req,
    z.object({
      brand: BrandPatch,
      w: z.number().int().min(200).max(2000),
      h: z.number().int().min(200).max(2000),
      bgHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      bg2Hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
      fgHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    }),
  );
  const saved = await loadBrand(ctx.workspaceId);
  const brand = { ...saved, ...p.brand, backgrounds: p.brand.backgrounds ?? saved.backgrounds, textColors: p.brand.textColors ?? saved.textColors } as typeof saved;
  const out = await renderSlides({
    platform: "lic",
    w: p.w,
    h: p.h,
    slides: [{ headline: "Your headline sits here, set in your brand type", subline: null, layout: "headline-center" }],
    bgHex: p.bgHex,
    bg2Hex: p.bg2Hex ?? null,
    fgHex: p.fgHex,
    include: { logo: true, sig: true, headline: true },
    brand,
  });
  return { dataUrl: `data:image/png;base64,${out.images[0].toString("base64")}`, warnings: out.warnings };
});

// Generation, rendering and publishing can take minutes (Vercel function limit).
export const maxDuration = 300;
