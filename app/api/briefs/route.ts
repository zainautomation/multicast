import { z } from "zod";
import { body, rateLimit, route } from "@/lib/api";
import { db } from "@/lib/db";
import { PLATFORM_IDS, isPlatformId, normalizeSubreddit, type PlatformId } from "@/lib/platforms";
import { extractLink, GOALS, TONES } from "@/lib/prompts/assemble";
import { createDraftRows, runBrief, type GenEvent } from "@/lib/generation/run";
import { assertUnderCap } from "@/lib/usage";
import { draftDTO } from "@/lib/dto";
import { HttpError } from "@/lib/errors";
import { connectedTypes } from "@/lib/integrations/store";
import sharp from "sharp";
import { keyFromUrl, readObject, newKey, putObject } from "@/lib/storage";

const Platform = z.enum(PLATFORM_IDS);

const Create = z.object({
  text: z.string().trim().min(5, "Write a brief first").max(8000),
  goal: z.enum(GOALS as [string, ...string[]]),
  tone: z.enum(TONES as [string, ...string[]]),
  subreddit: z.string().trim().max(60).optional().nullable(),
  keyword: z.string().trim().max(120).optional().nullable(),
  postPlatforms: z.array(Platform).max(7),
  imagePlatforms: z.array(Platform).max(7),
  generator: z.enum(["builtin", "canva", "figma", "higgsfield", "custom"]).default("builtin"),
  uploads: z
    .array(z.object({ platform: Platform, url: z.string().url(), mimeType: z.string(), width: z.number().nullable(), height: z.number().nullable() }))
    .max(14)
    .default([]),
});

/** Drafts history: previous briefs. */
export const GET = route(async (_req, ctx) => {
  const briefs = await db.brief.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 40,
    include: { drafts: { select: { platform: true, status: true } } },
  });
  return {
    briefs: briefs.map((b) => ({ id: b.id, text: b.text, createdAt: b.createdAt, platforms: b.drafts.map((d) => d.platform), statuses: b.drafts.map((d) => d.status) })),
  };
});

/**
 * Create a brief and generate every selected platform. The response is an NDJSON stream:
 * first {"type":"brief"} with placeholder cards, then one {"type":"draft"} per finished card.
 */
export const POST = route(async (req, ctx) => {
  rateLimit(`gen:${ctx.workspaceId}`, 12, 60_000);
  const b = await body(req, Create);
  const posts = [...new Set(b.postPlatforms)] as PlatformId[];
  const uploaded = new Set(b.uploads.map((u) => u.platform));
  // Uploaded media replaces generation for that platform.
  const images = [...new Set(b.imagePlatforms)].filter((p) => !uploaded.has(p)) as PlatformId[];
  const cards = [...new Set([...posts, ...images, ...uploaded])];
  if (!cards.length) throw new HttpError(400, "Pick at least one platform for a post or an image.");
  if (posts.includes("reddit") && !b.subreddit) throw new HttpError(400, "Add the subreddit for the Reddit post.");
  if (b.generator !== "builtin" && !(await connectedTypes(ctx.workspaceId)).has(b.generator)) throw new HttpError(400, `Connect ${b.generator} in Integrations first.`);
  // Uploaded media must be files we stored (POST /api/uploads), never arbitrary URLs.
  if (b.uploads.some((u) => !keyFromUrl(u.url)?.startsWith("uploads/"))) throw new HttpError(400, "Upload the file again.");
  await assertUnderCap(ctx.workspaceId);

  const brief = await db.brief.create({
    data: {
      workspaceId: ctx.workspaceId,
      text: b.text,
      goal: b.goal,
      tone: b.tone,
      link: extractLink(b.text),
      subreddit: b.subreddit ? normalizeSubreddit(b.subreddit) : null,
      keyword: b.keyword || null,
      postPlatforms: posts,
      imagePlatforms: images,
      generator: b.generator,
    },
  });
  await db.settings.update({ where: { workspaceId: ctx.workspaceId }, data: { lastImagePlatforms: b.imagePlatforms, lastGenerator: b.generator } });
  const rows = await createDraftRows(ctx.workspaceId, brief.id, posts, [...images, ...uploaded].filter(isPlatformId));

  for (const u of b.uploads) {
    const d = rows.find((r) => r.platform === u.platform);
    if (!d) continue;
    let url = u.url;
    let mime = u.mimeType;
    if (u.platform === "ig" && mime.startsWith("image/") && mime !== "image/jpeg") {
      const jpg = await sharp(await readObject(u.url)).flatten({ background: "#FFFFFF" }).jpeg({ quality: 92 }).toBuffer();
      url = await putObject(newKey("uploads/ig", "jpg"), jpg, "image/jpeg");
      mime = "image/jpeg";
    }
    await db.imageAsset.create({
      data: { draftId: d.id, platform: u.platform, sizeKey: `${u.width ?? 0}x${u.height ?? 0}`, width: u.width ?? 0, height: u.height ?? 0, generator: "upload", spec: {}, urls: [url], mimeType: mime, note: mime.startsWith("video/") ? "Your video" : "Your upload", status: "ready" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          /* client went away; generation continues and drafts persist */
        }
      };
      send({ type: "brief", brief: { id: brief.id, text: brief.text, createdAt: brief.createdAt }, drafts: rows.map(draftDTO) });
      try {
        await runBrief(ctx.workspaceId, brief.id, (e: GenEvent) => send(e));
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
        send({ type: "done" });
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
});

// Generation, rendering and publishing can take minutes (Vercel function limit).
export const maxDuration = 300;
