import type { PromptLayer } from "@prisma/client";
import { db } from "@/lib/db";
import type { LayerId, PlatformId } from "@/lib/platforms";
import type { ImageDefaults, OutputRules } from "@/lib/prompts/defaults";
import { DEFAULT_IMAGE_DEFAULTS, DEFAULT_RULES } from "@/lib/prompts/defaults";

export type Layer = Omit<PromptLayer, "rules" | "imageDefaults"> & { rules: OutputRules; imageDefaults: ImageDefaults };

export const HISTORY_LIMIT = 20;

export function asLayer(l: PromptLayer): Layer {
  const p = l.platform as PlatformId;
  return {
    ...l,
    rules: { ...(DEFAULT_RULES[p] ?? {}), ...(l.rules as object) } as OutputRules,
    imageDefaults: { ...(DEFAULT_IMAGE_DEFAULTS[p] ?? {}), ...(l.imageDefaults as object) } as ImageDefaults,
  };
}

export async function getLayers(workspaceId: string): Promise<Record<LayerId, Layer>> {
  const rows = await db.promptLayer.findMany({ where: { workspaceId } });
  return Object.fromEntries(rows.map((r) => [r.platform, asLayer(r)])) as Record<LayerId, Layer>;
}

/** The PromptVersion row id matching the layer's current version (stored on each draft). */
export async function currentVersionId(layer: Layer): Promise<string | null> {
  const v = await db.promptVersion.findFirst({ where: { layerId: layer.id, version: layer.version }, select: { id: true } });
  return v?.id ?? null;
}

export async function saveLayer(
  workspaceId: string,
  platform: LayerId,
  patch: { textPrompt?: string; imagePrompt?: string; rules?: Partial<OutputRules>; imageDefaults?: Partial<ImageDefaults>; enabled?: boolean },
) {
  const cur = await db.promptLayer.findUniqueOrThrow({ where: { workspaceId_platform: { workspaceId, platform } } });
  const layer = asLayer(cur);
  const next = {
    textPrompt: patch.textPrompt ?? layer.textPrompt,
    imagePrompt: patch.imagePrompt ?? layer.imagePrompt,
    rules: { ...layer.rules, ...(patch.rules ?? {}) },
    imageDefaults: {
      ...layer.imageDefaults,
      ...(patch.imageDefaults ?? {}),
      include: { ...layer.imageDefaults.include, ...(patch.imageDefaults?.include ?? {}) },
    },
  };
  const changed =
    next.textPrompt !== layer.textPrompt ||
    next.imagePrompt !== layer.imagePrompt ||
    JSON.stringify(next.rules) !== JSON.stringify(layer.rules) ||
    JSON.stringify(next.imageDefaults) !== JSON.stringify(layer.imageDefaults);

  const version = changed ? cur.version + 1 : cur.version;
  const updated = await db.promptLayer.update({
    where: { id: cur.id },
    data: { ...next, enabled: patch.enabled ?? cur.enabled, version },
  });
  if (changed) {
    await db.promptVersion.create({ data: { layerId: cur.id, version, ...next } });
    const old = await db.promptVersion.findMany({ where: { layerId: cur.id }, orderBy: { version: "desc" }, skip: HISTORY_LIMIT, select: { id: true } });
    if (old.length) await db.promptVersion.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  }
  return asLayer(updated);
}
