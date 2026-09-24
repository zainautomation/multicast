import { randomBytes } from "node:crypto";
import { Client, Receiver } from "@upstash/qstash";
import { appUrl } from "@/lib/env";

// Serverless scheduler backend: Upstash QStash calls /api/jobs at the exact time.
// Used whenever QSTASH_TOKEN is set (e.g. on Vercel, which has no always-on worker).
// Job ids are "<token>|<messageId>": the token is also sent in the body, so a delivery for a
// job that was since rescheduled or cancelled is recognised and ignored.

export type JobKind = "publish" | "remind" | "reconcile" | "weekly";
export type JobBody = { kind: JobKind; itemId?: string; token?: string; attempt?: number };

export const qstashEnabled = () => !!process.env.QSTASH_TOKEN;
export const jobsUrl = () => `${appUrl()}/api/jobs`;

let client: Client | null = null;
function qc() {
  if (!client) client = new Client({ token: process.env.QSTASH_TOKEN!, baseUrl: process.env.QSTASH_URL || undefined });
  return client;
}

/** Deliver a job to /api/jobs at `at` (or now). Returns the job id to store on the item. */
export async function publishJob(body: Omit<JobBody, "token">, at: Date): Promise<string> {
  await ensureSchedules();
  const token = randomBytes(9).toString("base64url");
  const res = await qc().publishJSON({
    url: jobsUrl(),
    body: { ...body, token },
    notBefore: Math.max(Math.floor(at.getTime() / 1000), Math.floor(Date.now() / 1000)),
    // Transport-level retries only (endpoint down / timeout). Publish retries with the
    // 1 / 5 / 15 minute backoff are scheduled by /api/jobs itself.
    retries: 3,
  });
  const messageId = (res as { messageId: string }).messageId;
  return `${token}|${messageId}`;
}

export function tokenOf(jobId: string | null | undefined): string | null {
  return jobId ? jobId.split("|")[0] : null;
}

export async function cancelJob(jobId: string | null | undefined) {
  const messageId = jobId?.split("|")[1];
  if (!messageId) return;
  // Already delivered or expired messages can't be cancelled; the token check covers those.
  await qc().messages.delete(messageId).catch(() => undefined);
}

let schedulesReady = false;
/** Daily reconciliation and the weekly summary, as QStash cron schedules (idempotent). */
export async function ensureSchedules() {
  if (schedulesReady) return;
  const s = qc().schedules;
  await s.create({ scheduleId: "multicast-reconcile", destination: jobsUrl(), cron: "0 3 * * *", body: JSON.stringify({ kind: "reconcile" }), headers: { "Content-Type": "application/json" } });
  await s.create({ scheduleId: "multicast-weekly", destination: jobsUrl(), cron: "0 9 * * 1", body: JSON.stringify({ kind: "weekly" }), headers: { "Content-Type": "application/json" } });
  schedulesReady = true;
}

let receiver: Receiver | null = null;
/** Verify the Upstash-Signature header (JWT signed with the current or next signing key). */
export async function verifyQstash(signature: string | null, rawBody: string): Promise<boolean> {
  if (!signature || !process.env.QSTASH_CURRENT_SIGNING_KEY || !process.env.QSTASH_NEXT_SIGNING_KEY) return false;
  if (!receiver) receiver = new Receiver({ currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY, nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY });
  try {
    return await receiver.verify({ signature, body: rawBody, url: jobsUrl(), clockTolerance: 30 });
  } catch {
    return false;
  }
}
