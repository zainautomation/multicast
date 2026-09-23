import { db } from "@/lib/db";
import { getCtx } from "@/lib/auth";
import { canAuto } from "@/lib/publishers";
import { PLATFORM_LIST, PLATFORMS, type PlatformId } from "@/lib/platforms";
import { suggestionsFor } from "@/lib/schedule/service";
import { schedulerAvailable } from "@/lib/schedule/queue";
import { pushConfigured } from "@/lib/notify/push";
import { emailConfigured } from "@/lib/notify/email";
import { getIntegration } from "@/lib/integrations/store";
import { ScheduleClient, type Row, type CalItem } from "@/components/schedule/ScheduleClient";

export const dynamic = "force-dynamic";

function what(d: { hasPost: boolean; images: { urls: string[]; mimeType: string }[]; platform: string }, subreddit?: string | null) {
  const img = d.images[0];
  const media = !img ? "" : img.mimeType.startsWith("video/") ? "video" : img.urls.length > 1 ? "carousel" : "image";
  if (!d.hasPost) return media ? media[0].toUpperCase() + media.slice(1) : "Image";
  if (d.platform === "reddit" && subreddit) return `Post · ${subreddit}`;
  return media ? `Post + ${media}` : "Post";
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = (await getCtx())!;
  const ws = ctx.workspaceId;
  const sp = await searchParams;
  const [workspace, drafts, items, windows, pref, slack] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: ws } }),
    db.draft.findMany({
      where: { workspaceId: ws, OR: [{ status: "approved" }, { status: "scheduled" }, { status: "failed", schedule: { isNot: null } }] },
      include: { images: true, schedule: true, brief: { select: { subreddit: true } } },
      orderBy: { updatedAt: "desc" },
      take: 60,
    }),
    db.scheduleItem.findMany({
      where: { workspaceId: ws, runAtUtc: { gte: new Date(Date.now() - 45 * 86400_000), lte: new Date(Date.now() + 180 * 86400_000) } },
      include: { draft: { select: { title: true, body: true, platform: true, hasPost: true, briefId: true, externalUrl: true } } },
      orderBy: { runAtUtc: "asc" },
    }),
    db.postingWindow.findMany({ where: { workspaceId: ws } }),
    db.notificationPref.findUniqueOrThrow({ where: { workspaceId: ws } }),
    getIntegration(ws, "slack"),
  ]);

  const auto: Record<string, boolean> = {};
  for (const p of PLATFORM_LIST) auto[p.id] = await canAuto(ws, p.id);
  const unscheduled = drafts.filter((d) => d.status === "approved").map((d) => ({ id: d.id, platform: d.platform }));
  const sugg = await suggestionsFor(ws, unscheduled);

  const snippet = (d: { title: string | null; body: string | null }) => (d.title || d.body || "").split("\n").find((l) => l.trim()) ?? "";
  const rows: Row[] = drafts.map((d) => {
    const p = PLATFORMS[d.platform as PlatformId];
    return {
      draftId: d.id,
      briefId: d.briefId,
      platform: d.platform,
      name: p.name,
      short: p.short,
      mono: p.mono,
      color: p.color,
      what: what(d, d.brief.subreddit),
      snippet: snippet(d),
      canAuto: auto[d.platform],
      forcedReason: p.publish.kind === "copy" ? "Quora has no posting API, so it's always a reminder" : !auto[d.platform] ? `${p.name} isn't connected; connect it to auto-publish` : null,
      suggestion: sugg[d.id]?.toISOString() ?? null,
      item: d.schedule ? { id: d.schedule.id, runAtUtc: d.schedule.runAtUtc.toISOString(), mode: d.schedule.mode, status: d.schedule.status, lastError: d.schedule.lastError } : null,
    };
  });

  const cal: CalItem[] = items.map((i) => {
    const p = PLATFORMS[i.platform as PlatformId];
    return {
      id: i.id,
      draftId: i.draftId,
      briefId: i.draft.briefId,
      platform: i.platform,
      short: p.short,
      color: p.color,
      runAtUtc: i.runAtUtc.toISOString(),
      mode: i.mode,
      status: i.status,
      externalUrl: i.externalUrl ?? i.draft.externalUrl,
      lastError: i.lastError,
      snippet: snippet(i.draft),
    };
  });

  return (
    <ScheduleClient
      tz={workspace.timezone}
      rows={rows}
      items={cal}
      windows={PLATFORM_LIST.map((p) => {
        const w = windows.find((x) => x.platform === p.id);
        return { platform: p.id, name: p.name, mono: p.mono, color: p.color, days: w?.days ?? [], startMin: w?.startMin ?? 540, endMin: w?.endMin ?? 660 };
      })}
      pref={{ leadMinutes: pref.leadMinutes, slack: pref.slack, email: pref.email, browser: pref.browser }}
      channels={{ slack: !!slack, email: emailConfigured(), push: pushConfigured(), vapidKey: process.env.VAPID_PUBLIC_KEY ?? null }}
      scheduler={schedulerAvailable()}
      intent={{ posted: sp.posted ?? null, retry: sp.retry ?? null, open: sp.open ?? null }}
    />
  );
}
