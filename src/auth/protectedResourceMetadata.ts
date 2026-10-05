/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP endpoint, and
 * the pieces of the discovery challenge that point clients at it.
 *
 * Every value derives from configuration (the public location and the issuer),
 * never from the request's `Host` header: clients bind tokens to the
 * `resource` published here, so a spoofable value would let an attacker steer
 * that binding.
 */

const WELL_KNOWN_PREFIX = "/.well-known/oauth-protected-resource";

/**
 * Build the protected resource metadata document.
 * @param options.mcpEndpointUrl - Public URL of the MCP endpoint, which is the resource identifier.
 * @param options.issuerUrl - The authorization server's issuer identifier.
 * @returns The RFC 9728 document.
 */
export function buildProtectedResourceMetadata(options: {
  mcpEndpointUrl: string;
  issuerUrl: string;
}): Record<string, unknown> {
  return {
    resource: options.mcpEndpointUrl,
    authorization_servers: [options.issuerUrl],
    bearer_methods_supported: ["header"],
    resource_name: "Documentation MCP Server",
    resource_documentation: "https://github.com/arabold/docs-mcp-server#readme",
  };
}

/**
 * Server-side paths the document is served at, after any base path has been
 * stripped from the request.
 *
 * The first path is where the discovery challenge points. With a base path,
 * the server also answers the location RFC 9728 derives from the MCP endpoint
 * URL, which sits at the host root: `/.well-known/oauth-protected-resource/docs/mcp`.
 * @param basePath - The public URL's path, `""` or e.g. `/docs`.
 * @param endpointPath - The MCP endpoint's path under the public URL, e.g. `/mcp`.
 * @returns One or two paths.
 */
export function protectedResourceMetadataPaths(
  basePath: string,
  endpointPath: string,
): string[] {
  const paths = [`${WELL_KNOWN_PREFIX}${endpointPath}`];
  if (basePath) {
    paths.push(`${WELL_KNOWN_PREFIX}${basePath}${endpointPath}`);
  }
  return paths;
}

/**
 * The metadata URL advertised in the discovery challenge. It lives under the
 * public URL's path, so a reverse proxy forwarding only that path reaches it.
 * @param publicUrl - The public URL, without a trailing slash.
 * @param endpointPath - The MCP endpoint's path under the public URL, e.g. `/mcp`.
 * @returns The absolute metadata URL.
 */
export function protectedResourceMetadataUrl(
  publicUrl: string,
  endpointPath: string,
): string {
  return `${publicUrl}${WELL_KNOWN_PREFIX}${endpointPath}`;
}

/**
 * The `WWW-Authenticate` value for a request that carried no bearer token. It
 * has no error code, per RFC 6750 §3.1, which says a request lacking any
 * authentication information SHOULD NOT get one.
 * @param resourceMetadataUrl - The metadata URL to advertise.
 * @returns The challenge header value.
 */
export function missingTokenChallenge(resourceMetadataUrl: string): string {
  const quoted = resourceMetadataUrl.replaceAll(/[\\"]/g, "\\$&");
  return `Bearer resource_metadata="${quoted}"`;
}
