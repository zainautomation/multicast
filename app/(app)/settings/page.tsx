import { db } from "@/lib/db";
import { requireCtx } from "@/lib/auth";
import { monthSpendMicroUsd } from "@/lib/usage";
import { CHECKER_MODEL_OPTIONS, DRAFT_MODEL_OPTIONS, modelInfo } from "@/lib/models";
import { SettingsClient, type AccountRow } from "@/components/settings/SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const [s, accounts, spend, runs] = await Promise.all([
    db.settings.findUniqueOrThrow({ where: { workspaceId: ctx.workspaceId } }),
    db.publishingAccount.findMany({ where: { workspaceId: ctx.workspaceId } }),
    monthSpendMicroUsd(ctx.workspaceId),
    db.usageRecord.count({ where: { workspaceId: ctx.workspaceId, createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } }),
  ]);
  const by = Object.fromEntries(accounts.map((a) => [a.platform, a]));
  const env = (k: string) => !!process.env[k];
  const st = (a?: (typeof accounts)[number]) => (!a ? null : a.status === "connected" ? "connected" : "reconnect");

  const rows: AccountRow[] = [
    {
      id: "meta",
      name: "Meta",
      mono: "Fb",
      color: "#2F4B8A",
      detail: by.fb ? `Facebook Page: ${by.fb.displayName}${by.ig ? ` · Instagram: ${by.ig.displayName}` : " · no Instagram professional account linked"}` : "Facebook Page and Instagram professional account",
      status: st(by.fb) ?? (env("META_APP_ID") ? "none" : "setup"),
      kind: "oauth",
      setupHint: "Set META_APP_ID and META_APP_SECRET in .env",
      pages: ((by.fb?.meta as { pages?: { id: string; name: string; ig: string | null }[] } | null)?.pages ?? []).map((p) => ({ ...p, current: p.id === (by.fb?.meta as { pageId?: string })?.pageId })),
    },
    {
      id: "linkedin",
      name: "LinkedIn",
      mono: "in",
      color: "#1D5C8C",
      detail: by.lip
        ? `Profile: ${by.lip.displayName}${by.lic ? ` · Company page: ${by.lic.displayName}` : process.env.LINKEDIN_COMPANY_ENABLED === "true" ? " · no company page (you must be a page admin)" : " · company pages need Community Management API approval"}`
        : "Personal profile, plus company page once your app is approved",
      status: st(by.lip) ?? (env("LINKEDIN_CLIENT_ID") ? "none" : "setup"),
      kind: "oauth",
      setupHint: "Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in .env",
      expires: by.lip?.expiresAt?.toISOString() ?? null,
    },
    {
      id: "reddit",
      name: "Reddit",
      mono: "r/",
      color: "#A5421A",
      detail: by.reddit ? `${by.reddit.displayName} · OAuth app` : "Text and image posts to the subreddit on each brief",
      status: st(by.reddit) ?? (env("REDDIT_CLIENT_ID") ? "none" : "setup"),
      kind: "oauth",
      setupHint: "Set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET and REDDIT_USER_AGENT in .env",
    },
    {
      id: "medium",
      name: "Medium",
      mono: "M",
      color: "#2B2924",
      detail: by.medium ? `${by.medium.displayName} · posts go in as drafts` : "Existing integration token only; new tokens are no longer issued",
      status: st(by.medium) ?? "none",
      kind: "token",
    },
    { id: "quora", name: "Quora", mono: "Q", color: "#8A2B2B", detail: "No public posting API · drafts are copy-ready", status: "copy", kind: "copy" },
  ];

  return (
    <SettingsClient
      flash={{ connected: sp.connected ?? null, error: sp.error ?? null }}
      claude={{
        hasKey: !!s.claudeKeyEnc,
        last4: s.claudeKeyLast4,
        verifiedAt: s.claudeVerifiedAt?.toISOString() ?? null,
        draftModel: s.draftModel,
        checkerModel: s.checkerModel,
        creativity: s.creativity,
        monthlyCapCents: s.monthlyCapCents,
        spendMicro: spend,
        runs,
      }}
      draftModels={DRAFT_MODEL_OPTIONS.map((id) => ({ id, label: modelInfo(id).label }))}
      checkerModels={CHECKER_MODEL_OPTIONS.map((id) => ({ id, label: modelInfo(id).label }))}
      accounts={rows}
    />
  );
}
