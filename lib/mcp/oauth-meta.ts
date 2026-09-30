import { appUrl } from "@/lib/env";

// OAuth 2.1 metadata for MCP clients (RFC 9728 protected resource, RFC 8414 server).

export const mcpResource = () => `${appUrl()}/api/mcp`;
export const resourceMetadataUrl = () => `${appUrl()}/.well-known/oauth-protected-resource/api/mcp`;

export function protectedResourceMetadata() {
  return { resource: mcpResource(), authorization_servers: [appUrl()], bearer_methods_supported: ["header"], resource_name: "Multicast" };
}

export function authorizationServerMetadata() {
  const base = appUrl();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/mcp-oauth/token`,
    registration_endpoint: `${base}/api/mcp-oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  };
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
};
