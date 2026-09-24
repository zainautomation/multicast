// Job bodies shared by both scheduler backends: the BullMQ worker (self-hosted) and the
// QStash endpoint /api/jobs (serverless). Each backend only decides *when* to run them.
import { db } from "@/lib/db";
import { publishDraft } from "@/lib/publishers";
import { PublishError } from "@/lib/publishers/types";
import { notify } from "@/lib/notify";
import { errMsg } from "@/lib/util";

export type PublishOutcome = { status: "skipped"; reason: string } | { status: "published"; url: string } | { status: "retry"; error: string } | { status: "failed"; error: string };

/**
 * One publish attempt (1-based). Marks the item published, or failed on a permanent error /
 * the last attempt (and alerts). "retry" means the caller schedules the next attempt.
 */
export async function attemptPublish(itemId: string, attempt: number, maxAttempts: number): Promise<PublishOutcome> {
  const item = await db.scheduleItem.findUnique({ where: { id: itemId }, include: { draft: true } });
  if (!item || item.status !== "pending" || item.mode !== "auto") return { status: "skipped", reason: "not pending" };
  await db.scheduleItem.update({ where: { id: item.id }, data: { attempts: { increment: 1 } } });
  try {
    const { url } = await publishDraft(item.workspaceId, item.draftId);
    await db.scheduleItem.update({ where: { id: item.id }, data: { status: "published", externalUrl: url, lastError: null } });
    return { status: "published", url };
  } catch (e) {
    const error = errMsg(e);
    const permanent = e instanceof PublishError && !e.retryable;
    await db.scheduleItem.update({ where: { id: item.id }, data: { lastError: error } });
    if (permanent || attempt >= maxAttempts) {
      await db.scheduleItem.update({ where: { id: item.id }, data: { status: "failed" } });
      await db.draft.update({ where: { id: item.draftId }, data: { status: "failed", lastError: error } });
      await notify(item.workspaceId, "failed", { draft: item.draft, item, error });
      return { status: "failed", error };
    }
    return { status: "retry", error };
  }
}

/** Send the reminder for a "Remind me" item. */
export async function sendReminder(itemId: string): Promise<{ sent: boolean; reason?: string }> {
  const item = await db.scheduleItem.findUnique({
    where: { id: itemId },
    include: { draft: { include: { images: true, brief: { select: { subreddit: true } } } } },
  });
  if (!item || item.status !== "pending" || item.mode !== "remind") return { sent: false, reason: "not pending" };
  await notify(item.workspaceId, "reminder", { item, draft: item.draft });
  await db.scheduleItem.update({ where: { id: item.id }, data: { status: "sent" } });
  return { sent: true };
}

export async function runWeekly() {
  const from = new Date(Date.now() - 7 * 86400_000);
  const to = new Date(Date.now() + 7 * 86400_000);
  const prefs = await db.notificationPref.findMany({ where: { events: { has: "weekly" } } });
  for (const p of prefs) {
    const [published, upcoming] = await Promise.all([
      db.draft.findMany({ where: { workspaceId: p.workspaceId, status: "published", publishedAt: { gte: from } } }),
      db.scheduleItem.findMany({ where: { workspaceId: p.workspaceId, status: "pending", runAtUtc: { gte: new Date(), lte: to } }, include: { draft: true }, orderBy: { runAtUtc: "asc" } }),
    ]);
    await notify(p.workspaceId, "weekly", { from, to, published, upcoming });
  }
  return { workspaces: prefs.length };
}
