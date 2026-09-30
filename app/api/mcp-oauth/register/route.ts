import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { CORS } from "@/lib/mcp/oauth-meta";

// Dynamic client registration (RFC 7591) for MCP clients such as Claude connectors.
// Registering grants nothing: every connection still needs the owner to sign in and approve.

const RedirectUri = z
  .string()
  .url()
  .refine((u) => {
    const x = new URL(u);
    return x.protocol === "https:" || (x.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(x.hostname));
  }, "Redirect URIs must be https (or http on localhost)");

const Reg = z.object({
  client_name: z.string().trim().max(100).optional(),
  redirect_uris: z.array(RedirectUri).min(1).max(10),
});

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
    rateLimit(`oauth-reg:${ip}`, 20, 3600_000);
    const r = Reg.parse(await req.json().catch(() => ({})));
    const c = await db.oAuthClient.create({ data: { name: r.client_name || "MCP client", redirectUris: r.redirect_uris } });
    return Response.json(
      {
        client_id: c.id,
        client_name: c.name,
        redirect_uris: c.redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_id_issued_at: Math.floor(c.createdAt.getTime() / 1000),
      },
      { status: 201, headers: CORS },
    );
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 400;
    const msg = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : e instanceof Error ? e.message : "Invalid registration";
    return Response.json({ error: "invalid_client_metadata", error_description: msg }, { status, headers: CORS });
  }
}

export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
