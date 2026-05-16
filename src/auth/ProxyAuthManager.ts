/**
 * Simplified MCP Authentication Manager using the MCP SDK's ProxyOAuthServerProvider.
 * This provides OAuth2 proxy functionality for Fastify, leveraging the SDK's auth logic
 * while maintaining compatibility with the existing Fastify-based architecture.
 * Uses standard OAuth identity scopes with binary authentication (authenticated vs not).
 * Supports hybrid token validation: JWT tokens using JWKS, opaque tokens using userinfo endpoint.
 */

import { ProxyOAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { logger } from "../utils/logger";
import type { AuthConfig, AuthContext } from "./types";

/**
 * OAuth2 grant types accepted by the /oauth/token proxy endpoint.
 * Restricting these prevents the proxy from being used as an open relay
 * for arbitrary grant flows against the upstream authorization server
 * (e.g. password, client_credentials) that this resource server does not
 * advertise in its authorization-server metadata.
 *
 * These values are the single source of truth and are also referenced
 * by the `/.well-known/oauth-authorization-server` metadata endpoint.
 */
export const ALLOWED_GRANT_TYPES = new Set(["authorization_code", "refresh_token"]);

/**
 * OAuth2 response types accepted by the /oauth/authorize proxy endpoint.
 * Single source of truth — also referenced by the AS metadata endpoint.
 */
export const ALLOWED_RESPONSE_TYPES = new Set(["code"]);

/**
 * Forward a proxied upstream response to the client as JSON, defending against
 * the upstream returning a non-JSON body (e.g. an HTML 502 page from an
 * intermediate proxy). Calling `response.json()` directly would throw a
 * SyntaxError in that case, leaving Fastify to emit an unhandled 500 with no
 * useful error envelope. Instead we surface a spec-shaped OAuth error so the
 * MCP client sees a parseable JSON body.
 */
async function sendUpstreamJsonResponse(
  reply: import("fastify").FastifyReply,
  response: Response,
  upstream: string,
): Promise<void> {
  const text = await response.text();
  // Both /oauth/token and /oauth/register are specified to return a JSON
  // object; an empty body — like a non-JSON body — is treated as an upstream
  // failure rather than silently forwarded. Forwarding `null` would technically
  // be valid JSON but defeats the purpose of this helper: clients expect an
  // object they can read `.error` / `.access_token` from.
  if (text.length > 0) {
    try {
      const data = JSON.parse(text);
      if (data !== null && typeof data === "object") {
        reply.status(response.status).type("application/json").send(data);
        return;
      }
    } catch {
      // fall through to the error envelope below
    }
  }
  logger.warn(
    `Upstream ${upstream} endpoint returned a non-JSON-object body (status=${response.status}, bytes=${text.length})`,
  );
  reply
    .status(502)
    .type("application/json")
    .send({
      error: "server_error",
      error_description: `Upstream ${upstream} endpoint returned an invalid response.`,
    });
}

export class ProxyAuthManager {
  private proxyProvider: ProxyOAuthServerProvider | null = null;
  private discoveredEndpoints: {
    authorizationUrl: string;
    tokenUrl: string;
    revocationUrl?: string;
    registrationUrl?: string;
    jwksUri?: string;
    userinfoUrl?: string;
  } | null = null;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(private config: AuthConfig) {}

  /**
   * Get the authentication configuration
   */
  get authConfig(): AuthConfig {
    return this.config;
  }

  /**
   * Initialize the proxy auth manager with the configured OAuth provider.
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      logger.debug("Authentication disabled, skipping proxy auth manager initialization");
      return;
    }

    if (!this.config.issuerUrl || !this.config.audience) {
      throw new Error("Issuer URL and Audience are required when auth is enabled");
    }

    try {
      logger.info("🔐 Initializing OAuth2 proxy authentication...");

      // Discover and cache the OAuth endpoints from the provider
      this.discoveredEndpoints = await this.discoverEndpoints();

      // Set up JWKS for JWT token validation if available
      if (this.discoveredEndpoints.jwksUri) {
        this.jwks = createRemoteJWKSet(new URL(this.discoveredEndpoints.jwksUri));
        logger.debug(`JWKS configured from: ${this.discoveredEndpoints.jwksUri}`);
      }

      // Log validation capabilities
      const capabilities = [];
      if (this.discoveredEndpoints.jwksUri) capabilities.push("JWT validation via JWKS");
      if (this.discoveredEndpoints.userinfoUrl)
        capabilities.push("opaque token validation via userinfo");
      logger.debug(`Token validation capabilities: ${capabilities.join(", ")}`);

      if (capabilities.length === 0) {
        logger.warn(
          "⚠️  No token validation mechanisms available - authentication may fail",
        );
      }

      // Create the proxy provider
      this.proxyProvider = new ProxyOAuthServerProvider({
        endpoints: {
          authorizationUrl: this.discoveredEndpoints.authorizationUrl,
          tokenUrl: this.discoveredEndpoints.tokenUrl,
          revocationUrl: this.discoveredEndpoints.revocationUrl,
          registrationUrl: this.discoveredEndpoints.registrationUrl,
        },
        verifyAccessToken: this.verifyAccessToken.bind(this),
        getClient: this.getClient.bind(this),
      });

      logger.info("✅ OAuth2 proxy authentication initialized successfully");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error(`❌ Failed to initialize OAuth2 proxy authentication: ${message}`);
      throw new Error(`Proxy authentication initialization failed: ${message}`);
    }
  }

  /**
   * Register OAuth2 endpoints on the Fastify server.
   * This manually implements the necessary OAuth2 endpoints using the proxy provider.
   */
  registerRoutes(server: FastifyInstance, baseUrl: URL): void {
    if (!this.proxyProvider) {
      throw new Error("Proxy provider not initialized");
    }

    // OAuth2 Authorization Server Metadata (RFC 8414)
    server.get("/.well-known/oauth-authorization-server", async (_request, reply) => {
      const metadata = {
        issuer: baseUrl.origin,
        authorization_endpoint: `${baseUrl.origin}/oauth/authorize`,
        token_endpoint: `${baseUrl.origin}/oauth/token`,
        revocation_endpoint: `${baseUrl.origin}/oauth/revoke`,
        registration_endpoint: `${baseUrl.origin}/oauth/register`,
        scopes_supported: ["profile", "email"],
        response_types_supported: [...ALLOWED_RESPONSE_TYPES],
        grant_types_supported: [...ALLOWED_GRANT_TYPES],
        token_endpoint_auth_methods_supported: [
          "client_secret_basic",
          "client_secret_post",
          "none",
        ],
        code_challenge_methods_supported: ["S256"],
      };

      reply.type("application/json").send(metadata);
    });

    // OAuth2 Protected Resource Metadata (RFC 9728).
    //
    // Identifiers here are derived from the trusted `baseUrl` (config-driven),
    // not from `request.headers.host`. The Host header is client-controlled,
    // and this metadata is consumed by clients to decide which resource server
    // to bind tokens to — so trusting the Host header here would reintroduce
    // the audience-binding attack vector that the OAuth proxy itself defends
    // against.
    server.get("/.well-known/oauth-protected-resource", async (_request, reply) => {
      const origin = baseUrl.origin;
      const metadata = {
        resource: `${origin}/sse`,
        authorization_servers: [this.config.issuerUrl],
        scopes_supported: ["profile", "email"],
        bearer_methods_supported: ["header"],
        resource_name: "Documentation MCP Server",
        resource_documentation: "https://github.com/arabold/docs-mcp-server#readme",
        // Enhanced metadata for better discoverability
        resource_server_metadata_url: `${origin}/.well-known/oauth-protected-resource`,
        authorization_server_metadata_url: `${this.config.issuerUrl}/.well-known/openid-configuration`,
        jwks_uri: `${this.config.issuerUrl}/.well-known/jwks.json`,
        // Supported MCP transports
        mcp_transports: [
          {
            transport: "sse",
            endpoint: `${origin}/sse`,
            description: "Server-Sent Events transport",
          },
          {
            transport: "http",
            endpoint: `${origin}/mcp`,
            description: "Streaming HTTP transport",
          },
        ],
      };

      reply.type("application/json").send(metadata);
    });

    // Resource identifier pinned to the trusted `baseUrl` (config-derived),
    // NOT to `request.headers.host`. The Host header is client-controlled and
    // can be spoofed when the deployment lacks strict Host validation upstream,
    // which would reintroduce the very audience-binding attack this proxy is
    // meant to prevent.
    const pinnedResourceUrl = `${baseUrl.origin}/sse`;

    // OAuth2 Authorization endpoint
    server.get("/oauth/authorize", async (request, reply) => {
      const params = new URLSearchParams(request.query as Record<string, string>);

      // Validate response_type matches what this AS advertises (RFC 6749 §3.1.1
      // and §4.1.2.1). A missing parameter is `invalid_request`; a value that
      // is present but unsupported is `unsupported_response_type`. Validation
      // runs before upstream discovery so that bogus requests do not incur a
      // network round-trip to the authorization server.
      const responseType = params.get("response_type");
      if (!responseType) {
        reply.status(400).type("application/json").send({
          error: "invalid_request",
          error_description: "Missing required parameter 'response_type'.",
        });
        return;
      }
      if (!ALLOWED_RESPONSE_TYPES.has(responseType)) {
        reply.status(400).type("application/json").send({
          error: "unsupported_response_type",
          error_description: "Only the 'code' response_type is supported by this proxy.",
        });
        return;
      }

      // Force the resource parameter (RFC 8707) to this server's own resource
      // identifier. Trusting a client-supplied `resource` here would let a
      // caller mint tokens audience-bound to a different resource server and
      // replay them against that server.
      params.set("resource", pinnedResourceUrl);

      const endpoints = await this.discoverEndpoints();
      const redirectUrl = `${endpoints.authorizationUrl}?${params.toString()}`;
      reply.redirect(redirectUrl);
    });

    // OAuth2 Token endpoint
    server.post("/oauth/token", async (request, reply) => {
      const tokenBody = new URLSearchParams(request.body as Record<string, string>);

      // Validate grant_type against the allow-list advertised in our AS
      // metadata (RFC 6749 §4 / §5.2). A missing parameter is `invalid_request`;
      // a present-but-unsupported value is `unsupported_grant_type`. Without
      // this check the proxy is effectively an open relay to the upstream token
      // endpoint and could be used to obtain tokens via grants this resource
      // server never sanctioned (e.g. password, client_credentials,
      // urn:ietf:params:oauth:grant-type:*).
      const grantType = tokenBody.get("grant_type");
      if (!grantType) {
        reply.status(400).type("application/json").send({
          error: "invalid_request",
          error_description: "Missing required parameter 'grant_type'.",
        });
        return;
      }
      if (!ALLOWED_GRANT_TYPES.has(grantType)) {
        reply
          .status(400)
          .type("application/json")
          .send({
            error: "unsupported_grant_type",
            error_description: `Grant type '${grantType}' is not supported by this proxy.`,
          });
        return;
      }

      // Force the resource parameter (RFC 8707) to this server's own resource
      // identifier, regardless of what the client requested. This ensures the
      // upstream AS audience-binds the issued token to this MCP server and not
      // an arbitrary attacker-chosen resource.
      tokenBody.set("resource", pinnedResourceUrl);

      const endpoints = await this.discoverEndpoints();

      const response = await fetch(endpoints.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: tokenBody.toString(),
      });

      await sendUpstreamJsonResponse(reply, response, "token");
    });

    // OAuth2 Token Revocation endpoint
    server.post("/oauth/revoke", async (request, reply) => {
      const endpoints = await this.discoverEndpoints();

      if (endpoints.revocationUrl) {
        const response = await fetch(endpoints.revocationUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams(request.body as Record<string, string>).toString(),
        });

        reply.status(response.status).send();
      } else {
        reply.status(404).send({ error: "Revocation not supported" });
      }
    });

    // OAuth2 Dynamic Client Registration endpoint
    server.post("/oauth/register", async (request, reply) => {
      const endpoints = await this.discoverEndpoints();

      if (endpoints.registrationUrl) {
        const response = await fetch(endpoints.registrationUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request.body),
        });

        await sendUpstreamJsonResponse(reply, response, "register");
      } else {
        reply.status(404).send({ error: "Dynamic client registration not supported" });
      }
    });

    logger.debug("OAuth2 endpoints registered on Fastify server");
  }

  /**
   * Discover OAuth endpoints from the OAuth2 authorization server.
   * Uses OAuth2 discovery (RFC 8414) with OIDC discovery fallback.
   * Supports both JWT and opaque token validation methods.
   */
  private async discoverEndpoints() {
    // Try OAuth2 authorization server discovery first (RFC 8414)
    const oauthDiscoveryUrl = `${this.config.issuerUrl}/.well-known/oauth-authorization-server`;

    try {
      const oauthResponse = await fetch(oauthDiscoveryUrl);
      if (oauthResponse.ok) {
        const config = await oauthResponse.json();
        logger.debug(
          `Successfully discovered OAuth2 endpoints from: ${oauthDiscoveryUrl}`,
        );

        // Try to get userinfo endpoint from OIDC discovery as fallback for opaque tokens
        const userinfoEndpoint = await this.discoverUserinfoEndpoint();
        if (userinfoEndpoint) {
          config.userinfo_endpoint = userinfoEndpoint;
        }

        return this.buildEndpointsFromConfig(config);
      }
    } catch (error) {
      logger.debug(`OAuth2 discovery failed: ${error}, trying OIDC discovery`);
    }

    // Fallback to OIDC discovery
    const oidcDiscoveryUrl = `${this.config.issuerUrl}/.well-known/openid-configuration`;
    const oidcResponse = await fetch(oidcDiscoveryUrl);
    if (!oidcResponse.ok) {
      throw new Error(
        `Failed to fetch configuration from both ${oauthDiscoveryUrl} and ${oidcDiscoveryUrl}`,
      );
    }

    const config = await oidcResponse.json();
    logger.debug(`Successfully discovered OIDC endpoints from: ${oidcDiscoveryUrl}`);
    return this.buildEndpointsFromConfig(config);
  }

  /**
   * Try to discover userinfo endpoint for opaque token validation
   */
  private async discoverUserinfoEndpoint(): Promise<string | null> {
    try {
      const oidcDiscoveryUrl = `${this.config.issuerUrl}/.well-known/openid-configuration`;
      const response = await fetch(oidcDiscoveryUrl);
      if (response.ok) {
        const config = await response.json();
        return config.userinfo_endpoint || null;
      }
    } catch (error) {
      logger.debug(`Failed to fetch userinfo endpoint: ${error}`);
    }
    return null;
  }

  /**
   * Build endpoint configuration from discovery response.
   */
  private buildEndpointsFromConfig(config: Record<string, unknown>) {
    return {
      authorizationUrl: config.authorization_endpoint as string,
      tokenUrl: config.token_endpoint as string,
      revocationUrl: config.revocation_endpoint as string | undefined,
      registrationUrl: config.registration_endpoint as string | undefined,
      jwksUri: config.jwks_uri as string | undefined,
      userinfoUrl: config.userinfo_endpoint as string | undefined,
    };
  }

  /**
   * Get supported resource URLs for this MCP server instance.
   * This enables self-discovering resource validation per MCP Authorization spec.
   */
  private getSupportedResources(request: FastifyRequest): string[] {
    const baseUrl = `${request.protocol}://${request.headers.host}`;

    return [
      `${baseUrl}/sse`, // SSE transport
      `${baseUrl}/mcp`, // Streaming HTTP transport
      `${baseUrl}`, // Server root
    ];
  }

  /**
   * Verify an access token using hybrid validation approach.
   * First tries JWT validation with JWKS, falls back to userinfo endpoint for opaque tokens.
   * This provides universal compatibility with all OAuth2 providers and token formats.
   */
  private async verifyAccessToken(token: string, request?: FastifyRequest) {
    logger.debug(`Attempting to verify token: ${token.substring(0, 20)}...`);

    // Strategy 1: Try JWT validation first (more efficient for JWT tokens)
    if (this.jwks) {
      try {
        logger.debug("Attempting JWT validation with JWKS...");
        const { payload } = await jwtVerify(token, this.jwks, {
          issuer: this.config.issuerUrl,
          audience: this.config.audience,
        });

        logger.debug(
          `JWT validation successful. Subject: ${payload.sub}, Audience: ${payload.aud}`,
        );

        if (!payload.sub) {
          throw new Error("JWT payload missing subject claim");
        }

        return {
          token,
          clientId: payload.sub,
          scopes: ["*"], // Full access for all authenticated users
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.debug(
          `JWT validation failed: ${errorMessage}, trying userinfo fallback...`,
        );
        // Continue to userinfo fallback
      }
    }

    // Strategy 2: Fallback to userinfo endpoint validation (works for opaque tokens)
    if (this.discoveredEndpoints?.userinfoUrl) {
      try {
        logger.debug("Attempting userinfo endpoint validation...");
        const response = await fetch(this.discoveredEndpoints.userinfoUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(
            `Userinfo request failed: ${response.status} ${response.statusText}`,
          );
        }

        const userinfo = await response.json();
        logger.debug(
          `Token validation successful. User: ${userinfo.sub}, Email: ${userinfo.email}`,
        );

        if (!userinfo.sub) {
          throw new Error("Userinfo response missing subject");
        }

        // Optional: Resource validation if MCP Authorization spec requires it
        if (request) {
          const supportedResources = this.getSupportedResources(request);
          logger.debug(`Supported resources: ${JSON.stringify(supportedResources)}`);
          // For now, we allow access if the token is valid - binary authentication
        }

        return {
          token,
          clientId: userinfo.sub,
          scopes: ["*"], // Full access for all authenticated users
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.debug(`Userinfo validation failed: ${errorMessage}`);
        // Continue to final error
      }
    }

    // Both validation strategies failed
    logger.debug("All token validation strategies exhausted");
    throw new Error("Invalid access token");
  }

  /**
   * Get client information for the given client ID.
   * This is called by the proxy provider for client validation.
   */
  private async getClient(clientId: string) {
    // For now, return a basic client configuration
    // In a real implementation, you might look this up from a database
    return {
      client_id: clientId,
      redirect_uris: [`${this.config.audience}/callback`],
      // Add other client metadata as needed
    };
  }

  /**
   * Create an authentication context from a token (for compatibility with existing middleware).
   * Uses binary authentication - valid token grants full access.
   */
  async createAuthContext(
    authorization: string,
    request?: FastifyRequest,
  ): Promise<AuthContext> {
    if (!this.config.enabled) {
      return {
        authenticated: false,
        scopes: new Set(),
      };
    }

    try {
      logger.debug(
        `Processing authorization header: ${authorization.substring(0, 20)}...`,
      );

      const match = authorization.match(/^Bearer\s+(.+)$/i);
      if (!match) {
        logger.debug("Authorization header does not match Bearer token pattern");
        throw new Error("Invalid authorization header format");
      }

      const token = match[1];
      logger.debug(`Extracted token: ${token.substring(0, 20)}...`);

      const authInfo = await this.verifyAccessToken(token, request);

      logger.debug(`Authentication successful for client: ${authInfo.clientId}`);

      // Binary authentication: valid token = full access
      return {
        authenticated: true,
        scopes: new Set(["*"]), // Full access for authenticated users
        subject: authInfo.clientId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.debug(`Authentication failed: ${errorMessage}`);
      return {
        authenticated: false,
        scopes: new Set(),
      };
    }
  }
}
