import { db } from "@/lib/db";
import { decryptJson, encryptJson, last4 } from "@/lib/crypto";

export const CREATIVE_TOOLS = ["canva", "figma", "higgsfield", "heygen"] as const;
export type IntegrationType = (typeof CREATIVE_TOOLS)[number] | "custom" | "slack";

export type Creds = Record<string, string>;

export async function getIntegration(workspaceId: string, type: IntegrationType) {
  const row = await db.integration.findUnique({ where: { workspaceId_type: { workspaceId, type } } });
  if (!row || row.status !== "connected") return null;
  return { row, creds: decryptJson<Creds>(row.credentialsEnc), meta: (row.meta ?? {}) as Record<string, unknown> };
}

export async function saveIntegration(workspaceId: string, type: IntegrationType, creds: Creds, meta: Record<string, unknown> = {}, secretField?: string) {
  const secret = secretField ? creds[secretField] : Object.values(creds).find(Boolean) ?? "";
  const data = {
    credentialsEnc: encryptJson(creds),
    last4: secret ? last4(secret) : null,
    status: "connected",
    meta: meta as object,
    verifiedAt: new Date(),
  };
  return db.integration.upsert({
    where: { workspaceId_type: { workspaceId, type } },
    create: { workspaceId, type, ...data },
    update: data,
  });
}

export async function updateCreds(workspaceId: string, type: IntegrationType, patch: Creds) {
  const cur = await getIntegration(workspaceId, type);
  if (!cur) return;
  await db.integration.update({ where: { id: cur.row.id }, data: { credentialsEnc: encryptJson({ ...cur.creds, ...patch }) } });
}

export async function connectedTypes(workspaceId: string): Promise<Set<string>> {
  const rows = await db.integration.findMany({ where: { workspaceId, status: "connected" }, select: { type: true } });
  return new Set(rows.map((r) => r.type));
}

export async function poll<T>(fn: () => Promise<T | null>, { intervalMs = 2000, timeoutMs = 180_000 } = {}): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v !== null) return v;
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for the job to finish");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
