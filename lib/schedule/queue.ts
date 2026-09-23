import { Queue, type ConnectionOptions } from "bullmq";

// BullMQ on Redis. Jobs persist in Redis so the worker survives restarts.
export const QUEUE_NAME = "multicast";

export type JobName = "publish" | "remind" | "reconcile" | "weekly";

/** Backoff after failed publish attempts: 1 min, 5 min, 15 min (spec §15). */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000];
export const PUBLISH_ATTEMPTS = 1 + RETRY_DELAYS_MS.length;

export function redisConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set: the scheduler needs Redis");
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

const g = globalThis as unknown as { mcQueue?: Queue };

export function queue(): Queue {
  if (!g.mcQueue) g.mcQueue = new Queue(QUEUE_NAME, { connection: redisConnection() });
  return g.mcQueue;
}

export function schedulerAvailable() {
  return !!process.env.REDIS_URL;
}

export async function enqueuePublish(itemId: string, runAt: Date): Promise<string> {
  const jobId = `publish-${itemId}-${runAt.getTime()}`;
  await queue().add(
    "publish",
    { itemId },
    { jobId, delay: Math.max(0, runAt.getTime() - Date.now()), attempts: PUBLISH_ATTEMPTS, backoff: { type: "custom" }, removeOnComplete: 500, removeOnFail: 1000 },
  );
  return jobId;
}

export async function enqueueRemind(itemId: string, at: Date): Promise<string> {
  const jobId = `remind-${itemId}-${at.getTime()}`;
  await queue().add("remind", { itemId }, { jobId, delay: Math.max(0, at.getTime() - Date.now()), attempts: 3, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: 500, removeOnFail: 1000 });
  return jobId;
}

export async function removeJob(jobId: string | null | undefined) {
  if (!jobId) return;
  const job = await queue().getJob(jobId);
  if (job) await job.remove().catch(() => undefined);
}
