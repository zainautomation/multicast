import { z } from "zod";
import { body, route } from "@/lib/api";
import { approveDraft } from "@/lib/drafts";

/** Approve (or un-approve). Blocked while the draft breaks platform rules (spec 9.4). */
export const POST = route<{ id: string }>(async (req, ctx, { id }) => {
  const { approved } = await body(req, z.object({ approved: z.boolean() }));
  return { draft: await approveDraft(ctx.workspaceId, id, approved) };
});
