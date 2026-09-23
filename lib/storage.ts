import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

// S3-compatible storage. Objects must be publicly reachable over HTTPS for Instagram.
// Without S3_BUCKET, files go to ./storage and are served by /api/files/[...key] (dev only).

const LOCAL_ROOT = path.join(process.cwd(), "storage");

let s3: S3Client | null = null;
function client() {
  if (!s3) {
    s3 = new S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      credentials:
        process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }
  return s3;
}

const useS3 = () => !!process.env.S3_BUCKET;

export function newKey(prefix: string, ext: string) {
  const d = new Date();
  return `${prefix}/${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}/${randomBytes(10).toString("hex")}.${ext}`;
}

export function publicUrl(key: string): string {
  if (useS3()) {
    const base = process.env.S3_PUBLIC_BASE_URL?.replace(/\/$/, "");
    if (base) return `${base}/${key}`;
    const ep = (process.env.S3_ENDPOINT || `https://s3.${process.env.S3_REGION}.amazonaws.com`).replace(/\/$/, "");
    return `${ep}/${process.env.S3_BUCKET}/${key}`;
  }
  const app = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${app}/api/files/${key}`;
}

export async function putObject(key: string, data: Buffer, contentType: string): Promise<string> {
  if (useS3()) {
    await client().send(
      new PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key, Body: data, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }),
    );
  } else {
    const file = path.join(LOCAL_ROOT, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  }
  return publicUrl(key);
}

export function keyFromUrl(url: string): string | null {
  const base = publicUrl("");
  if (url.startsWith(base)) return url.slice(base.length);
  const m = url.match(/\/api\/files\/(.+)$/);
  return m ? m[1] : null;
}

/** Read an object we stored (by URL or key). Falls back to HTTP fetch for foreign URLs. */
export async function readObject(urlOrKey: string): Promise<Buffer> {
  const key = /^https?:/.test(urlOrKey) ? keyFromUrl(urlOrKey) : urlOrKey;
  if (key) {
    if (useS3()) {
      const res = await client().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    }
    const file = path.join(LOCAL_ROOT, key);
    if (!file.startsWith(LOCAL_ROOT)) throw new Error("Invalid key");
    return fs.readFile(file);
  }
  const res = await fetch(urlOrKey);
  if (!res.ok) throw new Error(`Could not fetch ${urlOrKey}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function readLocal(key: string): Promise<Buffer | null> {
  const file = path.normalize(path.join(LOCAL_ROOT, key));
  if (!file.startsWith(LOCAL_ROOT + path.sep)) return null;
  try {
    return await fs.readFile(file);
  } catch {
    return null;
  }
}

export const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mov: "video/quicktime",
  pdf: "application/pdf",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};
