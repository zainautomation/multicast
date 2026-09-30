import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { verifyBearer } from "@/lib/tokens";
import { buildMcpServer } from "@/lib/mcp/server";
import { CORS, resourceMetadataUrl } from "@/lib/mcp/oauth-meta";

// Streamable HTTP MCP endpoint, stateless: each request gets its own server and transport,
// which suits serverless functions (no session to pin to one instance).

async function handle(req: Request) {
  const auth = await verifyBearer(req.headers.get("authorization"));
  if (!auth) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: connect with OAuth or send Authorization: Bearer <Multicast API key>" }, id: null },
      { status: 401, headers: { ...CORS, "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl()}"` } },
    );
  }
  const server = buildMcpServer(auth.workspaceId);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    const res = await transport.handleRequest(req);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    const body = await res.arrayBuffer();
    return new Response(body.byteLength ? body : null, { status: res.status, headers });
  } finally {
    await server.close().catch(() => undefined);
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });

export const dynamic = "force-dynamic";
// Generating posts and publishing can take minutes (Vercel function limit).
export const maxDuration = 300;
