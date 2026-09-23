import { db } from "@/lib/db";
import { PLATFORM_IDS, type LayerId } from "@/lib/platforms";
import {
  BRAND_IMAGE_DEFAULTS,
  DEFAULT_BANNED_PHRASES,
  DEFAULT_IMAGE_DEFAULTS,
  DEFAULT_IMAGE_PROMPTS,
  DEFAULT_RULES,
  DEFAULT_TEXT_PROMPTS,
  DEFAULT_WINDOWS,
  SEED_BACKGROUNDS,
  SEED_TEXT_COLORS,
} from "@/lib/prompts/defaults";

export function defaultLayer(platform: LayerId) {
  return {
    platform,
    enabled: true,
    textPrompt: DEFAULT_TEXT_PROMPTS[platform],
    imagePrompt: DEFAULT_IMAGE_PROMPTS[platform],
    rules: platform === "brand" ? {} : DEFAULT_RULES[platform],
    imageDefaults: platform === "brand" ? BRAND_IMAGE_DEFAULTS : DEFAULT_IMAGE_DEFAULTS[platform],
  };
}

const seeded = new Set<string>();

/** Idempotently create all per-workspace rows with the seed data from the spec. */
export async function ensureSeeded(workspaceId: string) {
  if (seeded.has(workspaceId)) return;
  const [layers, windows, settings] = await Promise.all([
    db.promptLayer.count({ where: { workspaceId } }),
    db.postingWindow.count({ where: { workspaceId } }),
    db.settings.count({ where: { workspaceId } }),
  ]);
  if (layers >= PLATFORM_IDS.length + 1 && windows >= PLATFORM_IDS.length && settings) {
    seeded.add(workspaceId);
    return;
  }
  await seedAll(workspaceId);
  seeded.add(workspaceId);
}

async function seedAll(workspaceId: string) {
  await db.settings.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} });
  await db.brandKit.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      sigCompany: "[YOUR COMPANY] · [yourwebsite.com]",
      sigPersonal: "[YOUR NAME] · [YOUR TITLE]",
      backgrounds: SEED_BACKGROUNDS,
      textColors: SEED_TEXT_COLORS,
      bannedPhrases: DEFAULT_BANNED_PHRASES,
    },
    update: {},
  });
  await db.notificationPref.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} });

  const layers: LayerId[] = ["brand", ...PLATFORM_IDS];
  const existing = await db.promptLayer.findMany({ where: { workspaceId }, select: { platform: true } });
  const have = new Set(existing.map((l) => l.platform));
  for (const p of layers) {
    if (have.has(p)) continue;
    const d = defaultLayer(p);
    const layer = await db.promptLayer.create({ data: { workspaceId, ...d } });
    await db.promptVersion.create({
      data: { layerId: layer.id, version: 1, textPrompt: d.textPrompt, imagePrompt: d.imagePrompt, rules: d.rules, imageDefaults: d.imageDefaults },
    });
  }

  const windows = await db.postingWindow.findMany({ where: { workspaceId }, select: { platform: true } });
  const haveW = new Set(windows.map((w) => w.platform));
  for (const p of PLATFORM_IDS) {
    if (haveW.has(p)) continue;
    await db.postingWindow.create({ data: { workspaceId, platform: p, ...DEFAULT_WINDOWS[p] } });
  }
}

export async function createWorkspaceWithOwner(email: string, passwordHash: string, name?: string) {
  const ws = await db.workspace.create({ data: { name: name ? `${name}'s workspace` : "My workspace" } });
  await db.user.create({ data: { workspaceId: ws.id, email: email.toLowerCase(), passwordHash, name } });
  await ensureSeeded(ws.id);
  return ws;
}
