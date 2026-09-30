import { z } from "zod";
import { body, route } from "@/lib/api";
import { deleteDraft, editDraft } from "@/lib/drafts";

const Edit = z.object({
  title: z.string().max(1000).nullable().optional(),
  subtitle: z.string().max(1000).nullable().optional(),
  slug: z.string().max(120).nullable().optional(),
  hashtags: z.array(z.string().max(100)).max(30).optional(),
  body: z.string().max(100_000).optional(),
  firstComment: z.string().max(3000).nullable().optional(),
  useVariant: z.number().int().min(0).max(2).optional(),
});

/** Inline edit. Editing an approved draft sends it back for approval; validation re-runs. */
export const PATCH = route<{ id: string }>(async (req, ctx, { id }) => {
  const e = await body(req, Edit);
  return { draft: await editDraft(ctx.workspaceId, id, e) };
});

export const DELETE = route<{ id: string }>(async (_req, ctx, { id }) => {
  await deleteDraft(ctx.workspaceId, id);
  return { ok: true };
});
