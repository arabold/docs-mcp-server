/**
 * Unit tests for authentication middleware with ProxyAuthManager.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthMiddleware } from "./middleware";
import { ProxyAuthManager } from "./ProxyAuthManager";
import type { AuthConfig, AuthContext } from "./types";

// Extend FastifyRequest to include our auth property
interface AuthenticatedRequest extends FastifyRequest {
  auth?: AuthContext;
}

describe("Authentication Middleware", () => {
  let mockManager: ProxyAuthManager;
  let mockRequest: Partial<AuthenticatedRequest>;
  let mockReply: Partial<FastifyReply>;

  beforeEach(() => {
    const authConfig: AuthConfig = {
      enabled: true,
      issuerUrl: "https://example.com/oauth2",
      audience: "https://api.example.com",
      scopes: [],
    };

    mockManager = new ProxyAuthManager(authConfig);

    mockRequest = {
      headers: {
        host: "localhost:3000",
      },
      auth: undefined,
      url: "/mcp",
      protocol: "http",
    };

    mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    };

    vi.clearAllMocks();
  });

  describe("createAuthMiddleware", () => {
    it("should skip auth when manager is disabled", async () => {
      const disabledConfig: AuthConfig = { enabled: false, scopes: [] };
      const disabledManager = new ProxyAuthManager(disabledConfig);
      const middleware = createAuthMiddleware(disabledManager);

      // Mock the createAuthContext method for disabled auth
      vi.spyOn(disabledManager, "createAuthContext").mockResolvedValue({
        authenticated: false,
        scopes: new Set(["*"]),
      });

      await middleware(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

      expect(mockRequest.auth).toEqual({
        authenticated: false,
        scopes: new Set(["*"]),
      });
      expect(mockReply.status).not.toHaveBeenCalled();
    });

    it("should return 401 when no authorization header", async () => {
      const middleware = createAuthMiddleware(mockManager);

      await middleware(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

      expect(mockReply.status).toHaveBeenCalledWith(401);
      expect(mockReply.header).toHaveBeenCalledWith(
        "WWW-Authenticate",
        expect.stringContaining("Bearer"),
      );
    });

    it("should authenticate valid token", async () => {
      mockRequest.headers = {
        authorization: "Bearer valid-token",
        host: "localhost:3000",
      };

      // Mock successful authentication
      vi.spyOn(mockManager, "createAuthContext").mockResolvedValue({
        authenticated: true,
        scopes: new Set(["*"]),
        subject: "test-user",
      });

      const middleware = createAuthMiddleware(mockManager);
      await middleware(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

      expect(mockRequest.auth).toEqual({
        authenticated: true,
        scopes: new Set(["*"]),
        subject: "test-user",
      });
      expect(mockReply.status).not.toHaveBeenCalled();
    });

    it("should return 401 for invalid token", async () => {
      mockRequest.headers = {
        authorization: "Bearer invalid-token",
        host: "localhost:3000",
      };

      // Mock authentication failure
      vi.spyOn(mockManager, "createAuthContext").mockRejectedValue(
        new Error("Invalid token"),
      );

      const middleware = createAuthMiddleware(mockManager);
      await middleware(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

      expect(mockReply.status).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "invalid_token",
        error_description: "Token validation failed",
      });
    });

    it("should return 401 for unauthenticated token", async () => {
      mockRequest.headers = {
        authorization: "Bearer expired-token",
        host: "localhost:3000",
      };

      // Mock unauthenticated response
      vi.spyOn(mockManager, "createAuthContext").mockResolvedValue({
        authenticated: false,
        scopes: new Set(),
      });

      const middleware = createAuthMiddleware(mockManager);
      await middleware(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

      expect(mockReply.status).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "invalid_token",
        error_description: "The access token is invalid",
      });
    });
  });
});
