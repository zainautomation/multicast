import type Anthropic from "@anthropic-ai/sdk";
import { callTool } from "@/lib/claude";
import { substitute } from "@/lib/prompts/assemble";
import type { Layer } from "@/lib/prompts/layers";
import { findSize, PLATFORMS, type PlatformId } from "@/lib/platforms";
import { brandSummary, logoPositionLabel, signatureFor, type Brand } from "@/lib/brand";
import { renderSlides } from "@/lib/render/render";
import type { Slide, SlideLayout } from "@/lib/render/templates";
import { newKey, putObject } from "@/lib/storage";
import type { Creativity } from "@/lib/models";
import { renderExternal, GENERATOR_LABEL } from "@/lib/integrations/creative";
import type { GeneratorId } from "@/lib/prompts/defaults";

export const RETURN_IMAGE_SPEC_TOOL = {
  name: "return_image_spec",
  description: "Return the on-image text and layout for each slide. The renderer draws the pixels.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    required: ["slides"],
    properties: {
      slides: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["headline", "subline", "layout", "items"],
          properties: {
            headline: { type: "string" },
            subline: { type: ["string", "null"] },
            layout: { type: "string", enum: ["headline-center", "headline-top", "quote", "checklist"] },
            items: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  },
};

export type ImageSpec = { slides: Slide[] };

export type ImageJob = {
  platform: PlatformId;
  layer: Layer;
  brandLayer: Layer;
  brand: Brand;
  briefText: string;
  postText?: string | null;
  title?: string | null;
  visualBrief?: unknown;
  subreddit?: string | null;
  sizeKey?: string | null;
  generator?: GeneratorId;
};

function visualBriefText(vb: unknown): string | null {
  if (!vb || typeof vb !== "object") return null;
  const v = vb as { format?: string; slides?: { headline: string; subline?: string | null }[] };
  const slides = (v.slides ?? []).map((s, i) => `Slide ${i + 1}: ${s.headline}${s.subline ? ` — ${s.subline}` : ""}`);
  return [`Format: ${v.format ?? "single"}`, ...slides].join("\n");
}

export async function buildImageSpec(
  ctx: { client: Anthropic; model: string; creativity: Creativity },
  job: ImageJob,
): Promise<{ spec: ImageSpec; model: string; tokensIn: number; tokensOut: number }> {
  const d = job.layer.imageDefaults;
  const carousel = d.format === "Carousel" || (job.visualBrief as { format?: string } | null)?.format === "carousel";
  const vars = {
    brief: job.briefText,
    post_text: job.postText ?? null,
    visual_brief: visualBriefText(job.visualBrief),
    bg_color: d.bgHex,
    text_color: d.fgHex,
    logo_position: logoPositionLabel(job.brand.logoPosition),
    signature: signatureFor(job.platform, job.brand),
    title: job.title ?? null,
    subreddit: job.subreddit ?? null,
  };
  const system = [
    substitute(job.brandLayer.imagePrompt, vars),
    `PLATFORM IMAGE: ${PLATFORMS[job.platform].name}\n\n${substitute(job.layer.imagePrompt, vars)}`,
    brandSummary(job.brand, job.platform),
    [
      "YOUR JOB: write only the on-image text and pick a layout per slide; a template renders the pixels.",
      `Visual style: ${d.style}. Format: ${carousel ? "carousel of 3–6 slides" : "exactly one slide"}.`,
      "Layouts: headline-center (big statement), headline-top (headline plus supporting line), quote (a quotable line; subline = attribution), checklist (headline plus 3–6 short items).",
      d.style === "Diagram / checklist" ? "Prefer the checklist layout." : "",
      d.include.headline ? "" : "Headline text is switched off for this platform: keep headline to at most 3 words (it will not be drawn).",
      "Keep on-image text short and spelled exactly as it should appear. Items are empty unless the layout is checklist.",
    ]
      .filter(Boolean)
      .join("\n"),
  ].join("\n\n---\n\n");
  const user = [
    `BRIEF:\n${job.briefText}`,
    job.postText ? `POST TEXT:\n${job.postText}` : "No post text: this platform gets an image only.",
    vars.visual_brief ? `VISUAL BRIEF:\n${vars.visual_brief}` : "",
    "Return the slides with the return_image_spec tool.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const r = await callTool<{ slides: Slide[] }>({ client: ctx.client, model: ctx.model, system, user, tool: RETURN_IMAGE_SPEC_TOOL as Anthropic.Tool, creativity: ctx.creativity });
  const slides = (r.input.slides ?? [])
    .filter((s) => s && typeof s.headline === "string")
    .map((s) => ({
      headline: s.headline.trim(),
      subline: s.subline?.trim() || null,
      layout: (["headline-center", "headline-top", "quote", "checklist"].includes(s.layout) ? s.layout : "headline-center") as SlideLayout,
      items: (s.items ?? []).map((x) => x.trim()).filter(Boolean),
    }));
  if (!slides.length) slides.push({ headline: job.title ?? job.briefText.slice(0, 60), subline: null, layout: "headline-center", items: [] });
  return { spec: { slides: carousel ? slides.slice(0, 10) : slides.slice(0, 1) }, model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut };
}

export type RenderedImage = {
  urls: string[];
  mime: string;
  width: number;
  height: number;
  sizeKey: string;
  generator: string;
  note: string;
  warnings: string[];
  spec: Record<string, unknown>;
};

/** Render the spec with the chosen generator; external failures fall back to built-in. */
export async function renderImage(workspaceId: string, job: ImageJob, spec: ImageSpec): Promise<RenderedImage> {
  const d = job.layer.imageDefaults;
  const size = findSize(job.platform, job.sizeKey ?? d.sizeKey);
  const format = job.platform === "ig" ? "jpeg" : "png"; // Instagram requires JPEG
  const bg = job.brand.backgrounds.find((c) => c.hex.toLowerCase() === d.bgHex.toLowerCase());
  const warnings: string[] = [];
  let generator: string = job.generator ?? d.generator ?? "builtin";
  let images: Buffer[] | null = null;
  let mime = format === "jpeg" ? "image/jpeg" : "image/png";
  let fgUsed = d.fgHex;

  if (generator !== "builtin") {
    try {
      const ext = await renderExternal(generator as GeneratorId, workspaceId, { job, spec, w: size.w, h: size.h, format });
      images = ext.images;
      mime = ext.mime;
      warnings.push(...ext.warnings);
    } catch (e) {
      warnings.push(`${GENERATOR_LABEL[generator as GeneratorId] ?? generator} failed (${e instanceof Error ? e.message : "error"}); used the built-in template instead.`);
      generator = "builtin";
    }
  }
  if (!images) {
    const out = await renderSlides({
      platform: job.platform,
      w: size.w,
      h: size.h,
      slides: spec.slides,
      bgHex: d.bgHex,
      bg2Hex: bg?.hex2 ?? null,
      fgHex: d.fgHex,
      include: d.include,
      brand: job.brand,
      format,
    });
    images = out.images;
    mime = out.mime;
    fgUsed = out.fgUsed;
    warnings.push(...out.warnings);
  }

  const ext = mime === "image/jpeg" ? "jpg" : mime === "video/mp4" ? "mp4" : "png";
  const urls = await Promise.all(images.map((buf) => putObject(newKey(`images/${job.platform}`, ext), buf, mime)));
  const n = urls.length;
  const genLabel = generator === "builtin" ? "built-in template" : GENERATOR_LABEL[generator as GeneratorId] ?? generator;
  const note =
    n > 1
      ? `Carousel · ${n} slides · ${genLabel}`
      : job.platform === "reddit"
        ? "No logo or signature · subreddit rules"
        : generator === "builtin"
          ? "Built-in template · brand kit applied"
          : `Made with ${genLabel}`;
  return {
    urls,
    mime,
    width: size.w,
    height: size.h,
    sizeKey: size.key,
    generator,
    note,
    warnings,
    spec: { slides: spec.slides, bgHex: d.bgHex, fgHex: fgUsed, include: d.include } as Record<string, unknown>,
  };
}
