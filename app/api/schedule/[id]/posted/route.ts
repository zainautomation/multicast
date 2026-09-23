import { z } from "zod";
import { body, route } from "@/lib/api";
import { markPosted } from "@/lib/schedule/service";

/** "Mark as posted" after a reminder, optionally recording the live URL. */
export const POST = route<{ id: string }>(async (req, ctx, { id }) => {
  const { url } = await body(req, z.object({ url: z.string().url().optional().or(z.literal("")) }));
  await markPosted(ctx.workspaceId, id, url || null);
  return { ok: true };
});
