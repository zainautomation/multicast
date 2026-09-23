import { z } from "zod";
import { body, route } from "@/lib/api";
import { db } from "@/lib/db";
import { saveLayer } from "@/lib/prompts/layers";
import { HttpError } from "@/lib/errors";
import type { LayerId } from "@/lib/platforms";
import type { ImageDefaults, OutputRules } from "@/lib/prompts/defaults";

async function layerRow(workspaceId: string, platform: string) {
  const l = await db.promptLayer.findUnique({ where: { workspaceId_platform: { workspaceId, platform } } });
  if (!l) throw new HttpError(404, "Unknown layer");
  return l;
}

export const GET = route<{ layer: string }>(async (_req, ctx, { layer }) => {
  const l = await layerRow(ctx.workspaceId, layer);
  const versions = await db.promptVersion.findMany({ where: { layerId: l.id }, orderBy: { version: "desc" }, take: 20 });
  return { current: l.version, versions: versions.map((v) => ({ version: v.version, createdAt: v.createdAt, textPrompt: v.textPrompt, imagePrompt: v.imagePrompt })) };
});

// Restore a version: saved as a new version so history stays linear.
export const POST = route<{ layer: string }>(async (req, ctx, { layer }) => {
  const { version } = await body(req, z.object({ version: z.number().int() }));
  const l = await layerRow(ctx.workspaceId, layer);
  const v = await db.promptVersion.findFirst({ where: { layerId: l.id, version } });
  if (!v) throw new HttpError(404, "Version not found");
  const saved = await saveLayer(ctx.workspaceId, layer as LayerId, {
    textPrompt: v.textPrompt,
    imagePrompt: v.imagePrompt,
    rules: v.rules as OutputRules,
    imageDefaults: v.imageDefaults as ImageDefaults,
  });
  return { layer: saved };
});
