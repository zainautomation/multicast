import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { clientFor } from "@/lib/claude";
import { assertUnderCap, recordUsage } from "@/lib/usage";
import { getLayers, currentVersionId, type Layer } from "@/lib/prompts/layers";
import { loadBrand, type Brand } from "@/lib/brand";
import { generateText, type GenContext } from "@/lib/generation/text";
import { buildImageSpec, renderImage } from "@/lib/generation/image";
import { fetchSubredditInfo, type SubredditInfo } from "@/lib/reddit-rules";
import { isPlatformId, PLATFORMS, type PlatformId } from "@/lib/platforms";
import { draftDTO, packWarnings, type DraftDTO } from "@/lib/dto";
import { mapLimit, errMsg } from "@/lib/util";
import type { Creativity } from "@/lib/models";
import type { GeneratorId } from "@/lib/prompts/defaults";
import type { BriefInput } from "@/lib/prompts/assemble";
import { accountToken } from "@/lib/publishers/accounts";
import { notify } from "@/lib/notify";

export type GenEvent = { type: "draft"; draft: DraftDTO } | { type: "error"; platform?: string; message: string } | { type: "done" };

type Shared = {
  workspaceId: string;
  client: Anthropic;
  ctx: GenContext;
  layers: Record<string, Layer>;
  brand: Brand;
  creativity: Creativity;
  checkerModel: string;
  draftModel: string;
  reddit: SubredditInfo | null;
};

async function prepare(workspaceId: string, subreddit?: string | null): Promise<Shared> {
  await assertUnderCap(workspaceId);
  const [settings, layers, brand, client] = await Promise.all([
    db.settings.findUniqueOrThrow({ where: { workspaceId } }),
    getLayers(workspaceId),
    loadBrand(workspaceId),
    clientFor(workspaceId),
  ]);
  let reddit: SubredditInfo | null = null;
  if (subreddit) {
    const token = await accountToken(workspaceId, "reddit").catch(() => null);
    reddit = await fetchSubredditInfo(subreddit, token ?? undefined).catch(() => null);
  }
  const creativity = (settings.creativity as Creativity) ?? "balanced";
  return {
    workspaceId,
    client,
    layers,
    brand,
    creativity,
    reddit,
    draftModel: settings.draftModel,
    checkerModel: settings.checkerModel,
    ctx: {
      client,
      draftModel: settings.draftModel,
      checkerModel: settings.checkerModel,
      creativity,
      brandLayer: layers.brand,
      bannedPhrases: brand.bannedPhrases,
    },
  };
}

function briefInput(b: { text: string; goal: string; tone: string; link: string | null; keyword?: string | null; subreddit: string | null }, reddit: SubredditInfo | null): BriefInput {
  return { text: b.text, goal: b.goal, tone: b.tone, link: b.link, keyword: b.keyword ?? null, subreddit: reddit?.name ?? b.subreddit, subredditRules: reddit?.rulesText ?? null };
}

/** Generate (or regenerate) the text part of one draft. */
async function doText(s: Shared, draftId: string, platform: PlatformId, brief: BriefInput) {
  const layer = s.layers[platform];
  const res = await generateText(s.ctx, platform, layer, brief);
  const versionId = await currentVersionId(layer);
  let tIn = 0;
  let tOut = 0;
  for (const u of res.usage) {
    tIn += u.tokensIn;
    tOut += u.tokensOut;
    await recordUsage({ workspaceId: s.workspaceId, platform, promptVersionId: versionId, ...u });
  }
  const notes = [...res.validation.notes];
  if (res.repaired && !res.validation.errors.length) notes.push("Auto-repaired to meet platform limits.");
  if (res.validation.errors.length) notes.push("Still breaks platform rules after one repair; edit before approving.");
  const o = res.output;
  return db.draft.update({
    where: { id: draftId },
    data: {
      title: o.title,
      subtitle: o.subtitle ?? null,
      slug: o.slug ?? null,
      body: o.body,
      firstComment: o.first_comment,
      hashtags: o.hashtags,
      visualBrief: (o.visual_brief ?? undefined) as object | undefined,
      placeholders: o.placeholders,
      variants: res.variants.length ? (res.variants as unknown as object) : undefined,
      warnings: packWarnings(res.validation.errors, notes),
      promptVersionId: versionId,
      model: s.draftModel,
      tokensIn: tIn,
      tokensOut: tOut,
    },
  });
}

/** Build the image spec with Claude, render it, store an ImageAsset. */
async function doImage(
  s: Shared,
  draftId: string,
  platform: PlatformId,
  briefText: string,
  opts: { generator?: GeneratorId; sizeKey?: string | null; replaceId?: string },
) {
  const draft = await db.draft.findUniqueOrThrow({ where: { id: draftId } });
  const layer = s.layers[platform];
  if (platform === "reddit" && s.reddit && !s.reddit.allowImages) {
    await db.draft.update({ where: { id: draftId }, data: { warnings: [...draft.warnings, `N:${s.reddit.name} does not allow image posts; no image made.`] } });
    return;
  }
  const job = {
    platform,
    layer,
    brandLayer: s.layers.brand,
    brand: s.brand,
    briefText,
    postText: draft.hasPost ? draft.body : null,
    title: draft.title,
    visualBrief: draft.visualBrief,
    subreddit: s.reddit?.name,
    sizeKey: opts.sizeKey,
    generator: opts.generator,
  };
  const spec = await buildImageSpec({ client: s.client, model: s.draftModel, creativity: s.creativity }, job);
  await recordUsage({ workspaceId: s.workspaceId, kind: "image_spec", platform, model: spec.model, tokensIn: spec.tokensIn, tokensOut: spec.tokensOut });
  const img = await renderImage(s.workspaceId, job, spec.spec);
  const data = {
    platform,
    sizeKey: img.sizeKey,
    width: img.width,
    height: img.height,
    generator: img.generator,
    spec: img.spec as object,
    urls: img.urls,
    mimeType: img.mime,
    note: img.note,
    status: "ready",
    warnings: img.warnings,
  };
  if (opts.replaceId) await db.imageAsset.update({ where: { id: opts.replaceId }, data });
  else await db.imageAsset.create({ data: { draftId, ...data } });
}

function finalStatus(warnings: string[]) {
  return warnings.some((w) => w.startsWith("E:")) ? "warning" : "ready";
}

async function loadDTO(id: string) {
  return draftDTO(await db.draft.findUniqueOrThrow({ where: { id }, include: { images: true, schedule: true } }));
}

/** Create draft rows for a brief (status generating) so cards appear immediately. */
export async function createDraftRows(workspaceId: string, briefId: string, posts: PlatformId[], images: PlatformId[]) {
  const all = [...new Set([...posts, ...images])].filter(isPlatformId);
  const order = Object.keys(PLATFORMS);
  all.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const rows = [];
  for (const p of all) {
    rows.push(await db.draft.create({ data: { workspaceId, briefId, platform: p, hasPost: posts.includes(p), status: "generating" }, include: { images: true, schedule: true } }));
  }
  return rows;
}

/** Run a whole brief: one request per platform, 4 at a time, events per finished card. */
export async function runBrief(workspaceId: string, briefId: string, emit: (e: GenEvent) => void) {
  const brief = await db.brief.findUniqueOrThrow({ where: { id: briefId }, include: { drafts: true } });
  let s: Shared;
  try {
    s = await prepare(workspaceId, brief.postPlatforms.includes("reddit") || brief.imagePlatforms.includes("reddit") ? brief.subreddit : null);
  } catch (e) {
    await db.draft.updateMany({ where: { briefId, status: "generating" }, data: { status: "failed", lastError: errMsg(e) } });
    emit({ type: "error", message: errMsg(e) });
    for (const d of brief.drafts) emit({ type: "draft", draft: await loadDTO(d.id) });
    emit({ type: "done" });
    return;
  }
  const input = briefInput(brief, s.reddit);

  await mapLimit(brief.drafts, 4, async (d) => {
    const platform = d.platform as PlatformId;
    try {
      if (!s.layers[platform]?.enabled) throw new Error(`${PLATFORMS[platform].name} is disabled in Platform prompts`);
      if (d.hasPost) await doText(s, d.id, platform, input);
      if (brief.imagePlatforms.includes(platform)) {
        try {
          await doImage(s, d.id, platform, brief.text, { generator: brief.generator as GeneratorId });
        } catch (e) {
          const cur = await db.draft.findUniqueOrThrow({ where: { id: d.id } });
          await db.draft.update({ where: { id: d.id }, data: { warnings: [...cur.warnings, `N:Image failed: ${errMsg(e)}`] } });
        }
      }
      const cur = await db.draft.findUniqueOrThrow({ where: { id: d.id }, include: { images: true } });
      const extra: string[] = [];
      if (platform === "ig" && cur.hasPost && !cur.images.length) extra.push("N:Instagram needs an image or video before it can publish. Select it under Images for, or upload your own.");
      await db.draft.update({ where: { id: d.id }, data: { status: finalStatus(cur.warnings), warnings: [...cur.warnings, ...extra] } });
    } catch (e) {
      await db.draft.update({ where: { id: d.id }, data: { status: "failed", lastError: errMsg(e) } });
      emit({ type: "error", platform, message: errMsg(e) });
    }
    emit({ type: "draft", draft: await loadDTO(d.id) });
  });

  const ready = await db.draft.findMany({ where: { briefId, status: { in: ["ready", "warning"] } }, include: { images: true } });
  if (ready.length) await notify(workspaceId, "ready", { briefId, drafts: ready }).catch((e) => console.warn("[notify]", errMsg(e)));
  emit({ type: "done" });
}

/** Regenerate one platform's post text (keeps images). */
export async function regenerateText(workspaceId: string, draftId: string) {
  const d = await db.draft.findUniqueOrThrow({ where: { id: draftId }, include: { brief: true } });
  const platform = d.platform as PlatformId;
  const s = await prepare(workspaceId, platform === "reddit" ? d.brief.subreddit : null);
  await db.draft.update({ where: { id: draftId }, data: { status: "generating", lastError: null } });
  try {
    await doText(s, draftId, platform, briefInput(d.brief, s.reddit));
    const cur = await db.draft.findUniqueOrThrow({ where: { id: draftId } });
    await db.draft.update({ where: { id: draftId }, data: { status: finalStatus(cur.warnings) } });
  } catch (e) {
    await db.draft.update({ where: { id: draftId }, data: { status: "failed", lastError: errMsg(e) } });
    throw e;
  }
  return loadDTO(draftId);
}

/** Regenerate (or add) the image for one draft, optionally at a new size. */
export async function regenerateImage(workspaceId: string, draftId: string, opts: { sizeKey?: string | null; imageId?: string; generator?: GeneratorId }) {
  const d = await db.draft.findUniqueOrThrow({ where: { id: draftId }, include: { brief: true, images: true } });
  const platform = d.platform as PlatformId;
  const s = await prepare(workspaceId, platform === "reddit" ? d.brief.subreddit : null);
  const target = opts.imageId ? d.images.find((i) => i.id === opts.imageId) : d.images[0];
  if (target) await db.imageAsset.update({ where: { id: target.id }, data: { status: "generating" } });
  await doImage(s, draftId, platform, d.brief.text, {
    generator: opts.generator ?? (target?.generator as GeneratorId | undefined) ?? (d.brief.generator as GeneratorId),
    sizeKey: opts.sizeKey ?? target?.sizeKey,
    replaceId: target?.generator === "upload" ? undefined : target?.id,
  });
  // The card now has media: drop the "needs an image" note; changing media restarts approval.
  const cur = await db.draft.findUniqueOrThrow({ where: { id: draftId } });
  const warnings = cur.warnings.filter((w) => !w.includes("needs an image"));
  await db.draft.update({ where: { id: draftId }, data: { warnings, ...(d.status === "approved" ? { status: finalStatus(warnings) } : {}) } });
  return loadDTO(draftId);
}

/**
 * "Test with last brief": run one layer without saving a draft. Testing the Brand voice
 * layer runs it through the first platform of the last brief.
 */
export async function testPrompt(workspaceId: string, layerId: PlatformId | "brand", overrides: { textPrompt?: string; rules?: Partial<Layer["rules"]> }) {
  const last = await db.brief.findFirst({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
  if (!last) throw new Error("Write a brief on Compose first; the test reuses your last brief.");
  const platform: PlatformId = layerId === "brand" ? ((last.postPlatforms.find(isPlatformId) as PlatformId | undefined) ?? "lip") : layerId;
  const s = await prepare(workspaceId, platform === "reddit" ? last.subreddit : null);
  const base = s.layers[platform];
  const layer: Layer =
    layerId === "brand"
      ? base
      : { ...base, textPrompt: overrides.textPrompt ?? base.textPrompt, rules: { ...base.rules, ...(overrides.rules ?? {}), variants: 1 } };
  const brandLayer = layerId === "brand" ? { ...s.layers.brand, textPrompt: overrides.textPrompt ?? s.layers.brand.textPrompt } : s.layers.brand;
  const res = await generateText({ ...s.ctx, brandLayer }, platform, { ...layer, rules: { ...layer.rules, variants: 1 } }, briefInput(last, s.reddit));
  for (const u of res.usage) await recordUsage({ workspaceId, kind: "test", platform, model: u.model, tokensIn: u.tokensIn, tokensOut: u.tokensOut });
  return { platform, output: res.output, errors: res.validation.errors, notes: res.validation.notes, brief: last.text };
}

/** Re-render an existing image at a new size from its stored spec (no Claude call). */
export async function rerenderImage(workspaceId: string, draftId: string, imageId: string, sizeKey: string) {
  const d = await db.draft.findFirstOrThrow({ where: { id: draftId, workspaceId }, include: { brief: true, images: true } });
  const img = d.images.find((i) => i.id === imageId);
  if (!img) throw new Error("Image not found");
  const spec = img.spec as { slides?: import("@/lib/render/templates").Slide[] };
  if (img.generator === "upload" || !spec.slides?.length) throw new Error("Uploaded media can't be resized here; upload a new file instead");
  const platform = d.platform as PlatformId;
  const [layers, brand] = await Promise.all([getLayers(workspaceId), loadBrand(workspaceId)]);
  const job = { platform, layer: layers[platform], brandLayer: layers.brand, brand, briefText: d.brief.text, postText: d.body, title: d.title, sizeKey, generator: "builtin" as GeneratorId };
  const out = await renderImage(workspaceId, job, { slides: spec.slides });
  await db.imageAsset.update({
    where: { id: imageId },
    data: { sizeKey: out.sizeKey, width: out.width, height: out.height, urls: out.urls, mimeType: out.mime, note: out.note, warnings: out.warnings, spec: out.spec as object, generator: out.generator, status: "ready" },
  });
  if (d.status === "approved") await db.draft.update({ where: { id: draftId }, data: { status: finalStatus(d.warnings) } });
  return loadDTO(draftId);
}
