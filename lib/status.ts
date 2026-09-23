import { db } from "@/lib/db";
import { CREATIVE_TOOLS } from "@/lib/integrations/store";

export type AppStatus = { claude: boolean; accountsLinked: number; accountsTotal: number; creative: number; creativeTotal: number };

/** Sidebar footer: "Claude API connected", "X of 5 accounts linked", "X of 4 creative tools". */
export async function getStatus(workspaceId: string): Promise<AppStatus> {
  const [settings, accounts, integrations] = await Promise.all([
    db.settings.findUnique({ where: { workspaceId }, select: { claudeKeyEnc: true } }),
    db.publishingAccount.findMany({ where: { workspaceId, status: "connected" }, select: { platform: true } }),
    db.integration.findMany({ where: { workspaceId, status: "connected" }, select: { type: true } }),
  ]);
  const p = new Set(accounts.map((a) => a.platform));
  // Five account rows: Meta, LinkedIn, Reddit, Medium, Quora (copy mode is always ready).
  const linked = [p.has("fb") || p.has("ig"), p.has("lip") || p.has("lic"), p.has("reddit"), p.has("medium"), true].filter(Boolean).length;
  const creative = integrations.filter((i) => (CREATIVE_TOOLS as readonly string[]).includes(i.type)).length;
  return { claude: !!settings?.claudeKeyEnc, accountsLinked: linked, accountsTotal: 5, creative, creativeTotal: CREATIVE_TOOLS.length };
}
