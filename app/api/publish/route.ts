import { z } from "zod";
import { body, route } from "@/lib/api";
import { publishMany } from "@/lib/publishers";

/** Post now: publish every approved draft in the list that can auto-post. */
export const POST = route(async (req, ctx) => {
  const { draftIds } = await body(req, z.object({ draftIds: z.array(z.string()).min(1).max(20) }));
  return { results: await publishMany(ctx.workspaceId, draftIds) };
});

// Generation, rendering and publishing can take minutes (Vercel function limit).
export const maxDuration = 300;
