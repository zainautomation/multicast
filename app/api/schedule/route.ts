import { z } from "zod";
import { body, route } from "@/lib/api";
import { scheduleDraft } from "@/lib/schedule/service";
import { errMsg } from "@/lib/util";

const Item = z.object({ draftId: z.string(), runAtUtc: z.string().datetime(), mode: z.enum(["auto", "remind"]) });

/** Schedule one or many approved drafts ("Schedule" / "Schedule all"). */
export const POST = route(async (req, ctx) => {
  const { items } = await body(req, z.object({ items: z.array(Item).min(1).max(50) }));
  const results = [];
  for (const it of items) {
    try {
      const s = await scheduleDraft(ctx.workspaceId, it.draftId, new Date(it.runAtUtc), it.mode);
      results.push({ draftId: it.draftId, ok: true, item: { id: s.id, runAtUtc: s.runAtUtc.toISOString(), mode: s.mode, status: s.status } });
    } catch (e) {
      results.push({ draftId: it.draftId, ok: false, error: errMsg(e) });
    }
  }
  return { results };
});
