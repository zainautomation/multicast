import { authorizationServerMetadata, CORS } from "@/lib/mcp/oauth-meta";

export const dynamic = "force-dynamic";
export const GET = () => Response.json(authorizationServerMetadata(), { headers: CORS });
export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
