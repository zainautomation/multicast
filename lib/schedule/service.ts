import { db } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";
import { canAuto } from "@/lib/publishers";
import { enqueuePublish, enqueueRemind, removeJob, schedulerAvailable } from "@/lib/schedule/queue";
import { reminderTime, suggestMany, type Window } from "@/lib/schedule/suggest";
import { isValidTz } from "@/lib/schedule/time";

export async function workspaceTz(workspaceId: string): Promise<string> {
  const ws = await db.workspace.findUnique({ where: { id: workspaceId } });
  return isValidTz(ws?.timezone) ? ws!.timezone! : "UTC";
}

/** Quora is always Remind me; Medium unless a token is stored; others need a linked account. */
export async function effectiveMode(workspaceId: string, platform: PlatformId, requested: "auto" | "remind") {
  if (requested === "remind") return { mode: "remind" as const, forced: false };
  if (PLATFORMS[platform].publish.kind === "copy") return { mode: "remind" as const, forced: true, reason: `${PLATFORMS[platform].name} has no posting API` };
  if (!(await canAuto(workspaceId, platform))) return { mode: "remind" as const, forced: true, reason: `${PLATFORMS[platform].name} is not connected` };
  return { mode: "auto" as const, forced: false };
}

async function enqueueFor(item: { id: string; workspaceId: string; runAtUtc: Date; mode: string }) {
  if (!schedulerAvailable()) throw new HttpError(503, "Scheduling is not set up: connect Upstash QStash (QSTASH_TOKEN), or set REDIS_URL and run the worker. Post now still works.");
  if (item.mode === "auto") return { jobId: await enqueuePublish(item.id, item.runAtUtc), remindJobId: null };
  const pref = await db.notificationPref.findUnique({ where: { workspaceId: item.workspaceId } });
  const at = reminderTime(item.runAtUtc, pref?.leadMinutes ?? 15, await workspaceTz(item.workspaceId));
  return { jobId: null, remindJobId: await enqueueRemind(item.id, at) };
}

export async function scheduleDraft(workspaceId: string, draftId: string, runAtUtc: Date, requestedMode: "auto" | "remind") {
  const d = await db.draft.findFirst({ where: { id: draftId, workspaceId }, include: { schedule: true } });
  if (!d) throw new HttpError(404, "Draft not found");
  if (!["approved", "scheduled"].includes(d.status)) throw new HttpError(400, "Approve the draft before scheduling it");
  if (runAtUtc.getTime() < Date.now() - 60_000) throw new HttpError(400, "That time is in the past");
  if (!schedulerAvailable()) throw new HttpError(503, "Scheduling is not set up: connect Upstash QStash (QSTASH_TOKEN), or set REDIS_URL and run the worker. Post now still works.");
  const { mode } = await effectiveMode(workspaceId, d.platform as PlatformId, requestedMode);

  if (d.schedule) {
    await removeJob(d.schedule.jobId);
    await removeJob(d.schedule.remindJobId);
  }
  const item = await db.scheduleItem.upsert({
    where: { draftId },
    create: { workspaceId, draftId, platform: d.platform, runAtUtc, mode, status: "pending" },
    update: { runAtUtc, mode, status: "pending", attempts: 0, lastError: null, jobId: null, remindJobId: null },
  });
  let jobs: Awaited<ReturnType<typeof enqueueFor>>;
  try {
    jobs = await enqueueFor(item);
  } catch (e) {
    // Don't leave a "scheduled" row behind that no job will ever run.
    if (d.schedule) await db.scheduleItem.update({ where: { id: item.id }, data: { runAtUtc: d.schedule.runAtUtc, mode: d.schedule.mode, status: d.schedule.status, jobId: d.schedule.jobId, remindJobId: d.schedule.remindJobId } });
    else await db.scheduleItem.delete({ where: { id: item.id } });
    throw e;
  }
  await db.scheduleItem.update({ where: { id: item.id }, data: jobs });
  await db.draft.update({ where: { id: draftId }, data: { status: "scheduled" } });
  return db.scheduleItem.findUniqueOrThrow({ where: { id: item.id } });
}

export async function unschedule(workspaceId: string, itemId: string) {
  const item = await db.scheduleItem.findFirst({ where: { id: itemId, workspaceId } });
  if (!item) throw new HttpError(404, "Not found");
  await removeJob(item.jobId);
  await removeJob(item.remindJobId);
  await db.scheduleItem.delete({ where: { id: itemId } });
  await db.draft.update({ where: { id: item.draftId }, data: { status: "approved" } });
}

export async function markPosted(workspaceId: string, itemId: string, url?: string | null) {
  const item = await db.scheduleItem.findFirst({ where: { id: itemId, workspaceId } });
  if (!item) throw new HttpError(404, "Not found");
  await removeJob(item.jobId);
  await removeJob(item.remindJobId);
  await db.scheduleItem.update({ where: { id: itemId }, data: { status: "published", externalUrl: url || null } });
  await db.draft.update({ where: { id: item.draftId }, data: { status: "published", externalUrl: url || null, publishedAt: new Date() } });
}

export async function retryItem(workspaceId: string, itemId: string) {
  const item = await db.scheduleItem.findFirst({ where: { id: itemId, workspaceId } });
  if (!item) throw new HttpError(404, "Not found");
  const runAt = new Date(Date.now() + 2000);
  const updated = await db.scheduleItem.update({ where: { id: itemId }, data: { status: "pending", attempts: 0, lastError: null, runAtUtc: item.mode === "auto" ? runAt : item.runAtUtc } });
  const jobs = await enqueueFor(updated);
  await db.scheduleItem.update({ where: { id: itemId }, data: jobs });
  await db.draft.update({ where: { id: item.draftId }, data: { status: "scheduled", lastError: null } });
}

/** Suggestions for every approved-but-unscheduled draft, respecting existing items. */
export async function suggestionsFor(workspaceId: string, draftIds: { id: string; platform: string }[]) {
  const [windows, items, tz] = await Promise.all([
    db.postingWindow.findMany({ where: { workspaceId } }),
    db.scheduleItem.findMany({ where: { workspaceId, status: { in: ["pending", "sent", "published"] }, runAtUtc: { gte: new Date(Date.now() - 6 * 3600_000) } } }),
    workspaceTz(workspaceId),
  ]);
  const takenByPlatform: Record<string, Date[]> = {};
  const ids = new Set(draftIds.map((d) => d.id));
  for (const it of items) if (!ids.has(it.draftId)) (takenByPlatform[it.platform] ??= []).push(it.runAtUtc);
  const w: Record<string, Window> = Object.fromEntries(windows.map((x) => [x.platform, { days: x.days, startMin: x.startMin, endMin: x.endMin }]));
  return suggestMany(draftIds, { windows: w, tz, now: new Date(), takenByPlatform });
}

/** Daily reconciliation: re-enqueue pending items whose job went missing. */
export async function reconcile() {
  const { jobAlive } = await import("@/lib/schedule/queue");
  const pending = await db.scheduleItem.findMany({ where: { status: "pending" } });
  let fixed = 0;
  for (const it of pending) {
    const id = it.mode === "auto" ? it.jobId : it.remindJobId;
    // A reminder fires before runAt, so "still pending after runAt" means it was lost too.
    // Retries re-enqueue (and touch updatedAt), so measure from the latest of the two.
    const due = new Date(Math.max(it.runAtUtc.getTime(), it.updatedAt.getTime()));
    if (!(await jobAlive(id, due))) {
      const jobs = await enqueueFor(it.runAtUtc.getTime() < Date.now() ? { ...it, runAtUtc: new Date(Date.now() + 5000) } : it);
      await db.scheduleItem.update({ where: { id: it.id }, data: jobs });
      fixed++;
    }
  }
  return { checked: pending.length, fixed };
}
