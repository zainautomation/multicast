import { isIP } from "node:net";
import { HttpError } from "@/lib/errors";
import { LIMITS } from "@/lib/uploads";

// Media for MCP tools arrives as a URL. Only public https hosts, a size cap enforced while
// streaming, and the file type is still checked by content in storeUpload.

function isPrivateHost(host: string) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (isIP(h) === 4) {
    const [a, b] = h.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (isIP(h) === 6) return h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:");
  return false;
}

export async function fetchMedia(url: string): Promise<File> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new HttpError(400, `Not a URL: ${url}`);
  }
  if (u.protocol !== "https:" || isPrivateHost(u.hostname)) throw new HttpError(400, "Media URLs must be public https links");
  const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
  if (!res.ok || !res.body) throw new HttpError(400, `Could not download ${url} (${res.status})`);
  if (res.url && isPrivateHost(new URL(res.url).hostname)) throw new HttpError(400, "Media URLs must be public https links");
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  const max = type.startsWith("video/") ? LIMITS.video : LIMITS.image;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new HttpError(413, `File is too large (max ${Math.round(max / 1024 / 1024)} MB)`);
    }
    chunks.push(value);
  }
  const name = decodeURIComponent(u.pathname.split("/").pop() || "media");
  return new File(chunks as BlobPart[], name, { type: type || "application/octet-stream" });
}
