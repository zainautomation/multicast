import { route } from "@/lib/api";
import { retryItem } from "@/lib/schedule/service";

export const POST = route<{ id: string }>(async (_req, ctx, { id }) => {
  await retryItem(ctx.workspaceId, id);
  return { ok: true };
});

// Generation, rendering and publishing can take minutes (Vercel function limit).
export const maxDuration = 300;
