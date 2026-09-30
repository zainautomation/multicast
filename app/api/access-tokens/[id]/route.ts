import { route } from "@/lib/api";
import { db } from "@/lib/db";

/** Revoke an API key or disconnect an MCP app; it stops working on its next request. */
export const DELETE = route<{ id: string }>(async (_req, ctx, { id }) => {
  await db.apiToken.deleteMany({ where: { id, workspaceId: ctx.workspaceId } });
  return { ok: true };
});
