import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { getIntegration, type IntegrationType } from "@/lib/integrations/store";
import { verifyIntegration } from "@/lib/integrations/verify";
import { canvaAccessToken } from "@/lib/integrations/creative";
import { errMsg } from "@/lib/util";

/** Test connection with the stored credentials. */
export const POST = route<{ type: string }>(async (_req, ctx, { type }) => {
  rateLimit(`itest:${ctx.workspaceId}`, 20, 60_000);
  const it = await getIntegration(ctx.workspaceId, type as IntegrationType);
  if (!it) throw new HttpError(404, "Not connected");
  try {
    const creds = type === "canva" ? { ...it.creds, accessToken: await canvaAccessToken(ctx.workspaceId) } : it.creds;
    await verifyIntegration(type, creds, it.meta);
    const now = new Date();
    await db.integration.update({ where: { id: it.row.id }, data: { verifiedAt: now, status: "connected" } });
    return { ok: true, verifiedAt: now.toISOString() };
  } catch (e) {
    throw new HttpError(400, errMsg(e));
  }
});
