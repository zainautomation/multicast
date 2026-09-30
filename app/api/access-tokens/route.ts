import { z } from "zod";
import { body, route } from "@/lib/api";
import { db } from "@/lib/db";
import { createApiKey } from "@/lib/tokens";

/** External access: API keys and connected MCP apps. Secrets are never listed. */
export const GET = route(async (_req, ctx) => {
  const rows = await db.apiToken.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { createdAt: "desc" } });
  return {
    tokens: rows.map((t) => ({ id: t.id, kind: t.kind, name: t.name, hint: t.hint, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt })),
  };
});

/** New API key; the secret is in this response only. */
export const POST = route(async (req, ctx) => {
  const { name } = await body(req, z.object({ name: z.string().trim().min(1, "Name the key").max(60) }));
  const count = await db.apiToken.count({ where: { workspaceId: ctx.workspaceId, kind: "key" } });
  if (count >= 20) return Response.json({ error: "You have 20 API keys; revoke one first." }, { status: 400 });
  return createApiKey(ctx.workspaceId, name);
});
