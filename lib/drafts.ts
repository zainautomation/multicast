import { db } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { getLayers } from "@/lib/prompts/layers";
import { loadBrand } from "@/lib/brand";
import { linkPolicyFromRules, validateDraft } from "@/lib/generation/validate";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";
import { draftDTO, packWarnings, splitWarnings } from "@/lib/dto";

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
    { title: d.title, body: d.body, firstComment: d.firstComment, hashtags: d.hashtags },
    { bannedPhrases: brand.bannedPhrases, linkPolicy: linkPolicyFromRules(layer.rules.cta, PLATFORMS[platform].linkPolicy), link: d.brief.link, hashtagRule: layer.rules.hashtags },
  );
  const keep = splitWarnings(d.warnings).notes.filter((n) => /^(Image|Instagram needs|r\/.+ does not allow)/.test(n));
  return { errors: v.errors, notes: [...v.notes, ...keep] };
}

export async function loadDraftDTO(id: string) {
  return draftDTO(await db.draft.findUniqueOrThrow({ where: { id }, include: { images: true, schedule: true } }));
}

export { packWarnings };
