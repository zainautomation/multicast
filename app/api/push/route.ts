import { z } from "zod";
import { body, route } from "@/lib/api";
import { db } from "@/lib/db";

const Sub = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) });

/** Save this browser's push subscription for reminder notifications. */
export const POST = route(async (req, ctx) => {
  const s = await body(req, Sub);
  await db.pushSubscription.upsert({ where: { endpoint: s.endpoint }, create: { workspaceId: ctx.workspaceId, endpoint: s.endpoint, keys: s.keys }, update: { keys: s.keys, workspaceId: ctx.workspaceId } });
  return { ok: true };
});

export const DELETE = route(async (req, ctx) => {
  const { endpoint } = await body(req, z.object({ endpoint: z.string().url() }));
  await db.pushSubscription.deleteMany({ where: { endpoint, workspaceId: ctx.workspaceId } });
  return { ok: true };
});
