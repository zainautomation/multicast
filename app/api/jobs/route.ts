import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { publishJob, tokenOf, verifyQstash, type JobBody } from "@/lib/schedule/qstash";
import { attemptPublish, runWeekly, sendReminder } from "@/lib/schedule/jobs";
import { PUBLISH_ATTEMPTS, RETRY_DELAYS_MS } from "@/lib/schedule/queue";
import { reconcile } from "@/lib/schedule/service";
import { errMsg } from "@/lib/util";

// QStash delivery endpoint for scheduled jobs. Public URL, so every request must carry a
// valid Upstash signature. Publish retries (1 / 5 / 15 min) are re-scheduled from here and
// the request answers 200, so QStash's own retries only cover transport failures.

const ok = (data: unknown) => Response.json(data);

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!(await verifyQstash(req.headers.get("upstash-signature"), raw))) return new Response("invalid signature", { status: 401 });
  let job: JobBody;
  try {
    job = JSON.parse(raw) as JobBody;
  } catch {
    return new Response("bad body", { status: 400 });
  }

  switch (job.kind) {
    case "publish": {
      const item = job.itemId ? await db.scheduleItem.findUnique({ where: { id: job.itemId } }) : null;
      if (!item) return ok({ skipped: "no such item" });
      // Rescheduled or cancelled since this message was sent: ignore it.
      if (tokenOf(item.jobId) !== job.token) return ok({ skipped: "superseded" });
      const attempt = job.attempt ?? 1;
      const out = await attemptPublish(item.id, attempt, PUBLISH_ATTEMPTS);
      if (out.status === "retry") {
        const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length) - 1];
        const next = await publishJob({ kind: "publish", itemId: item.id, attempt: attempt + 1 }, new Date(Date.now() + delay));
        await db.scheduleItem.update({ where: { id: item.id }, data: { jobId: next } });
        return ok({ retry: attempt + 1, inMs: delay, error: out.error });
      }
      return ok(out);
    }
    case "remind": {
      const item = job.itemId ? await db.scheduleItem.findUnique({ where: { id: job.itemId } }) : null;
      if (!item) return ok({ skipped: "no such item" });
      if (tokenOf(item.remindJobId) !== job.token) return ok({ skipped: "superseded" });
      return ok(await sendReminder(item.id));
    }
    case "reconcile":
      return ok(await reconcile().catch((e) => ({ error: errMsg(e) })));
    case "weekly":
      return ok(await runWeekly());
    default:
      return ok({ skipped: "unknown job" });
  }
}

export const maxDuration = 300;
