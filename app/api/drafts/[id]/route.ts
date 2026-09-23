import { z } from "zod";
import { body, route } from "@/lib/api";
import { db } from "@/lib/db";
import { loadDraftDTO, ownedDraft, packWarnings, revalidate } from "@/lib/drafts";
import { HttpError } from "@/lib/errors";

const Edit = z.object({
  title: z.string().max(1000).nullable().optional(),
  subtitle: z.string().max(1000).nullable().optional(),
  body: z.string().max(100_000).optional(),
  firstComment: z.string().max(3000).nullable().optional(),
  hashtags: z.array(z.string().max(100)).max(30).optional(),
  useVariant: z.number().int().min(0).max(2).optional(),
});

type Variant = { title: string | null; subtitle?: string | null; body: string; first_comment: string | null; hashtags: string[] };

/** Inline edit. Editing an approved draft sends it back for approval; validation re-runs. */
export const PATCH = route<{ id: string }>(async (req, ctx, { id }) => {
  const d = await ownedDraft(ctx.workspaceId, id);
  if (["scheduled", "published"].includes(d.status)) throw new HttpError(400, d.status === "scheduled" ? "Unschedule this post before editing it." : "This post is already live.");
  const e = await body(req, Edit);
  let data: Record<string, unknown>;
  if (e.useVariant !== undefined) {
    // Swap the chosen variant into the main slot (the current text becomes a variant).
    const variants = ((d.variants as Variant[] | null) ?? []).slice();
    const v = variants[e.useVariant];
    if (!v) throw new HttpError(404, "Variant not found");
    variants[e.useVariant] = { title: d.title, subtitle: d.subtitle, body: d.body ?? "", first_comment: d.firstComment, hashtags: d.hashtags };
    data = { title: v.title, subtitle: v.subtitle ?? null, body: v.body, firstComment: v.first_comment, hashtags: v.hashtags, variants };
  } else {
    const { useVariant: _u, ...fields } = e;
    data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  }
  await db.draft.update({ where: { id }, data });
  const v = await revalidate(ctx.workspaceId, id);
  await db.draft.update({ where: { id }, data: { warnings: packWarnings(v.errors, v.notes), status: v.errors.length ? "warning" : "ready", lastError: null } });
  return { draft: await loadDraftDTO(id) };
});

export const DELETE = route<{ id: string }>(async (_req, ctx, { id }) => {
  const d = await ownedDraft(ctx.workspaceId, id);
  if (d.schedule && d.schedule.status === "pending") throw new HttpError(400, "Unschedule this post first.");
  await db.draft.delete({ where: { id } });
  return { ok: true };
});
