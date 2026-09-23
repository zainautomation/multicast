import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { body, errorResponse, json, rateLimit, HttpError } from "@/lib/api";
import { ownerExists } from "@/lib/auth";
import { createWorkspaceWithOwner } from "@/lib/workspace";

// First-run only: creates the single owner account. Refuses once an owner exists.
export async function POST(req: NextRequest) {
  try {
    rateLimit(`setup:${req.headers.get("x-forwarded-for") ?? "local"}`, 5, 60_000);
    if (await ownerExists()) throw new HttpError(409, "An owner account already exists. Sign in instead.");
    const b = await body(req, z.object({ email: z.string().email(), password: z.string().min(10, "Use at least 10 characters"), name: z.string().max(80).optional() }));
    await createWorkspaceWithOwner(b.email, await bcrypt.hash(b.password, 12), b.name);
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
