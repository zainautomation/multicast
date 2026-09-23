import { getIntegration, poll, updateCreds } from "@/lib/integrations/store";
import { renderSlides } from "@/lib/render/render";
import type { ImageJob, ImageSpec } from "@/lib/generation/image";
import type { GeneratorId } from "@/lib/prompts/defaults";
import { findSize } from "@/lib/platforms";

// Optional creative tools (spec §11). Each returns finished images or throws; the caller
// falls back to the built-in renderer and labels the draft. [verify] every endpoint.

export const GENERATOR_LABEL: Record<GeneratorId, string> = {
  builtin: "Built-in brand templates",
  canva: "Canva",
  figma: "Figma",
  higgsfield: "Higgsfield",
  custom: "Custom integration",
};

type ExtInput = { job: ImageJob; spec: ImageSpec; w: number; h: number; format: "png" | "jpeg" };
type ExtOutput = { images: Buffer[]; mime: string; warnings: string[] };

async function fetchBuf(url: string, headers?: Record<string, string>) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`download failed (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

/** Built-in text overlay on an external background image. */
async function overlay(input: ExtInput, bg: Buffer): Promise<ExtOutput> {
  const d = input.job.layer.imageDefaults;
  const out = await renderSlides({
    platform: input.job.platform,
    w: input.w,
    h: input.h,
    slides: input.spec.slides,
    bgHex: d.bgHex,
    fgHex: d.fgHex,
    include: d.include,
    brand: input.job.brand,
    format: input.format,
    bgImage: bg,
  });
  return { images: out.images, mime: out.mime, warnings: out.warnings };
}

// ─── Canva Connect API ────────────────────────────────────────────────────
const CANVA = "https://api.canva.com/rest/v1";

export async function canvaAccessToken(workspaceId: string): Promise<string> {
  const it = await getIntegration(workspaceId, "canva");
  if (!it?.creds.accessToken) throw new Error("Canva is not connected");
  const exp = Number(it.creds.expiresAt || 0);
  if (exp && Date.now() < exp - 60_000) return it.creds.accessToken;
  if (!it.creds.refreshToken) return it.creds.accessToken;
  const res = await fetch(`${CANVA}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${it.creds.clientId}:${it.creds.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: it.creds.refreshToken }),
  });
  if (!res.ok) throw new Error(`Canva token refresh failed (${res.status}); reconnect Canva`);
  const t = await res.json();
  await updateCreds(workspaceId, "canva", {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? it.creds.refreshToken,
    expiresAt: String(Date.now() + (t.expires_in ?? 3600) * 1000),
  });
  return t.access_token;
}

async function canvaJson(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${CANVA}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || body?.error || `Canva ${res.status}`);
  return body;
}

async function canvaExport(token: string, designId: string, w: number, h: number, format: "png" | "jpeg") {
  const job = await canvaJson(token, "/exports", {
    method: "POST",
    body: JSON.stringify({ design_id: designId, format: format === "jpeg" ? { type: "jpg", quality: 92, width: w, height: h } : { type: "png", width: w, height: h } }),
  });
  const id = job.job?.id;
  const done = await poll(async () => {
    const s = await canvaJson(token, `/exports/${id}`);
    if (s.job?.status === "failed") throw new Error(s.job?.error?.message || "Canva export failed");
    return s.job?.status === "success" ? (s.job.urls as string[]) : null;
  });
  return Promise.all(done.map((u) => fetchBuf(u)));
}

async function canva(workspaceId: string, input: ExtInput): Promise<ExtOutput> {
  const it = await getIntegration(workspaceId, "canva");
  if (!it) throw new Error("Canva is not connected");
  const token = await canvaAccessToken(workspaceId);
  const templates = (it.meta.brandTemplates ?? {}) as Record<string, string>;
  const templateId = templates[input.job.platform] || (it.meta.defaultBrandTemplateId as string | undefined);
  const warnings: string[] = [];

  if (templateId) {
    // Autofill a brand template (may require Canva Enterprise). Fields: headline, subline, signature.
    const images: Buffer[] = [];
    for (const s of input.spec.slides) {
      const data: Record<string, { type: "text"; text: string }> = { headline: { type: "text", text: s.headline } };
      if (s.subline) data.subline = { type: "text", text: s.subline };
      if (s.items?.length) data.items = { type: "text", text: s.items.map((x, i) => `${i + 1}. ${x}`).join("\n") };
      const job = await canvaJson(token, "/autofills", { method: "POST", body: JSON.stringify({ brand_template_id: templateId, data }) });
      const designId = await poll(async () => {
        const st = await canvaJson(token, `/autofills/${job.job?.id}`);
        if (st.job?.status === "failed") throw new Error(st.job?.error?.message || "Canva autofill failed");
        return st.job?.status === "success" ? (st.job.result?.design?.id as string) : null;
      });
      images.push(...(await canvaExport(token, designId, input.w, input.h, input.format)));
    }
    return { images, mime: input.format === "jpeg" ? "image/jpeg" : "image/png", warnings };
  }

  // No brand template (or no Enterprise): render built-in, import it into Canva as a design
  // so it can be edited there, then export from Canva.
  const local = await renderSlides({
    platform: input.job.platform,
    w: input.w,
    h: input.h,
    slides: input.spec.slides,
    bgHex: input.job.layer.imageDefaults.bgHex,
    fgHex: input.job.layer.imageDefaults.fgHex,
    include: input.job.layer.imageDefaults.include,
    brand: input.job.brand,
    format: "png",
  });
  const images: Buffer[] = [];
  for (const [i, png] of local.images.entries()) {
    const up = await fetch(`${CANVA}/asset-uploads`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Asset-Upload-Metadata": JSON.stringify({ name_base64: Buffer.from(`multicast-${input.job.platform}-${i + 1}`).toString("base64") }),
      },
      body: new Uint8Array(png),
    });
    const upBody = await up.json();
    if (!up.ok) throw new Error(upBody?.message || `Canva upload ${up.status}`);
    const assetId = await poll(async () => {
      const st = await canvaJson(token, `/asset-uploads/${upBody.job?.id}`);
      if (st.job?.status === "failed") throw new Error("Canva asset upload failed");
      return st.job?.status === "success" ? (st.job.asset?.id as string) : null;
    });
    const design = await canvaJson(token, "/designs", {
      method: "POST",
      body: JSON.stringify({ design_type: { type: "custom", width: input.w, height: input.h }, asset_id: assetId, title: `Multicast · ${input.job.platform}` }),
    });
    images.push(...(await canvaExport(token, design.design?.id, input.w, input.h, input.format)));
  }
  warnings.push(...local.warnings, "No Canva brand template set; imported the built-in design into Canva for editing.");
  return { images, mime: input.format === "jpeg" ? "image/jpeg" : "image/png", warnings };
}

// ─── Figma REST (read-only: export a frame as background, overlay text locally) ───
async function figma(workspaceId: string, input: ExtInput): Promise<ExtOutput> {
  const it = await getIntegration(workspaceId, "figma");
  if (!it) throw new Error("Figma is not connected");
  const token = it.creds.token;
  const fileKey = it.creds.fileKey;
  if (!fileKey) throw new Error("Add a template file key in Integrations → Figma");
  const H = { "X-Figma-Token": token };
  const file = await fetch(`https://api.figma.com/v1/files/${fileKey}?depth=2`, { headers: H }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Figma ${r.status}`))));
  type Node = { id: string; name: string; type: string; absoluteBoundingBox?: { width: number; height: number } };
  const frames: Node[] = (file.document?.children ?? []).flatMap((page: { children?: Node[] }) => (page.children ?? []).filter((n) => n.type === "FRAME" || n.type === "COMPONENT"));
  if (!frames.length) throw new Error("No frames found in the Figma file");
  const size = findSize(input.job.platform, `${input.w}x${input.h}`);
  const byName = frames.find((f) => f.name.toLowerCase().includes(input.job.platform) || f.name.toLowerCase().includes(size.label.toLowerCase()));
  const target = input.w / input.h;
  const byRatio = [...frames].sort((a, b) => {
    const ra = (a.absoluteBoundingBox?.width ?? 1) / (a.absoluteBoundingBox?.height ?? 1);
    const rb = (b.absoluteBoundingBox?.width ?? 1) / (b.absoluteBoundingBox?.height ?? 1);
    return Math.abs(ra - target) - Math.abs(rb - target);
  })[0];
  const frame = byName ?? byRatio;
  const scale = Math.min(4, Math.max(1, input.w / (frame.absoluteBoundingBox?.width ?? input.w)));
  const img = await fetch(`https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(frame.id)}&format=png&scale=${scale.toFixed(2)}`, { headers: H }).then((r) => r.json());
  const url = img.images?.[frame.id];
  if (!url) throw new Error(img.err || "Figma did not return an export URL");
  const out = await overlay(input, await fetchBuf(url));
  out.warnings.push(`Background from Figma frame "${frame.name}"; text set by the built-in renderer.`);
  return out;
}

// ─── Higgsfield (stylised background image from the visual brief) ─────────
async function higgsfield(workspaceId: string, input: ExtInput): Promise<ExtOutput> {
  const it = await getIntegration(workspaceId, "higgsfield");
  if (!it) throw new Error("Higgsfield is not connected");
  const base = (it.meta.baseUrl as string) || "https://platform.higgsfield.ai";
  const H = { "hf-api-key": it.creds.apiKey, "hf-secret": it.creds.apiSecret, "Content-Type": "application/json" };
  const d = input.job.layer.imageDefaults;
  const prompt = [
    `${d.style} background for a social post about: ${input.spec.slides[0]?.headline ?? input.job.briefText.slice(0, 200)}.`,
    `Dominant colour ${d.bgHex}. Leave generous empty space for overlaid text. No text, no logos, no people's faces.`,
  ].join(" ");
  // [verify] Higgsfield endpoint/model names change; configurable via integration meta.
  const submit = await fetch(`${base}/v1/text2image/${(it.meta.model as string) || "soul"}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ params: { prompt, width_and_height: `${Math.min(input.w, 2048)}x${Math.min(input.h, 2048)}`, quality: "1080p", batch_size: 1 } }),
  });
  const job = await submit.json().catch(() => ({}));
  if (!submit.ok) throw new Error(job?.detail || job?.message || `Higgsfield ${submit.status}`);
  const setId = job.id ?? job.job_set_id;
  const url = await poll(async () => {
    const st = await fetch(`${base}/v1/job-sets/${setId}`, { headers: H }).then((r) => r.json());
    const j = st.jobs?.[0];
    if (j?.status === "failed" || j?.status === "nsfw") throw new Error("Higgsfield generation failed");
    return j?.status === "completed" ? ((j.results?.raw?.url ?? j.results?.min?.url) as string) : null;
  }, { intervalMs: 3000, timeoutMs: 300_000 });
  const out = await overlay(input, await fetchBuf(url));
  out.warnings.push("Background generated by Higgsfield; text set by the built-in renderer.");
  return out;
}

// ─── Custom webhook: POST the image spec, expect image URL(s) back ────────
async function custom(workspaceId: string, input: ExtInput): Promise<ExtOutput> {
  const it = await getIntegration(workspaceId, "custom");
  if (!it) throw new Error("Custom integration is not connected");
  const res = await fetch(it.creds.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(it.creds.apiKey ? { Authorization: `Bearer ${it.creds.apiKey}` } : {}) },
    body: JSON.stringify({
      platform: input.job.platform,
      width: input.w,
      height: input.h,
      format: input.format,
      spec: input.spec,
      colors: { background: input.job.layer.imageDefaults.bgHex, text: input.job.layer.imageDefaults.fgHex },
      include: input.job.layer.imageDefaults.include,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `webhook ${res.status}`);
  const urls: string[] = body.urls ?? (body.url ? [body.url] : []);
  if (!urls.length) throw new Error("webhook returned no image URL");
  const images = await Promise.all(urls.map((u) => fetchBuf(u)));
  return { images, mime: input.format === "jpeg" ? "image/jpeg" : "image/png", warnings: [] };
}

export async function renderExternal(generator: GeneratorId, workspaceId: string, input: ExtInput): Promise<ExtOutput> {
  switch (generator) {
    case "canva":
      return canva(workspaceId, input);
    case "figma":
      return figma(workspaceId, input);
    case "higgsfield":
      return higgsfield(workspaceId, input);
    case "custom":
      return custom(workspaceId, input);
    default:
      throw new Error(`Unknown generator ${generator}`);
  }
}
