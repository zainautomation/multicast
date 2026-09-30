import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui";
import { AUTHORIZE_KEYS, checkAuthorize, type AuthorizeParams } from "@/lib/mcp/authorize";

export const dynamic = "force-dynamic";

/** Consent screen for MCP clients (e.g. a Claude connector) asking to act on this workspace. */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = Object.fromEntries(AUTHORIZE_KEYS.map((k) => [k, sp[k]])) as AuthorizeParams;
  const ctx = await getCtx();
  if (!ctx) {
    const here = `/oauth/authorize?${new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1])).toString()}`;
    redirect(`/login?next=${encodeURIComponent(here)}`);
  }
  const c = await checkAuthorize(p);
  const user = await db.user.findUnique({ where: { id: ctx.userId }, select: { email: true } });

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="flex w-full max-w-[460px] flex-col gap-5 rounded-[16px] border border-line bg-surface p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-accent font-display text-xl font-semibold text-white">M</div>
          <div className="flex flex-col">
            <span className="font-display text-[22px] font-semibold">Multicast</span>
            <span className="text-[13px] text-caption">Signed in as {user?.email}</span>
          </div>
        </div>
        {"error" in c ? (
          <>
            <h1 className="m-0 font-display text-[26px] font-medium">Can&apos;t connect this app</h1>
            <p role="alert" className="m-0 text-[14px] leading-normal text-danger-text">
              {c.error}
            </p>
          </>
        ) : (
          <form method="post" action="/api/mcp-oauth/authorize" className="flex flex-col gap-5">
            <h1 className="m-0 font-display text-[26px] font-medium">Allow {c.client.name} to use Multicast?</h1>
            <div className="flex flex-col gap-2 text-[14px] leading-normal text-muted">
              <p className="m-0">It will be able to:</p>
              <ul className="m-0 flex flex-col gap-1 pl-5">
                <li>read your drafts, schedule and published posts</li>
                <li>write, edit and approve posts, and generate images with your Claude key</li>
                <li>publish and schedule posts on your connected accounts</li>
              </ul>
              <p className="m-0 text-[13px] text-caption">
                Sends you back to <span className="font-mono">{new URL(c.redirectUri).host}</span>. You can revoke access any time in Claude API &amp; accounts → External access.
              </p>
            </div>
            {AUTHORIZE_KEYS.map((k) => (p[k] ? <input key={k} type="hidden" name={k} value={p[k]} /> : null))}
            {!p.redirect_uri ? <input type="hidden" name="redirect_uri" value={c.redirectUri} /> : null}
            <div className="flex gap-2.5">
              <Button type="submit" name="decision" value="allow" variant="primary" size="lg" className="flex-1">
                Allow
              </Button>
              <Button type="submit" name="decision" value="deny" size="lg" className="flex-1">
                Deny
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
