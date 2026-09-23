// Multicast worker: runs scheduled publishes and reminders from Redis (BullMQ).
// Start with `npm run worker`. Jobs persist in Redis, so restarts lose nothing; a daily
// reconciliation re-enqueues any pending item whose job went missing.
import { UnrecoverableError, Worker, type Job } from "bullmq";
import { db } from "@/lib/db";
import { publishDraft } from "@/lib/publishers";
import { PublishError } from "@/lib/publishers/types";
import { notify } from "@/lib/notify";
import { queue, QUEUE_NAME, redisConnection, RETRY_DELAYS_MS, PUBLISH_ATTEMPTS } from "@/lib/schedule/queue";
import { reconcile } from "@/lib/schedule/service";
import { errMsg } from "@/lib/util";

type Data = { itemId?: string };

async function runPublish(job: Job<Data>) {
  const item = await db.scheduleItem.findUnique({ where: { id: job.data.itemId! }, include: { draft: true } });
  if (!item || item.status !== "pending" || item.mode !== "auto") return { skipped: "not pending" };
  if (item.jobId && item.jobId !== job.id) return { skipped: "superseded by a reschedule" };

  await db.scheduleItem.update({ where: { id: item.id }, data: { attempts: { increment: 1 } } });
  try {
    const { url } = await publishDraft(item.workspaceId, item.draftId);
    await db.scheduleItem.update({ where: { id: item.id }, data: { status: "published", externalUrl: url, lastError: null } });
    return { url };
  } catch (e) {
    const msg = errMsg(e);
    const last = job.attemptsMade + 1 >= (job.opts.attempts ?? PUBLISH_ATTEMPTS);
    const permanent = e instanceof PublishError && !e.retryable;
    await db.scheduleItem.update({ where: { id: item.id }, data: { lastError: msg } });
    if (permanent || last) {
      await db.scheduleItem.update({ where: { id: item.id }, data: { status: "failed" } });
      await db.draft.update({ where: { id: item.draftId }, data: { status: "failed", lastError: msg } });
      await notify(item.workspaceId, "failed", { draft: item.draft, item, error: msg });
      if (permanent) throw new UnrecoverableError(msg);
    }
    throw e;
  }
}

async function runRemind(job: Job<Data>) {
  const item = await db.scheduleItem.findUnique({
    where: { id: job.data.itemId! },
    include: { draft: { include: { images: true, brief: { select: { subreddit: true } } } } },
  });
  if (!item || item.status !== "pending" || item.mode !== "remind") return { skipped: "not pending" };
  if (item.remindJobId && item.remindJobId !== job.id) return { skipped: "superseded" };
  await notify(item.workspaceId, "reminder", { item, draft: item.draft });
  await db.scheduleItem.update({ where: { id: item.id }, data: { status: "sent" } });
  return { sent: true };
}

async function runWeekly() {
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
}

async function main() {
  const worker = new Worker<Data>(
    QUEUE_NAME,
    async (job) => {
      switch (job.name) {
        case "publish":
          return runPublish(job);
        case "remind":
          return runRemind(job);
        case "reconcile":
          return reconcile();
        case "weekly":
          return runWeekly();
        default:
          return { skipped: `unknown job ${job.name}` };
      }
    },
    {
      connection: redisConnection(),
      concurrency: 4,
      settings: { backoffStrategy: (attemptsMade: number) => RETRY_DELAYS_MS[Math.min(attemptsMade, RETRY_DELAYS_MS.length) - 1] ?? RETRY_DELAYS_MS.at(-1)! },
    },
  );
  worker.on("completed", (job, res) => console.log(`[worker] ${job.name} ${job.id} done`, res ?? ""));
  worker.on("failed", (job, err) => console.warn(`[worker] ${job?.name} ${job?.id} attempt ${job?.attemptsMade} failed: ${err.message}`));

  // Repeatable maintenance jobs.
  await queue().upsertJobScheduler("reconcile-daily", { pattern: "0 3 * * *" }, { name: "reconcile" });
  await queue().upsertJobScheduler("weekly-summary", { pattern: "0 9 * * 1" }, { name: "weekly" });
  const r = await reconcile().catch((e) => ({ error: errMsg(e) }));
  console.log("[worker] started · startup reconcile:", r);

  const stop = async () => {
    console.log("[worker] shutting down…");
    await worker.close();
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error("[worker] fatal", e);
  process.exit(1);
});
