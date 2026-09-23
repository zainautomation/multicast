import { z } from "zod";
import { body, route } from "@/lib/api";
import { getAccount } from "@/lib/publishers/accounts";
import { saveMetaPage, type MetaPage } from "@/lib/oauth";
import { HttpError } from "@/lib/errors";

// Switch which Facebook Page (and its linked Instagram account) Multicast posts to.
export const PUT = route(async (req, ctx) => {
  const { pageId } = await body(req, z.object({ pageId: z.string() }));
  const fb = await getAccount(ctx.workspaceId, "fb");
  const t = fb?.tokens as unknown as { userToken?: string; pages?: MetaPage[] } | undefined;
  const page = t?.pages?.find((p) => p.id === pageId);
  if (!fb || !t?.userToken || !page) throw new HttpError(404, "Page not found; reconnect Meta");
  await saveMetaPage(ctx.workspaceId, t.userToken, t.pages!, page);
  return { ok: true };
});
