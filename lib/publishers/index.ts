import type { Draft, ImageAsset } from "@prisma/client";
import { db } from "@/lib/db";
import type { PlatformId } from "@/lib/platforms";
import { PLATFORMS } from "@/lib/platforms";
import { facebookPublisher, instagramPublisher } from "@/lib/publishers/meta";
import { linkedinCompanyPublisher, linkedinProfilePublisher } from "@/lib/publishers/linkedin";
import { redditPublisher } from "@/lib/publishers/reddit";
import { mediumPublisher } from "@/lib/publishers/medium";
import { accountToken, getAccount } from "@/lib/publishers/accounts";
import { PublishError, type Publisher } from "@/lib/publishers/types";
import { splitWarnings } from "@/lib/dto";
import { notify } from "@/lib/notify";
import { errMsg } from "@/lib/util";

const PUBLISHERS: Partial<Record<PlatformId, Publisher>> = {
  fb: facebookPublisher,
  ig: instagramPublisher,
  lip: linkedinProfilePublisher,
  lic: linkedinCompanyPublisher,
  reddit: redditPublisher,
  medium: mediumPublisher,
  // Quora: copy mode only (no public API)
};

export function publisherFor(p: PlatformId): Publisher | null {
  return PUBLISHERS[p] ?? null;
}

/** Whether this draft's platform can post automatically right now. */
export async function canAuto(workspaceId: string, platform: PlatformId): Promise<boolean> {
  const pub = publisherFor(platform);
  if (!pub || PLATFORMS[platform].publish.kind === "copy") return false;
  if (platform === "lic" && process.env.LINKEDIN_COMPANY_ENABLED !== "true") return false;
  return pub.canAutoPublish(await getAccount(workspaceId, platform));
}

type DraftFull = Draft & { images: ImageAsset[]; brief: { subreddit: string | null } };

/** Pre-flight validate → refresh token → publish → store URL → notify. Throws PublishError. */
export async function publishDraft(workspaceId: string, draftId: string): Promise<{ url: string }> {
  const d = (await db.draft.findUniqueOrThrow({ where: { id: draftId }, include: { images: true, brief: { select: { subreddit: true } } } })) as DraftFull;
  const platform = d.platform as PlatformId;
  const pub = publisherFor(platform);
  if (!pub) throw new PublishError(`${PLATFORMS[platform].name} has no posting API; use copy mode`, false);
  const { errors } = splitWarnings(d.warnings);
  if (errors.length) throw new PublishError(`Fix before posting: ${errors.join(" ")}`, false);
  const images = d.images.filter((i) => i.status === "ready" || i.status === "approved");
  const pre = pub.validate(d, images);
  if (pre.length) throw new PublishError(pre.join("; "), false);

  const account = await getAccount(workspaceId, platform);
  if (!account) throw new PublishError(`Connect ${PLATFORMS[platform].name} in Claude API & accounts first`, false);
  let token: string | null;
  try {
    token = await accountToken(workspaceId, platform);
  } catch (e) {
    throw new PublishError(errMsg(e), false);
  }
  if (!token) throw new PublishError("No access token", false);

  try {
    const res = await pub.publish(d, images, account, token);
    await db.draft.update({ where: { id: draftId }, data: { status: "published", externalId: res.externalId, externalUrl: res.url, publishedAt: new Date(), lastError: null } });
    await notify(workspaceId, "published", { draft: d, url: res.url }).catch(() => undefined);
    return { url: res.url };
  } catch (e) {
    const msg = errMsg(e);
    await db.draft.update({ where: { id: draftId }, data: { lastError: msg } });
    throw e instanceof PublishError ? e : new PublishError(msg, true);
  }
}
