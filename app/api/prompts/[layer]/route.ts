import { body, route } from "@/lib/api";
import { saveLayer } from "@/lib/prompts/layers";
import { LayerPatch, LAYER_IDS } from "@/lib/prompts/schema";
import { HttpError } from "@/lib/errors";
import type { LayerId } from "@/lib/platforms";
import type { ImageDefaults, OutputRules } from "@/lib/prompts/defaults";

export const PUT = route<{ layer: string }>(async (req, ctx, { layer }) => {
  if (!(LAYER_IDS as readonly string[]).includes(layer)) throw new HttpError(404, "Unknown layer");
  const p = await body(req, LayerPatch);
  const saved = await saveLayer(ctx.workspaceId, layer as LayerId, {
    ...p,
    rules: p.rules as Partial<OutputRules> | undefined,
    imageDefaults: p.imageDefaults as Partial<ImageDefaults> | undefined,
  });
  return { layer: saved };
});
