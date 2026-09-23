import { z } from "zod";
import { body, route, rateLimit } from "@/lib/api";
import { db } from "@/lib/db";
import { decrypt, encrypt, last4 } from "@/lib/crypto";
import { testKey } from "@/lib/claude";
import { HttpError } from "@/lib/errors";

// Save (after a successful test call) or re-test the stored key. The key never goes back to the browser.
export const POST = route(async (req, ctx) => {
  rateLimit(`keytest:${ctx.workspaceId}`, 10, 60_000);
  const { apiKey } = await body(req, z.object({ apiKey: z.string().trim().optional() }));
  const s = await db.settings.findUniqueOrThrow({ where: { workspaceId: ctx.workspaceId } });
  const key = apiKey || (s.claudeKeyEnc ? decrypt(s.claudeKeyEnc) : null);
  if (!key) throw new HttpError(400, "Paste your Claude API key first");
  await testKey(key);
  const now = new Date();
  await db.settings.update({
    where: { workspaceId: ctx.workspaceId },
    data: apiKey ? { claudeKeyEnc: encrypt(apiKey), claudeKeyLast4: last4(apiKey), claudeVerifiedAt: now } : { claudeVerifiedAt: now },
  });
  return { ok: true, last4: apiKey ? last4(apiKey) : s.claudeKeyLast4, verifiedAt: now.toISOString() };
});

export const DELETE = route(async (_req, ctx) => {
  await db.settings.update({ where: { workspaceId: ctx.workspaceId }, data: { claudeKeyEnc: null, claudeKeyLast4: null, claudeVerifiedAt: null } });
  return { ok: true };
});
