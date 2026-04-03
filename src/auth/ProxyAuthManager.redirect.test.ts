/**
 * Tests for CWE-601 open redirect fix in ProxyAuthManager /oauth/authorize endpoint.
 *
 * The authorize endpoint must only allow redirect_uri values whose origin
 * matches the proxy server's own origin (derived from the incoming request).
 * Forwarding an attacker-supplied redirect_uri to the upstream authorization
 * server can lead to authorization-code interception (open redirect).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyAuthManager } from "./ProxyAuthManager";
import type { AuthConfig } from "./types";

// Mock the MCP SDK
vi.mock("@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js", () => ({
  ProxyOAuthServerProvider: vi.fn().mockImplementation(() => ({})),
}));

// Mock jose library
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn().mockReturnValue({}),
  jwtVerify: vi.fn(),
}));

import { server } from "../../test/mock-server";

beforeEach(() => {
  server.resetHandlers();
});

describe("ProxyAuthManager /oauth/authorize redirect_uri validation", () => {
  let authManager: ProxyAuthManager;
  let mockServer: FastifyInstance;
  let registeredHandlers: Record<
    string,
    (req: FastifyRequest, rep: FastifyReply) => Promise<void>
  >;
  let validAuthConfig: AuthConfig;

  beforeEach(async () => {
    vi.clearAllMocks();

    validAuthConfig = {
      enabled: true,
      issuerUrl: "https://auth.example.com",
      audience: "https://mcp.example.com",
      scopes: ["profile", "email"],
    };

    registeredHandlers = {};

    // Capture route handlers registered on the Fastify mock
    mockServer = {
      get: vi.fn((path: string, handler: any) => {
        registeredHandlers[`GET ${path}`] = handler;
      }),
      post: vi.fn((path: string, handler: any) => {
        registeredHandlers[`POST ${path}`] = handler;
      }),
    } as unknown as FastifyInstance;

    // Set up MSW handlers for OAuth2 discovery
    server.use(
      http.get("https://auth.example.com/.well-known/oauth-authorization-server", () => {
        return HttpResponse.json({
          authorization_endpoint: "https://auth.example.com/oauth/authorize",
          token_endpoint: "https://auth.example.com/oauth/token",
          revocation_endpoint: "https://auth.example.com/oauth/revoke",
          registration_endpoint: "https://auth.example.com/oauth/register",
          jwks_uri: "https://auth.example.com/.well-known/jwks.json",
          userinfo_endpoint: "https://auth.example.com/oauth/userinfo",
        });
      }),
      http.get("https://auth.example.com/.well-known/openid-configuration", () => {
        return HttpResponse.json({
          authorization_endpoint: "https://auth.example.com/oauth/authorize",
          token_endpoint: "https://auth.example.com/oauth/token",
          jwks_uri: "https://auth.example.com/.well-known/jwks.json",
          userinfo_endpoint: "https://auth.example.com/oauth/userinfo",
        });
      }),
    );

    authManager = new ProxyAuthManager(validAuthConfig);
    await authManager.initialize();
    authManager.registerRoutes(mockServer, new URL("https://server.example.com"));
  });

  /**
   * Helper to invoke the registered /oauth/authorize handler with given query params.
   */
  async function callAuthorize(query: Record<string, string>) {
    const handler = registeredHandlers["GET /oauth/authorize"];
    expect(handler).toBeDefined();

    let redirectedTo: string | undefined;
    let statusCode: number | undefined;
    let sentBody: unknown;

    const mockRequest = {
      query,
      protocol: "https",
      headers: { host: "server.example.com" },
    } as unknown as FastifyRequest;

    const mockReply = {
      redirect: vi.fn((url: string) => {
        redirectedTo = url;
        return mockReply;
      }),
      status: vi.fn((code: number) => {
        statusCode = code;
        return mockReply;
      }),
      send: vi.fn((body: unknown) => {
        sentBody = body;
        return mockReply;
      }),
    } as unknown as FastifyReply;

    await handler(mockRequest, mockReply);
    return { redirectedTo, statusCode, sentBody, mockReply };
  }

  it("should allow redirect_uri that matches the proxy server origin", async () => {
    const { redirectedTo, statusCode } = await callAuthorize({
      client_id: "test-client",
      redirect_uri: "https://server.example.com/callback",
      response_type: "code",
      scope: "openid",
    });

    // Should redirect (no error status)
    expect(statusCode).toBeUndefined();
    expect(redirectedTo).toBeDefined();
    expect(redirectedTo).toContain("https://auth.example.com/oauth/authorize");
    expect(redirectedTo).toContain("redirect_uri");
  });

  it("should reject redirect_uri pointing to an attacker-controlled domain", async () => {
    const { statusCode, sentBody } = await callAuthorize({
      client_id: "test-client",
      redirect_uri: "https://evil.com/steal",
      response_type: "code",
      scope: "openid",
    });

    // Should NOT redirect to the upstream with the evil redirect_uri
    expect(statusCode).toBe(400);
    expect(sentBody).toEqual(expect.objectContaining({ error: "invalid_request" }));
  });

  it("should reject redirect_uri with a different port on same host", async () => {
    const { statusCode, sentBody } = await callAuthorize({
      client_id: "test-client",
      redirect_uri: "https://server.example.com:8443/callback",
      response_type: "code",
      scope: "openid",
    });

    // Different port = different origin; should be rejected
    expect(statusCode).toBe(400);
    expect(sentBody).toEqual(expect.objectContaining({ error: "invalid_request" }));
  });

  it("should reject redirect_uri with http scheme when proxy uses https", async () => {
    const { statusCode, sentBody } = await callAuthorize({
      client_id: "test-client",
      redirect_uri: "http://server.example.com/callback",
      response_type: "code",
      scope: "openid",
    });

    // Scheme mismatch (http vs https) = different origin
    expect(statusCode).toBe(400);
    expect(sentBody).toEqual(expect.objectContaining({ error: "invalid_request" }));
  });

  it("should allow requests without redirect_uri (let upstream handle it)", async () => {
    const { redirectedTo, statusCode } = await callAuthorize({
      client_id: "test-client",
      response_type: "code",
      scope: "openid",
    });

    // No redirect_uri means upstream will use the default; should be allowed
    expect(statusCode).toBeUndefined();
    expect(redirectedTo).toBeDefined();
    expect(redirectedTo).toContain("https://auth.example.com/oauth/authorize");
  });

  it("should reject redirect_uri using javascript: scheme", async () => {
    const { statusCode, sentBody } = await callAuthorize({
      client_id: "test-client",
      redirect_uri: "javascript:alert(1)",
      response_type: "code",
      scope: "openid",
    });

    expect(statusCode).toBe(400);
    expect(sentBody).toEqual(expect.objectContaining({ error: "invalid_request" }));
  });

  it("should reject redirect_uri with subdomain of the proxy host", async () => {
    const { statusCode, sentBody } = await callAuthorize({
      client_id: "test-client",
      redirect_uri: "https://evil.server.example.com/callback",
      response_type: "code",
      scope: "openid",
    });

    // Subdomain does NOT match the exact origin; reject
    expect(statusCode).toBe(400);
    expect(sentBody).toEqual(expect.objectContaining({ error: "invalid_request" }));
  });
});
