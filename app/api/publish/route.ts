import { z } from "zod";
import { body, route } from "@/lib/api";
import { db } from "@/lib/db";
import { canAuto, publishDraft } from "@/lib/publishers";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";
import { errMsg } from "@/lib/util";

type Result = { draftId: string; platform: string; ok: boolean; url?: string; error?: string; skipped?: string };

/** Post now: publish every approved draft in the list that can auto-post. */
export const POST = route(async (req, ctx) => {
  const { draftIds } = await body(req, z.object({ draftIds: z.array(z.string()).min(1).max(20) }));
  const drafts = await db.draft.findMany({ where: { id: { in: draftIds }, workspaceId: ctx.workspaceId } });
  const results: Result[] = [];
  for (const d of drafts) {
    const p = d.platform as PlatformId;
    if (d.status !== "approved") {
      results.push({ draftId: d.id, platform: p, ok: false, skipped: "Not approved" });
      continue;
    }
    if (!(await canAuto(ctx.workspaceId, p))) {
      results.push({ draftId: d.id, platform: p, ok: false, skipped: PLATFORMS[p].publish.kind === "copy" ? "Copy mode" : `${PLATFORMS[p].name} is not connected` });
      continue;
    }
    try {
      const r = await publishDraft(ctx.workspaceId, d.id);
      results.push({ draftId: d.id, platform: p, ok: true, url: r.url });
    } catch (e) {
      results.push({ draftId: d.id, platform: p, ok: false, error: errMsg(e) });
    }
  }
  return { results };
});

// Generation, rendering and publishing can take minutes (Vercel function limit).
export const maxDuration = 300;
