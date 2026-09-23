import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getCtx, type Ctx } from "@/lib/auth";

import { HttpError } from "@/lib/errors";
import { appUrl } from "@/lib/env";

export { HttpError };

export const json = (data: unknown, init?: number | ResponseInit) =>
  NextResponse.json(data, typeof init === "number" ? { status: init } : init);

/**
 * CSRF protection for cookie-authenticated mutations: the request must come from our own
 * origin. Browsers always send Origin on cross-site POST/PUT/PATCH/DELETE, so a mismatch
 * (or a missing Origin together with a foreign Referer) is rejected.
 */
function checkSameOrigin(req: NextRequest) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const allowed = new Set<string>([req.nextUrl.origin]);
  allowed.add(new URL(appUrl()).origin);
  const origin = req.headers.get("origin");
  if (origin) {
    if (!allowed.has(origin)) throw new HttpError(403, "Cross-origin request blocked");
    return;
  }
  const referer = req.headers.get("referer");
  if (referer && !allowed.has(new URL(referer).origin)) throw new HttpError(403, "Cross-origin request blocked");
}

type Handler<P> = (req: NextRequest, ctx: Ctx, params: P) => Promise<Response | unknown>;

/** Wrap an authenticated route handler: session, CSRF, error mapping. */
export function route<P = Record<string, string>>(handler: Handler<P>) {
  return async (req: NextRequest, context: { params: Promise<P> }) => {
    try {
      checkSameOrigin(req);
      const ctx = await getCtx();
      if (!ctx) throw new HttpError(401, "Sign in first");
      const params = context?.params ? await context.params : ({} as P);
      const out = await handler(req, ctx, params);
      if (out instanceof Response) return out;
      return json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status);
  if (e instanceof ZodError) return json({ error: "Invalid input", issues: e.issues }, 400);
  console.error("[api]", e instanceof Error ? e.message : e);
  return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
}

export async function body<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Expected a JSON body");
  }
  return schema.parse(raw);
}

// Simple per-process sliding-window rate limiter (single-owner app; Redis not required).
const hits = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new HttpError(429, "Too many requests — wait a moment and try again");
  arr.push(now);
  hits.set(key, arr);
}
