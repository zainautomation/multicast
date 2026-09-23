import { z } from "zod";
import { body, route } from "@/lib/api";
import { saveAccount } from "@/lib/publishers/accounts";
import { verifyMediumToken } from "@/lib/publishers/medium";
import { HttpError } from "@/lib/errors";
import { errMsg } from "@/lib/util";

export const POST = route(async (req, ctx) => {
  const { token } = await body(req, z.object({ token: z.string().trim().min(10) }));
  let me;
  try {
    me = await verifyMediumToken(token);
  } catch (e) {
    throw new HttpError(400, `Medium rejected the token: ${errMsg(e)}`);
  }
  await saveAccount(ctx.workspaceId, "medium", { tokens: { accessToken: token }, displayName: `@${me.username}`, meta: { userId: me.id, username: me.username } });
  return { ok: true, displayName: `@${me.username}` };
});
