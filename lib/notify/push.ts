import webpush from "web-push";
import { db } from "@/lib/db";

export function pushConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let configured = false;
function setup() {
  if (configured || !pushConfigured()) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:owner@example.com", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  configured = true;
}

export async function sendPush(workspaceId: string, payload: { title: string; body: string; url?: string }) {
  if (!pushConfigured()) return;
  setup();
  const subs = await db.pushSubscription.findMany({ where: { workspaceId } });
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys as { p256dh: string; auth: string } }, JSON.stringify(payload));
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
      }
    }),
  );
}
