import { NextResponse, type NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { PROVIDERS, startUrl, type Provider } from "@/lib/oauth";
import { errMsg } from "@/lib/util";

// GET so it can be a plain link; only redirects to the provider (no state change beyond the state cookie).
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const back = provider === "canva" ? "/integrations" : "/settings";
  const ctx = await getCtx();
  if (!ctx) return NextResponse.redirect(new URL("/login", req.url));
  if (!(PROVIDERS as readonly string[]).includes(provider)) return NextResponse.redirect(new URL(`${back}?error=unknown_provider`, req.url));
  try {
    return NextResponse.redirect(await startUrl(provider as Provider, ctx.workspaceId));
  } catch (e) {
    return NextResponse.redirect(new URL(`${back}?error=${encodeURIComponent(errMsg(e))}`, req.url));
  }
}
