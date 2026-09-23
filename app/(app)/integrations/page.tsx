import { db } from "@/lib/db";
import { requireCtx } from "@/lib/auth";
import { IntegrationsClient, type ToolView } from "@/components/integrations/IntegrationsClient";
import { appUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const [rows, pref] = await Promise.all([
    db.integration.findMany({ where: { workspaceId: ctx.workspaceId } }),
    db.notificationPref.findUniqueOrThrow({ where: { workspaceId: ctx.workspaceId } }),
  ]);
  const view = (type: string): ToolView => {
    const r = rows.find((x) => x.type === type);
    return r
      ? { status: r.status as ToolView["status"], last4: r.last4, verifiedAt: r.verifiedAt?.toISOString() ?? null, meta: (r.meta ?? {}) as Record<string, unknown> }
      : { status: "off", last4: null, verifiedAt: null, meta: {} };
  };
  return (
    <IntegrationsClient
      flash={{ connected: sp.connected ?? null, error: sp.error ?? null }}
      tools={{ canva: view("canva"), figma: view("figma"), higgsfield: view("higgsfield"), heygen: view("heygen"), custom: view("custom") }}
      slack={view("slack")}
      events={pref.events}
      appUrl={appUrl()}
    />
  );
}
