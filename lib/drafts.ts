import { db } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { getLayers } from "@/lib/prompts/layers";
import { loadBrand } from "@/lib/brand";
import { linkPolicyFromRules, validateDraft } from "@/lib/generation/validate";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";
import { draftDTO, packWarnings, splitWarnings } from "@/lib/dto";
import { MEDIA_TYPES, storeUpload } from "@/lib/uploads";

export async function ownedDraft(workspaceId: string, id: string) {
  const d = await db.draft.findFirst({ where: { id, workspaceId }, include: { images: true, schedule: true, brief: true } });
  if (!d) throw new HttpError(404, "Draft not found");
  return d;
}

/** Re-run the validators on the current content; keep non-validation notes (image notes etc.). */
export async function revalidate(workspaceId: string, draftId: string) {
  const d = await ownedDraft(workspaceId, draftId);
  const platform = d.platform as PlatformId;
  if (!d.hasPost) return { errors: [], notes: splitWarnings(d.warnings).notes };
  const [layers, brand] = await Promise.all([getLayers(workspaceId), loadBrand(workspaceId)]);
  const layer = layers[platform];
  const v = validateDraft(
    platform,
    { title: d.title, subtitle: d.subtitle, slug: d.slug, body: d.body, firstComment: d.firstComment, hashtags: d.hashtags },
    { bannedPhrases: brand.bannedPhrases, linkPolicy: linkPolicyFromRules(layer.rules.cta, PLATFORMS[platform].linkPolicy), link: d.brief.link, hashtagRule: layer.rules.hashtags },
  );
  const keep = splitWarnings(d.warnings).notes.filter((n) => /^(Image|Instagram needs|r\/.+ does not allow)/.test(n));
  return { errors: v.errors, notes: [...v.notes, ...keep] };
}

export async function loadDraftDTO(id: string) {
  return draftDTO(await db.draft.findUniqueOrThrow({ where: { id }, include: { images: true, schedule: true } }));
}

export { packWarnings };

/** Approve (or un-approve). Blocked while the draft breaks platform rules (spec 9.4). */
export async function approveDraft(workspaceId: string, id: string, approved: boolean) {
  const d = await ownedDraft(workspaceId, id);
  if (d.status === "generating") throw new HttpError(409, "Still generating");
  if (["scheduled", "published"].includes(d.status)) throw new HttpError(400, d.status === "scheduled" ? "Unschedule this post first." : "This post is already live.");
  const v = await revalidate(workspaceId, id);
  if (approved) {
    if (v.errors.length) {
      await db.draft.update({ where: { id }, data: { warnings: packWarnings(v.errors, v.notes), status: "warning" } });
      throw new HttpError(400, `Edit before approving: ${v.errors.join(" ")}`);
    }
    if (!d.hasPost && !d.images.some((i) => i.status === "ready" || i.status === "approved")) throw new HttpError(400, "The image isn't ready yet");
  }
  await db.draft.update({ where: { id }, data: { status: approved ? "approved" : v.errors.length ? "warning" : "ready", warnings: packWarnings(v.errors, v.notes) } });
  if (d.images.length) await db.imageAsset.updateMany({ where: { draftId: id, status: { in: ["ready", "approved"] } }, data: { status: approved ? "approved" : "ready" } });
  return loadDraftDTO(id);
}

export type DraftEdit = {
  title?: string | null;
  subtitle?: string | null;
  slug?: string | null;
  hashtags?: string[];
  body?: string;
  firstComment?: string | null;
  useVariant?: number;
};

type Variant = { title: string | null; subtitle?: string | null; slug?: string | null; body: string; first_comment: string | null; hashtags: string[] };

/** Inline edit. Editing an approved draft sends it back for approval; validation re-runs. */
export async function editDraft(workspaceId: string, id: string, e: DraftEdit) {
  const d = await ownedDraft(workspaceId, id);
  if (["scheduled", "published"].includes(d.status)) throw new HttpError(400, d.status === "scheduled" ? "Unschedule this post before editing it." : "This post is already live.");
  if (d.status === "generating") throw new HttpError(409, "Still generating");
  let data: Record<string, unknown>;
  if (e.useVariant !== undefined) {
    // Swap the chosen variant into the main slot (the current text becomes a variant).
    const variants = ((d.variants as Variant[] | null) ?? []).slice();
    const v = variants[e.useVariant];
    if (!v) throw new HttpError(404, "Variant not found");
    variants[e.useVariant] = { title: d.title, subtitle: d.subtitle, slug: d.slug, body: d.body ?? "", first_comment: d.firstComment, hashtags: d.hashtags };
    data = { title: v.title, subtitle: v.subtitle ?? null, slug: v.slug ?? d.slug, body: v.body, firstComment: v.first_comment, hashtags: v.hashtags, variants };
  } else {
    const { useVariant: _u, ...fields } = e;
    data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  }
  await db.draft.update({ where: { id }, data });
  const v = await revalidate(workspaceId, id);
  await db.draft.update({ where: { id }, data: { warnings: packWarnings(v.errors, v.notes), status: v.errors.length ? "warning" : "ready", lastError: null } });
  return loadDraftDTO(id);
}

export async function deleteDraft(workspaceId: string, id: string) {
  const d = await ownedDraft(workspaceId, id);
  if (d.schedule && d.schedule.status === "pending") throw new HttpError(400, "Unschedule this post first.");
  await db.draft.delete({ where: { id } });
}

/** "Upload my own": attach an image or video to this platform's draft. */
export async function attachMedia(workspaceId: string, id: string, file: File, replace: boolean) {
  const d = await ownedDraft(workspaceId, id);
  if (["scheduled", "published"].includes(d.status)) throw new HttpError(400, "Unschedule this post before changing its media.");
  if (d.status === "generating") throw new HttpError(409, "Still generating");
  const isVideo = file.type.startsWith("video/");
  const s = await storeUpload(file, isVideo ? "video" : "image", { allow: MEDIA_TYPES, prefix: `uploads/${d.platform}`, toJpeg: d.platform === "ig" });
  if (replace) await db.imageAsset.deleteMany({ where: { draftId: id } });
  await db.imageAsset.create({
    data: {
      draftId: id,
      platform: d.platform,
      sizeKey: `${s.width ?? 0}x${s.height ?? 0}`,
      width: s.width ?? 0,
      height: s.height ?? 0,
      generator: "upload",
      spec: {},
      urls: [s.url],
      mimeType: s.mimeType,
      note: s.mimeType.startsWith("video/") ? "Your video" : "Your upload",
      status: "ready",
    },
  });
  // Media is attached, so Instagram's "needs media" note no longer applies; approval restarts.
  await db.draft.update({
    where: { id },
    data: {
      warnings: d.warnings.filter((w) => !w.includes("Instagram needs an image")),
      lastError: null,
      ...(d.status === "failed" && !d.hasPost ? { status: "ready" } : {}),
      ...(d.status === "approved" ? { status: "ready" } : {}),
    },
  });
  return loadDraftDTO(id);
}
