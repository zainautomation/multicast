import { z } from "zod";
import { body, route } from "@/lib/api";
import { db } from "@/lib/db";
import { encryptJson, last4 } from "@/lib/crypto";
import { HttpError } from "@/lib/errors";
import { getIntegration, saveIntegration, type Creds } from "@/lib/integrations/store";
import { verifyIntegration } from "@/lib/integrations/verify";

const TYPES = ["canva", "figma", "higgsfield", "heygen", "custom", "slack"] as const;
const s = z.string().trim().max(2000);

const SCHEMAS: Record<(typeof TYPES)[number], z.ZodType<{ creds: Creds; meta?: Record<string, unknown> }>> = {
  canva: z.object({ creds: z.object({ clientId: s.min(3), clientSecret: s.min(3) }), meta: z.object({ defaultBrandTemplateId: s.optional() }).optional() }),
  figma: z.object({ creds: z.object({ token: s.min(10), fileKey: s.optional().default("") }) }),
  higgsfield: z.object({ creds: z.object({ apiKey: s.min(6), apiSecret: s.min(6) }), meta: z.object({ baseUrl: s.url().optional(), model: s.optional() }).optional() }),
  heygen: z.object({ creds: z.object({ apiKey: s.min(10), avatarId: s.optional().default(""), voiceId: s.optional().default("") }) }),
  custom: z.object({ creds: z.object({ webhookUrl: s.url().refine((u) => u.startsWith("https://") || u.startsWith("http://localhost"), "Use an https:// URL"), apiKey: s.optional().default("") }), meta: z.object({ name: s.max(60).optional() }).optional() }),
  slack: z.object({
    creds: z.object({ botToken: s.optional().default(""), signingSecret: s.optional().default(""), webhookUrl: s.optional().default("") }),
    meta: z.object({ method: z.enum(["bot", "hook"]), channel: s.max(80).optional() }),
  }),
};

const SECRET_FIELD: Record<string, string> = { canva: "clientSecret", figma: "token", higgsfield: "apiKey", heygen: "apiKey", custom: "webhookUrl", slack: "botToken" };

function typeOf(t: string) {
  if (!(TYPES as readonly string[]).includes(t)) throw new HttpError(404, "Unknown integration");
  return t as (typeof TYPES)[number];
}

/**
 * Connect: verify with a test call, then store encrypted. Canva is OAuth: the client ID and
 * secret are stored as "pending" and the browser is sent through /api/oauth/canva/start.
 */
export const POST = route<{ type: string }>(async (req, ctx, { type }) => {
  const t = typeOf(type);
  const p = await body(req, SCHEMAS[t]);
  const meta = { ...(p.meta ?? {}) } as Record<string, unknown>;
  if (t === "figma" && p.creds.fileKey) meta.fileKey = p.creds.fileKey;

  if (t === "canva") {
    const data = { credentialsEnc: encryptJson(p.creds), last4: last4(p.creds.clientId), status: "pending", meta: meta as object };
    await db.integration.upsert({ where: { workspaceId_type: { workspaceId: ctx.workspaceId, type: t } }, create: { workspaceId: ctx.workspaceId, type: t, ...data }, update: data });
    return { redirect: "/api/oauth/canva/start" };
  }
  if (t === "slack") {
    // Keep existing secrets when the owner only changes channel/method.
    const cur = await getIntegration(ctx.workspaceId, "slack");
    for (const k of ["botToken", "signingSecret", "webhookUrl"]) if (!p.creds[k] && cur?.creds[k]) p.creds[k] = cur.creds[k];
  }
  const identity = await verifyIntegration(t, p.creds, meta);
  if (identity) meta.identity = identity;
  const secretField = t === "slack" && meta.method === "hook" ? "webhookUrl" : SECRET_FIELD[t];
  await saveIntegration(ctx.workspaceId, t, p.creds, meta, secretField);
  return { ok: true };
});

export const DELETE = route<{ type: string }>(async (_req, ctx, { type }) => {
  const t = typeOf(type);
  await db.integration.deleteMany({ where: { workspaceId: ctx.workspaceId, type: t } });
  return { ok: true };
});

/** Update non-secret settings (e.g. Canva brand template ids, Slack channel). */
export const PATCH = route<{ type: string }>(async (req, ctx, { type }) => {
  const t = typeOf(type);
  const patch = await body(req, z.record(z.string(), z.union([z.string().max(200), z.record(z.string(), z.string().max(200))])));
  const row = await db.integration.findUnique({ where: { workspaceId_type: { workspaceId: ctx.workspaceId, type: t } } });
  if (!row) throw new HttpError(404, "Not connected");
  await db.integration.update({ where: { id: row.id }, data: { meta: { ...((row.meta as object) ?? {}), ...patch } } });
  return { ok: true };
});
