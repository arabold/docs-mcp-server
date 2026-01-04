/**
 * Tests for ProxyAuthManager - focuses on behavior and public interface
 */

import type { FastifyInstance } from "fastify";
import { jwtVerify } from "jose";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyAuthManager } from "./ProxyAuthManager";
import type { AuthConfig } from "./types";

// Get the mocked function
const mockJwtVerify = vi.mocked(jwtVerify);

// Mock the MCP SDK
vi.mock("@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js", () => ({
  ProxyOAuthServerProvider: vi.fn().mockImplementation(() => ({
    // Mock implementation
  })),
}));

// Mock jose library
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn().mockReturnValue({}),
  jwtVerify: vi.fn(),
}));

// Import the global server instance instead of creating a new one
import { server } from "../../test/mock-server";

// Reset handlers is already handled in setup-e2e.ts, but we want to ensure
// clean slate for this test suite's specific needs
beforeEach(() => {
  // We don't need to listen() as it's already running from global setup
  // We just reset handlers to remove any specific overrides from previous tests
  server.resetHandlers();
});

describe("ProxyAuthManager", () => {
  let authManager: ProxyAuthManager;
  let mockServer: FastifyInstance;
  let validAuthConfig: AuthConfig;
  let disabledAuthConfig: AuthConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    validAuthConfig = {
      enabled: true,
      issuerUrl: "https://auth.example.com",
      audience: "https://mcp.example.com",
      scopes: ["profile", "email"],
    };

    disabledAuthConfig = {
      enabled: false,
      issuerUrl: undefined,
      audience: undefined,
      scopes: [],
    };

    // Mock Fastify server
    mockServer = {
      get: vi.fn(),
      post: vi.fn(),
    } as unknown as FastifyInstance;

    // Set up default MSW handlers for OAuth2 discovery
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
          revocation_endpoint: "https://auth.example.com/oauth/revoke",
          registration_endpoint: "https://auth.example.com/oauth/register",
          jwks_uri: "https://auth.example.com/.well-known/jwks.json",
          userinfo_endpoint: "https://auth.example.com/oauth/userinfo",
        });
      }),
      // Add default userinfo handler (returns 401 by default unless overridden)
      http.get("https://auth.example.com/oauth/userinfo", () => {
        return new HttpResponse(null, { status: 401 });
      }),
    );
  });

  describe("initialization", () => {
    it("should skip initialization when auth is disabled", async () => {
      authManager = new ProxyAuthManager(disabledAuthConfig);

      await expect(authManager.initialize()).resolves.toBeUndefined();
    });

    it("should initialize successfully with valid config", async () => {
      authManager = new ProxyAuthManager(validAuthConfig);

      await expect(authManager.initialize()).resolves.toBeUndefined();
    });

    it("should throw error when issuer URL is missing", async () => {
      const invalidConfig = { ...validAuthConfig, issuerUrl: undefined };
      authManager = new ProxyAuthManager(invalidConfig);

      await expect(authManager.initialize()).rejects.toThrow(
        "Issuer URL and Audience are required when auth is enabled",
      );
    });

    it("should throw error when audience is missing", async () => {
      const invalidConfig = { ...validAuthConfig, audience: undefined };
      authManager = new ProxyAuthManager(invalidConfig);

      await expect(authManager.initialize()).rejects.toThrow(
        "Issuer URL and Audience are required when auth is enabled",
      );
    });

    it("should handle OAuth2 discovery failure", async () => {
      // Override default handler to return 404
      server.use(
        http.get(
          "https://auth.example.com/.well-known/oauth-authorization-server",
          () => {
            return new HttpResponse(null, { status: 404 });
          },
        ),
        http.get("https://auth.example.com/.well-known/openid-configuration", () => {
          return new HttpResponse(null, { status: 404 });
        }),
      );

      authManager = new ProxyAuthManager(validAuthConfig);

      await expect(authManager.initialize()).rejects.toThrow(
        "Proxy authentication initialization failed",
      );
    });
  });

  describe("route registration", () => {
    beforeEach(async () => {
      authManager = new ProxyAuthManager(validAuthConfig);
      await authManager.initialize();
    });

    it("should register OAuth2 endpoints on Fastify server", () => {
      const baseUrl = new URL("https://server.example.com");

      authManager.registerRoutes(mockServer, baseUrl);

      // Verify that OAuth2 endpoints were registered
      expect(mockServer.get).toHaveBeenCalledWith(
        "/.well-known/oauth-authorization-server",
        expect.any(Function),
      );
      expect(mockServer.get).toHaveBeenCalledWith(
        "/.well-known/oauth-protected-resource",
        expect.any(Function),
      );
      expect(mockServer.get).toHaveBeenCalledWith(
        "/oauth/authorize",
        expect.any(Function),
      );
      expect(mockServer.post).toHaveBeenCalledWith("/oauth/token", expect.any(Function));
      expect(mockServer.post).toHaveBeenCalledWith("/oauth/revoke", expect.any(Function));
      expect(mockServer.post).toHaveBeenCalledWith(
        "/oauth/register",
        expect.any(Function),
      );
    });

    it("should throw error when registering routes without initialization", () => {
      const uninitializedManager = new ProxyAuthManager(validAuthConfig);
      const baseUrl = new URL("https://server.example.com");

      expect(() => uninitializedManager.registerRoutes(mockServer, baseUrl)).toThrow(
        "Proxy provider not initialized",
      );
    });
  });

  describe("authentication context creation", () => {
    describe("when auth is disabled", () => {
      beforeEach(() => {
        authManager = new ProxyAuthManager(disabledAuthConfig);
      });

      it("should return unauthenticated context", async () => {
        const context = await authManager.createAuthContext("Bearer valid-token");

        expect(context).toEqual({
          authenticated: false,
          scopes: new Set(),
        });
      });
    });

    describe("when auth is enabled", () => {
      beforeEach(async () => {
        authManager = new ProxyAuthManager(validAuthConfig);
        await authManager.initialize();
      });

      it("should return authenticated context for valid token", async () => {
        // Mock successful JWT verification
        mockJwtVerify.mockResolvedValueOnce({
          payload: {
            sub: "user123",
            aud: "https://mcp.example.com",
            iss: "https://auth.example.com",
            exp: Math.floor(Date.now() / 1000) + 3600,
          },
          protectedHeader: {
            alg: "RS256",
          },
        } as any);

        const context = await authManager.createAuthContext("Bearer valid-jwt-token");

        expect(context).toEqual({
          authenticated: true,
          scopes: new Set(["*"]),
          subject: "user123",
        });

        // Verify JWT verification was called with correct parameters
        expect(mockJwtVerify).toHaveBeenCalledWith(
          "valid-jwt-token",
          {},
          {
            issuer: "https://auth.example.com",
            audience: "https://mcp.example.com",
          },
        );
      });

      it("should return unauthenticated context for expired/invalid token", async () => {
        // Mock JWT verification failure
        mockJwtVerify.mockRejectedValueOnce(new Error("JWT expired"));

        const context = await authManager.createAuthContext("Bearer invalid-token");

        expect(context).toEqual({
          authenticated: false,
          scopes: new Set(),
        });
      });

      it("should return unauthenticated context for malformed authorization header", async () => {
        const context = await authManager.createAuthContext("Invalid header");

        expect(context).toEqual({
          authenticated: false,
          scopes: new Set(),
        });
      });

      it("should return unauthenticated context when JWT validation fails", async () => {
        // Mock JWT verification failure due to invalid signature
        mockJwtVerify.mockRejectedValueOnce(new Error("Invalid signature"));

        const context = await authManager.createAuthContext("Bearer invalid-jwt");

        expect(context).toEqual({
          authenticated: false,
          scopes: new Set(),
        });
      });

      it("should return unauthenticated context when JWT payload missing subject", async () => {
        // Mock JWT verification with payload missing 'sub' field
        mockJwtVerify.mockResolvedValueOnce({
          payload: {
            aud: "https://mcp.example.com",
            iss: "https://auth.example.com",
            exp: Math.floor(Date.now() / 1000) + 3600,
            email: "user@example.com",
            name: "Test User",
            // Missing 'sub' field
          },
          protectedHeader: {
            alg: "RS256",
          },
        } as any);

        const context = await authManager.createAuthContext("Bearer token-without-sub");

        expect(context).toEqual({
          authenticated: false,
          scopes: new Set(),
        });
      });

      it("should fall back to userinfo validation when JWT validation fails", async () => {
        // Mock JWT verification failure (opaque token that can't be parsed as JWT)
        mockJwtVerify.mockRejectedValueOnce(new Error("Invalid Compact JWS"));

        // Mock successful userinfo response as fallback using MSW
        server.use(
          http.get("https://auth.example.com/oauth/userinfo", () => {
            return HttpResponse.json({
              sub: "user456",
              email: "user@example.com",
              name: "Test User",
            });
          }),
        );

        const context = await authManager.createAuthContext(
          "Bearer oat_opaque_token_123",
        );

        expect(context).toEqual({
          authenticated: true,
          scopes: new Set(["*"]),
          subject: "user456",
        });

        // Verify JWT verification was attempted first
        expect(mockJwtVerify).toHaveBeenCalledWith(
          "oat_opaque_token_123",
          {},
          {
            issuer: "https://auth.example.com",
            audience: "https://mcp.example.com",
          },
        );
      });

      it("should fail when both JWT and userinfo validation fail", async () => {
        // Mock JWT verification failure
        mockJwtVerify.mockRejectedValueOnce(new Error("Invalid Compact JWS"));

        // Mock userinfo endpoint failure using MSW
        server.use(
          http.get("https://auth.example.com/oauth/userinfo", () => {
            return new HttpResponse(null, { status: 401 });
          }),
        );

        const context = await authManager.createAuthContext("Bearer invalid_token");

        expect(context).toEqual({
          authenticated: false,
          scopes: new Set(),
        });

        // Verify JWT verification was attempted
        expect(mockJwtVerify).toHaveBeenCalled();
      });

      it("should fall back to userinfo when userinfo endpoint is missing in JWT scenario", async () => {
        // Mock JWT verification failure
        mockJwtVerify.mockRejectedValueOnce(new Error("Invalid Compact JWS"));

        // Override to return discovery without userinfo endpoint
        server.use(
          http.get(
            "https://auth.example.com/.well-known/oauth-authorization-server",
            () => {
              return HttpResponse.json({
                authorization_endpoint: "https://auth.example.com/oauth/authorize",
                token_endpoint: "https://auth.example.com/oauth/token",
                jwks_uri: "https://auth.example.com/.well-known/jwks.json",
                // No userinfo_endpoint
              });
            },
          ),
        );

        const context = await authManager.createAuthContext("Bearer some_token");

        expect(context).toEqual({
          authenticated: false,
          scopes: new Set(),
        });
      });
    });
  });
});
