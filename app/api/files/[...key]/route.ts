import type { NextRequest } from "next/server";
import { MIME_BY_EXT, readLocal } from "@/lib/storage";

// Serves ./storage when no S3 bucket is configured (development). Object keys are random,
// so URLs are unguessable; platforms like Instagram need them to be publicly reachable.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const k = key.join("/");
  const buf = await readLocal(k);
  if (!buf) return new Response("Not found", { status: 404 });
  const ext = k.split(".").pop()?.toLowerCase() ?? "";
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": MIME_BY_EXT[ext] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      ...(ext === "svg" ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } : {}),
    },
  });
}
