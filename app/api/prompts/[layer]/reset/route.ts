import { z } from "zod";
import { body, route } from "@/lib/api";
import { saveLayer } from "@/lib/prompts/layers";
import { LAYER_IDS } from "@/lib/prompts/schema";
import { defaultLayer } from "@/lib/workspace";
import { HttpError } from "@/lib/errors";
import type { LayerId } from "@/lib/platforms";
import type { ImageDefaults, OutputRules } from "@/lib/prompts/defaults";

// Reset the text tab (prompt + output rules) or the image tab (prompt + image defaults).
export const POST = route<{ layer: string }>(async (req, ctx, { layer }) => {
  if (!(LAYER_IDS as readonly string[]).includes(layer)) throw new HttpError(404, "Unknown layer");
  const { tab } = await body(req, z.object({ tab: z.enum(["text", "image"]) }));
  const d = defaultLayer(layer as LayerId);
  const saved = await saveLayer(
    ctx.workspaceId,
    layer as LayerId,
    tab === "text" ? { textPrompt: d.textPrompt, rules: d.rules as OutputRules } : { imagePrompt: d.imagePrompt, imageDefaults: d.imageDefaults as ImageDefaults },
  );
  return { layer: saved };
});
