import { NextResponse, type NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { finish, PROVIDERS, type Provider } from "@/lib/oauth";
import { errMsg } from "@/lib/util";
import { appUrl } from "@/lib/env";

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const back = provider === "canva" ? "/integrations" : "/settings";
  const app = (process.env.APP_URL || process.env.VERCEL) ? appUrl() : req.nextUrl.origin; // set URL, else Vercel URL, else request origin
  const ctx = await getCtx();
  if (!ctx) return NextResponse.redirect(new URL("/login", app));
  const sp = req.nextUrl.searchParams;
  if (!(PROVIDERS as readonly string[]).includes(provider)) return NextResponse.redirect(new URL(`${back}?error=unknown_provider`, app));
  // OAuth 1.0a (X) returns oauth_token + oauth_verifier, or denied=… when cancelled.
  const denied = sp.get("error_description") || sp.get("error") || (sp.get("denied") ? "You cancelled the X sign-in" : null);
  if (denied) return NextResponse.redirect(new URL(`${back}?error=${encodeURIComponent(denied)}`, app));
  const code = sp.get("code") ?? sp.get("oauth_verifier");
  if (!code) return NextResponse.redirect(new URL(`${back}?error=missing_code`, app));
  try {
    await finish(provider as Provider, ctx.workspaceId, code, sp.get("state") ?? sp.get("oauth_token"));
    return NextResponse.redirect(new URL(`${back}?connected=${provider}`, app));
  } catch (e) {
    return NextResponse.redirect(new URL(`${back}?error=${encodeURIComponent(errMsg(e))}`, app));
  }
}
