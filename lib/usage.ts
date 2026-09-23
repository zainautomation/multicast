import { db } from "@/lib/db";
import { costMicroUsd } from "@/lib/models";
import { HttpError } from "@/lib/errors";

export function monthStartUtc(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function monthSpendMicroUsd(workspaceId: string): Promise<number> {
  const agg = await db.usageRecord.aggregate({
    where: { workspaceId, createdAt: { gte: monthStartUtc() } },
    _sum: { costMicroUsd: true },
  });
  return agg._sum.costMicroUsd ?? 0;
}

/** Server-side spend cap. Refuse new runs once the monthly cap is reached. */
export async function assertUnderCap(workspaceId: string) {
  const s = await db.settings.findUnique({ where: { workspaceId } });
  if (!s?.monthlyCapCents) return;
  const spent = await monthSpendMicroUsd(workspaceId);
  const capMicro = s.monthlyCapCents * 10_000;
  if (spent >= capMicro) {
    throw new HttpError(
      402,
      `Monthly spend cap reached ($${(spent / 1e6).toFixed(2)} of $${(s.monthlyCapCents / 100).toFixed(2)}). Raise the cap in Claude API & accounts to keep generating.`,
    );
  }
}

export async function recordUsage(r: {
  workspaceId: string;
  kind: string;
  platform?: string | null;
  model: string;
  promptVersionId?: string | null;
  tokensIn: number;
  tokensOut: number;
}) {
  await db.usageRecord.create({
    data: { ...r, platform: r.platform ?? null, promptVersionId: r.promptVersionId ?? null, costMicroUsd: costMicroUsd(r.model, r.tokensIn, r.tokensOut) },
  });
}
