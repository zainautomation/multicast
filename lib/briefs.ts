import sharp from "sharp";
import { z } from "zod";
import { db } from "@/lib/db";
import { PLATFORM_IDS, isPlatformId, normalizeSubreddit, type PlatformId } from "@/lib/platforms";
import { extractLink, GOALS, TONES } from "@/lib/prompts/assemble";
import { createDraftRows } from "@/lib/generation/run";
import { assertUnderCap } from "@/lib/usage";
import { HttpError } from "@/lib/errors";
import { connectedTypes } from "@/lib/integrations/store";
import { keyFromUrl, readObject, newKey, putObject } from "@/lib/storage";
import { packWarnings, revalidate } from "@/lib/drafts";

const Platform = z.enum(PLATFORM_IDS);

export const BriefSchema = z.object({
  text: z.string().trim().min(5, "Write a brief first").max(8000),
  goal: z.enum(GOALS as [string, ...string[]]),
  tone: z.enum(TONES as [string, ...string[]]),
  subreddit: z.string().trim().max(60).optional().nullable(),
  keyword: z.string().trim().max(120).optional().nullable(),
  postPlatforms: z.array(Platform).max(PLATFORM_IDS.length),
  imagePlatforms: z.array(Platform).max(PLATFORM_IDS.length),
  generator: z.enum(["builtin", "canva", "figma", "higgsfield", "custom"]).default("builtin"),
  uploads: z
    .array(z.object({ platform: Platform, url: z.string().url(), mimeType: z.string(), width: z.number().nullable(), height: z.number().nullable() }))
    .max(14)
    .default([]),
});
export type BriefCreate = z.infer<typeof BriefSchema>;

/** Create a brief and its placeholder draft rows (status generating); run it with runBrief. */
export async function createBrief(workspaceId: string, b: BriefCreate) {
  const posts = [...new Set(b.postPlatforms)] as PlatformId[];
  const uploaded = new Set(b.uploads.map((u) => u.platform));
  // Uploaded media replaces generation for that platform.
  const images = [...new Set(b.imagePlatforms)].filter((p) => !uploaded.has(p)) as PlatformId[];
  const cards = [...new Set([...posts, ...images, ...uploaded])];
  if (!cards.length) throw new HttpError(400, "Pick at least one platform for a post or an image.");
  if (posts.includes("reddit") && !b.subreddit) throw new HttpError(400, "Add the subreddit for the Reddit post.");
  if (b.generator !== "builtin" && !(await connectedTypes(workspaceId)).has(b.generator)) throw new HttpError(400, `Connect ${b.generator} in Integrations first.`);
  // Uploaded media must be files we stored (POST /api/uploads), never arbitrary URLs.
  if (b.uploads.some((u) => !keyFromUrl(u.url)?.startsWith("uploads/"))) throw new HttpError(400, "Upload the file again.");
  await assertUnderCap(workspaceId);

  const brief = await db.brief.create({
    data: {
      workspaceId,
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
  const rows = await createDraftRows(workspaceId, brief.id, posts, [...images, ...uploaded].filter(isPlatformId));

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
  return { brief, rows };
}

export type ManualPost = {
  platform: PlatformId;
  body: string;
  title?: string | null;
  subtitle?: string | null;
  slug?: string | null;
  hashtags?: string[];
  firstComment?: string | null;
  subreddit?: string | null;
};

/** A draft with text written elsewhere (no Claude call). Validated like a generated one. */
export async function createManualDraft(workspaceId: string, p: ManualPost) {
  if (p.platform === "reddit" && !p.subreddit) throw new HttpError(400, "Add the subreddit for the Reddit post.");
  const brief = await db.brief.create({
    data: {
      workspaceId,
      text: p.body,
      goal: "Awareness",
      tone: "Use platform default",
      link: extractLink(p.body),
      subreddit: p.subreddit ? normalizeSubreddit(p.subreddit) : null,
      postPlatforms: [p.platform],
      imagePlatforms: [],
    },
  });
  const d = await db.draft.create({
    data: {
      workspaceId,
      briefId: brief.id,
      platform: p.platform,
      hasPost: true,
      title: p.title ?? null,
      subtitle: p.subtitle ?? null,
      slug: p.slug ?? null,
      body: p.body,
      firstComment: p.firstComment ?? null,
      hashtags: p.hashtags ?? [],
      status: "ready",
      model: "external",
    },
  });
  const v = await revalidate(workspaceId, d.id);
  await db.draft.update({ where: { id: d.id }, data: { warnings: packWarnings(v.errors, v.notes), status: v.errors.length ? "warning" : "ready" } });
  return d.id;
}
