import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { callTool, clientFor } from "@/lib/claude";
import { recordUsage, assertUnderCap } from "@/lib/usage";
import { getIntegration, poll } from "@/lib/integrations/store";
import { newKey, putObject } from "@/lib/storage";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";
import { errMsg } from "@/lib/util";

// HeyGen avatar video (spec §11): Claude writes a short script from the post, HeyGen renders
// it, we poll until ready and attach the MP4 to the draft. [verify] endpoints and limits.
const API = "https://api.heygen.com";

const SCRIPT_TOOL = {
  name: "return_video_script",
  description: "Return a short spoken script for a talking-avatar video.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    required: ["script"],
    properties: { script: { type: "string", description: "Plain spoken words only, 60–120 words, no stage directions, no emoji, no hashtags." } },
  },
};

async function hg(path: string, key: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "X-Api-Key": key, "Content-Type": "application/json", Accept: "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error?.message || body.message || `HeyGen ${res.status}`);
  return body;
}

/** Start the video in the background; returns the placeholder ImageAsset id. */
export async function startAvatarVideo(workspaceId: string, draftId: string): Promise<string> {
  const it = await getIntegration(workspaceId, "heygen");
  if (!it) throw new Error("Connect HeyGen in Integrations first");
  await assertUnderCap(workspaceId);
  const d = await db.draft.findFirstOrThrow({ where: { id: draftId, workspaceId } });
  const vertical = ["ig", "fb"].includes(d.platform);
  const dim = vertical ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
  const asset = await db.imageAsset.create({
    data: { draftId, platform: d.platform, sizeKey: `${dim.width}x${dim.height}`, width: dim.width, height: dim.height, generator: "heygen", spec: {}, urls: [], mimeType: "video/mp4", note: "Avatar video · rendering with HeyGen", status: "generating" },
  });

  void (async () => {
    try {
      const client: Anthropic = await clientFor(workspaceId);
      const settings = await db.settings.findUniqueOrThrow({ where: { workspaceId } });
      const r = await callTool<{ script: string }>({
        client,
        model: settings.draftModel,
        system: `You turn a ${PLATFORMS[d.platform as PlatformId].name} post into a spoken script for a short talking-avatar video. Keep every fact from the post; add nothing new. Speak to the viewer directly. End with the call to action from the post.`,
        user: `POST:\n${d.title ? d.title + "\n\n" : ""}${d.body ?? ""}\n\nReturn the script with the return_video_script tool.`,
        tool: SCRIPT_TOOL as Anthropic.Tool,
      });
      await recordUsage({ workspaceId, kind: "video_script", platform: d.platform, model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut });

      const key = it.creds.apiKey;
      let avatarId = it.creds.avatarId;
      if (!avatarId) avatarId = (await hg("/v2/avatars", key)).data?.avatars?.[0]?.avatar_id;
      let voiceId = it.creds.voiceId;
      if (!voiceId) {
        const voices = (await hg("/v2/voices", key)).data?.voices ?? [];
        voiceId = (voices.find((v: { language?: string }) => /english/i.test(v.language ?? "")) ?? voices[0])?.voice_id;
      }
      if (!avatarId || !voiceId) throw new Error("No HeyGen avatar or voice available on this account");
      const gen = await hg("/v2/video/generate", key, {
        method: "POST",
        body: JSON.stringify({
          video_inputs: [{ character: { type: "avatar", avatar_id: avatarId, avatar_style: "normal" }, voice: { type: "text", input_text: r.input.script, voice_id: voiceId } }],
          dimension: dim,
        }),
      });
      const videoId = gen.data?.video_id;
      const url = await poll(
        async () => {
          const s = await hg(`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, key);
          if (s.data?.status === "failed") throw new Error(s.data?.error?.message || "HeyGen render failed");
          return s.data?.status === "completed" ? (s.data.video_url as string) : null;
        },
        { intervalMs: 10_000, timeoutMs: 20 * 60_000 },
      );
      const mp4 = Buffer.from(await (await fetch(url)).arrayBuffer());
      const stored = await putObject(newKey(`video/${d.platform}`, "mp4"), mp4, "video/mp4");
      await db.imageAsset.update({ where: { id: asset.id }, data: { urls: [stored], status: "ready", note: "Avatar video · HeyGen", spec: { script: r.input.script } } });
    } catch (e) {
      await db.imageAsset.update({ where: { id: asset.id }, data: { status: "failed", note: `Video failed: ${errMsg(e)}` } }).catch(() => undefined);
    }
  })();
  return asset.id;
}
