import { z } from "zod";
import { body, rateLimit, route } from "@/lib/api";
import { testPrompt } from "@/lib/generation/run";
import { LAYER_IDS, RulesPatch } from "@/lib/prompts/schema";
import { HttpError } from "@/lib/errors";
import type { PlatformId } from "@/lib/platforms";

// "Test with last brief": generates a preview with the unsaved prompt; nothing is stored.
export const POST = route<{ layer: string }>(async (req, ctx, { layer }) => {
  if (!(LAYER_IDS as readonly string[]).includes(layer)) throw new HttpError(404, "Unknown layer");
  rateLimit(`gen:${ctx.workspaceId}`, 30, 60_000);
  const p = await body(req, z.object({ textPrompt: z.string().max(20_000).optional(), rules: RulesPatch.optional() }));
  return testPrompt(ctx.workspaceId, layer as PlatformId | "brand", p);
});

// Generation, rendering and publishing can take minutes (Vercel function limit).
export const maxDuration = 300;
