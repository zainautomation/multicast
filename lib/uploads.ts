import sharp from "sharp";
import DOMPurify from "isomorphic-dompurify";
import { HttpError } from "@/lib/errors";
import { newKey, putObject } from "@/lib/storage";

// Upload validation (spec §16): check MIME by content, cap sizes, sanitise SVG.

const MB = 1024 * 1024;

export const LIMITS = { logo: 5 * MB, image: 20 * MB, video: 200 * MB, font: 5 * MB };

function sniff(buf: Buffer): string | null {
  const h = buf.subarray(0, 16);
  if (h[0] === 0x89 && h.toString("latin1", 1, 4) === "PNG") return "image/png";
  if (h[0] === 0xff && h[1] === 0xd8) return "image/jpeg";
  if (h.toString("latin1", 0, 4) === "RIFF" && h.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (h.toString("latin1", 0, 3) === "GIF") return "image/gif";
  if (h.toString("latin1", 4, 8) === "ftyp") return h.toString("latin1", 8, 10) === "qt" ? "video/quicktime" : "video/mp4";
  if (h.toString("latin1", 0, 4) === "wOF2") return "font/woff2";
  if (h.toString("latin1", 0, 4) === "wOFF") return "font/woff";
  if (h.toString("latin1", 0, 4) === "OTTO") return "font/otf";
  if (h.readUInt32BE(0) === 0x00010000 || h.toString("latin1", 0, 4) === "true") return "font/ttf";
  const head = buf.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return null;
}

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "font/woff2": "woff2",
  "font/woff": "woff",
  "font/otf": "otf",
  "font/ttf": "ttf",
};

export type Stored = { url: string; mimeType: string; width: number | null; height: number | null; bytes: number };

export async function storeUpload(file: File, kind: keyof typeof LIMITS, opts: { allow: string[]; prefix: string; toJpeg?: boolean }): Promise<Stored> {
  if (file.size > LIMITS[kind]) throw new HttpError(413, `File is too large (max ${Math.round(LIMITS[kind] / MB)} MB)`);
  let buf: Buffer = Buffer.from(await file.arrayBuffer());
  let mime = sniff(buf);
  if (!mime || !opts.allow.includes(mime)) throw new HttpError(415, `Unsupported file type. Allowed: ${opts.allow.map((m) => EXT[m]).join(", ")}`);

  if (mime === "image/svg+xml") {
    const clean = DOMPurify.sanitize(buf.toString("utf8"), { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ["script", "foreignObject", "style"], FORBID_ATTR: ["onload", "onclick", "href", "xlink:href"] });
    if (!clean.includes("<svg")) throw new HttpError(415, "The SVG could not be read after sanitising");
    buf = Buffer.from(clean, "utf8");
  }
  let width: number | null = null;
  let height: number | null = null;
  if (mime.startsWith("image/")) {
    const meta = await sharp(buf).metadata().catch(() => null);
    if (!meta) throw new HttpError(415, "The image could not be read");
    width = meta.width ?? null;
    height = meta.height ?? null;
    if (opts.toJpeg && mime !== "image/jpeg" && mime !== "image/svg+xml") {
      buf = await sharp(buf).flatten({ background: "#FFFFFF" }).jpeg({ quality: 92 }).toBuffer();
      mime = "image/jpeg";
    }
  }
  const url = await putObject(newKey(opts.prefix, EXT[mime]), buf, mime);
  return { url, mimeType: mime, width, height, bytes: buf.length };
}

export const MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/quicktime"];
export const LOGO_TYPES = ["image/png", "image/svg+xml"];
export const FONT_TYPES = ["font/ttf", "font/otf", "font/woff", "font/woff2"];
