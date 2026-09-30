import { CORS, protectedResourceMetadata } from "@/lib/mcp/oauth-meta";

export const dynamic = "force-dynamic";
export const GET = () => Response.json(protectedResourceMetadata(), { headers: CORS });
export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
