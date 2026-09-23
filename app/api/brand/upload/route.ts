import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { FONT_TYPES, LOGO_TYPES, storeUpload } from "@/lib/uploads";
import type { CustomFont } from "@/lib/render/fonts";

const LOGO_FIELD = { logoPrimary: "logoPrimaryUrl", logoReverse: "logoReverseUrl", logoIcon: "logoIconUrl" } as const;

/** Upload a logo variant (PNG/SVG ≤ 5 MB, SVG sanitised) or a brand font (TTF/OTF/WOFF/WOFF2). */
export const POST = route(async (req, ctx) => {
  const form = await req.formData();
  const kind = String(form.get("kind") ?? "");
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file");

  if (kind in LOGO_FIELD) {
    const s = await storeUpload(file, "logo", { allow: LOGO_TYPES, prefix: "brand/logos" });
    await db.brandKit.update({ where: { workspaceId: ctx.workspaceId }, data: { [LOGO_FIELD[kind as keyof typeof LOGO_FIELD]]: s.url } });
    return { url: s.url };
  }
  if (kind === "font") {
    const family = String(form.get("family") ?? "").trim().slice(0, 60);
    if (!family) throw new HttpError(400, "Name the font family");
    const weight = Number(form.get("weight") ?? 500);
    const s = await storeUpload(file, "font", { allow: FONT_TYPES, prefix: "brand/fonts" });
    const kit = await db.brandKit.findUniqueOrThrow({ where: { workspaceId: ctx.workspaceId } });
    const fonts = ((kit.customFonts as unknown as CustomFont[]) ?? []).filter((f) => !(f.family === family && (f.weight ?? 500) === weight));
    fonts.push({ family, url: s.url, weight, style: "normal" });
    await db.brandKit.update({ where: { workspaceId: ctx.workspaceId }, data: { customFonts: fonts as unknown as object } });
    return { url: s.url, family };
  }
  throw new HttpError(400, "Unknown upload kind");
});

export const DELETE = route(async (req, ctx) => {
  const kind = req.nextUrl.searchParams.get("kind") ?? "";
  if (kind in LOGO_FIELD) {
    await db.brandKit.update({ where: { workspaceId: ctx.workspaceId }, data: { [LOGO_FIELD[kind as keyof typeof LOGO_FIELD]]: null } });
    return { ok: true };
  }
  if (kind === "font") {
    const family = req.nextUrl.searchParams.get("family");
    const kit = await db.brandKit.findUniqueOrThrow({ where: { workspaceId: ctx.workspaceId } });
    const fonts = ((kit.customFonts as unknown as CustomFont[]) ?? []).filter((f) => f.family !== family);
    await db.brandKit.update({
      where: { workspaceId: ctx.workspaceId },
      data: {
        customFonts: fonts as unknown as object,
        ...(kit.headlineFont === family ? { headlineFont: "Fraunces" } : {}),
        ...(kit.bodyFont === family ? { bodyFont: "IBM Plex Sans" } : {}),
      },
    });
    return { ok: true };
  }
  throw new HttpError(400, "Unknown kind");
});
