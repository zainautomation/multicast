import type { Creds } from "@/lib/integrations/store";
import { HttpError } from "@/lib/errors";

// "Test connection" for each optional tool. Throws with a readable message on failure.
// [verify] endpoints against each provider's current docs.

async function ok(res: Response, what: string) {
  if (res.ok) return res;
  const body = (await res.text().catch(() => "")).trim();
  const detail = body && !body.startsWith("<") ? `: ${body.slice(0, 160)}` : "";
  throw new HttpError(400, `${what} rejected the credentials (${res.status})${detail}`);
}

export async function verifyIntegration(type: string, creds: Creds, meta: Record<string, unknown> = {}): Promise<string | null> {
  switch (type) {
    case "canva": {
      if (!creds.accessToken) return null; // OAuth not finished yet
      const res = await fetch("https://api.canva.com/rest/v1/users/me", { headers: { Authorization: `Bearer ${creds.accessToken}` } });
      await ok(res, "Canva");
      return null;
    }
    case "figma": {
      const me = await ok(await fetch("https://api.figma.com/v1/me", { headers: { "X-Figma-Token": creds.token } }), "Figma");
      const u = await me.json();
      if (creds.fileKey) await ok(await fetch(`https://api.figma.com/v1/files/${encodeURIComponent(creds.fileKey)}?depth=1`, { headers: { "X-Figma-Token": creds.token } }), "Figma (template file)");
      return u.handle ?? u.email ?? null;
    }
    case "higgsfield": {
      const base = (meta.baseUrl as string) || "https://platform.higgsfield.ai";
      // A lookup for a non-existent job: 404 means the key was accepted, 401/403 means it wasn't.
      const res = await fetch(`${base}/v1/job-sets/00000000-0000-0000-0000-000000000000`, { headers: { "hf-api-key": creds.apiKey, "hf-secret": creds.apiSecret } });
      if (res.status === 401 || res.status === 403) throw new HttpError(400, "Higgsfield rejected the key and secret");
      return null;
    }
    case "heygen": {
      await ok(await fetch("https://api.heygen.com/v2/user/remaining_quota", { headers: { "X-Api-Key": creds.apiKey, Accept: "application/json" } }), "HeyGen");
      return null;
    }
    case "custom": {
      const res = await fetch(creds.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(creds.apiKey ? { Authorization: `Bearer ${creds.apiKey}` } : {}) },
        body: JSON.stringify({ test: true, source: "multicast" }),
      });
      await ok(res, "The webhook");
      return null;
    }
    case "slack": {
      if (meta.method === "hook") {
        if (!/^https:\/\/hooks\.slack\.com\//.test(creds.webhookUrl ?? "")) throw new HttpError(400, "That doesn't look like a Slack incoming webhook URL");
        return null;
      }
      const res = await fetch("https://slack.com/api/auth.test", { method: "POST", headers: { Authorization: `Bearer ${creds.botToken}` } });
      const j = await res.json();
      if (!j.ok) throw new HttpError(400, `Slack rejected the bot token: ${j.error}`);
      if (!creds.signingSecret) throw new HttpError(400, "Add the signing secret so Slack buttons can be verified");
      return j.team ?? null;
    }
  }
  throw new HttpError(400, "Unknown integration");
}
