// Multicast worker for self-hosted setups: runs scheduled publishes and reminders from
// Redis (BullMQ). Start with `npm run worker`. Not needed when QSTASH_TOKEN is set: then
// Upstash QStash calls /api/jobs instead (the Vercel setup).
// Jobs persist in Redis, so restarts lose nothing; a daily reconciliation re-enqueues any
// pending item whose job went missing.
import { UnrecoverableError, Worker, type Job } from "bullmq";
import { db } from "@/lib/db";
import { queue, QUEUE_NAME, redisConnection, RETRY_DELAYS_MS, PUBLISH_ATTEMPTS } from "@/lib/schedule/queue";
import { attemptPublish, runWeekly, sendReminder } from "@/lib/schedule/jobs";
import { reconcile } from "@/lib/schedule/service";
import { errMsg } from "@/lib/util";

type Data = { itemId?: string };

async function runPublish(job: Job<Data>) {
  const item = await db.scheduleItem.findUnique({ where: { id: job.data.itemId! } });
  if (!item) return { skipped: "no such item" };
  if (item.jobId && item.jobId !== job.id) return { skipped: "superseded by a reschedule" };
  const out = await attemptPublish(item.id, job.attemptsMade + 1, job.opts.attempts ?? PUBLISH_ATTEMPTS);
  // Throwing hands the retry (1 / 5 / 15 min backoff) to BullMQ.
  if (out.status === "retry") throw new Error(out.error);
  if (out.status === "failed") throw new UnrecoverableError(out.error);
  return out;
}

async function runRemind(job: Job<Data>) {
  const item = await db.scheduleItem.findUnique({ where: { id: job.data.itemId! } });
  if (!item) return { skipped: "no such item" };
  if (item.remindJobId && item.remindJobId !== job.id) return { skipped: "superseded" };
  return sendReminder(item.id);
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
