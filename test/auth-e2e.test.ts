/**
 * End-to-end tests for authentication on the MCP endpoint.
 *
 * Runs the real server against a local OAuth authorization server (a `jose`
 * key pair with RFC 8414 metadata and a JWKS), so the suite needs no external
 * provider. The server is hosted under a base path, which is where discovery
 * URLs are easiest to get wrong.
 *
 * An optional block checks discovery against a real provider when
 * `DOCS_MCP_AUTH_ISSUER_URL` is set.
 */

import { config as loadDotenv } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JwtAccessTokenVerifier } from "../src/auth/JwtAccessTokenVerifier";
import { LogLevel, setLogLevel } from "../src/utils/logger";
import { startInProcessServer } from "./in-process-server";
import {
  getFreePort,
  type LocalIssuer,
  requestWithHost,
  startLocalIssuer,
} from "./test-helpers";

loadDotenv();

const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
};

describe("Authentication End-to-End", () => {
  let issuer: LocalIssuer;
  let server: Awaited<ReturnType<typeof startInProcessServer>> | undefined;
  let origin = "";
  let publicUrl = "";
  let audience = "";

  function mcpRequest(authorization?: string) {
    return fetch(`${publicUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/list",
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: META } }),
    });
  }

  beforeAll(async () => {
    setLogLevel(LogLevel.ERROR);
    issuer = await startLocalIssuer();

    const port = await getFreePort();
    origin = `http://127.0.0.1:${port}`;
    publicUrl = `${origin}/docs`;
    audience = `${publicUrl}/mcp`;
    server = await startInProcessServer({
      port,
      publicUrl,
      issuerUrl: issuer.url,
      enableWebInterface: false,
    });
  }, 30000);

  afterAll(async () => {
    await server?.stop();
    await issuer?.close();
  });

  describe("discovery", () => {
    it("challenges a request without a token, pointing at the metadata under the base path", async () => {
      const response = await mcpRequest();

      expect(response.status).toBe(401);
      const challenge = response.headers.get("www-authenticate") ?? "";
      expect(challenge).toBe(
        `Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource/mcp"`,
      );
      expect(challenge).not.toContain("error=");
    });

    it.each([
      ["the advertised location", "/docs/.well-known/oauth-protected-resource/mcp"],
      ["the RFC 9728 host-root location", "/.well-known/oauth-protected-resource/docs/mcp"],
    ])("serves the protected resource metadata at %s", async (_label, pathname) => {
      const response = await fetch(`${origin}${pathname}`);

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(await response.json()).toMatchObject({
        resource: audience,
        authorization_servers: [issuer.url],
        bearer_methods_supported: ["header"],
      });
    });

    it("serves no metadata document at the root well-known location", async () => {
      const response = await fetch(`${origin}/.well-known/oauth-protected-resource`);

      expect(response.status).toBe(404);
    });

    it("never takes the metadata from the Host header", async () => {
      // An IP literal passes the host check, so this reaches the metadata route
      // with a Host that differs from the public URL.
      const { body } = await requestWithHost(
        `${origin}/docs/.well-known/oauth-protected-resource/mcp`,
        "10.9.8.7:6280",
      );

      expect(JSON.parse(body).resource).toBe(audience);
      expect(body).not.toContain("10.9.8.7");
    });
  });

  describe("token acceptance", () => {
    it("accepts a token issued for the MCP endpoint", async () => {
      const response = await mcpRequest(`Bearer ${await issuer.mint({ aud: audience })}`);

      expect(response.status).toBe(200);
      expect((await response.json()).result.tools.length).toBeGreaterThan(0);
    });

    it("serves a handshake-era client that presents a valid token", async () => {
      const response = await fetch(`${publicUrl}/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${await issuer.mint({ aud: audience })}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "legacy", version: "1" },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('"protocolVersion":"2025-06-18"');
    });

    it.each([
      ["issued for another resource", { aud: "https://other.example/mcp" }],
      ["from another issuer", { iss: "https://other-issuer.example" }],
      ["expired", { exp: Math.floor(Date.now() / 1000) - 60 }],
    ])("rejects a token %s", async (_label, claims) => {
      const token = await issuer.mint({ aud: audience, ...claims });

      const response = await mcpRequest(`Bearer ${token}`);

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
    });

    it("rejects a token signed with a key the issuer does not publish", async () => {
      const token = await issuer.mint({ aud: audience }, issuer.foreignKeys);

      const response = await mcpRequest(`Bearer ${token}`);

      expect(response.status).toBe(401);
    });

    it("rejects an opaque token", async () => {
      const response = await mcpRequest("Bearer oat_opaqueTokenTheIssuerWouldAccept");

      expect(response.status).toBe(401);
    });
  });

  describe("boundary", () => {
    it("leaves the HTTP API reachable without a token", async () => {
      const response = await fetch(`${publicUrl}/api/ping`);

      expect(response.status).toBe(200);
    });

    it.each([
      ["GET", "/sse"],
      ["POST", "/messages?sessionId=abc"],
    ])("does not serve the deprecated SSE transport at %s %s", async (method, path) => {
      const response = await fetch(`${publicUrl}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) : undefined,
      });

      expect(response.status).toBe(404);
      expect(response.headers.get("content-type") ?? "").not.toContain("text/html");
    });
  });
});

describe.skipIf(!process.env.DOCS_MCP_AUTH_ISSUER_URL)("Live identity provider", () => {
  it("discovers the configured provider's metadata and signing keys", async () => {
    const issuerUrl = process.env.DOCS_MCP_AUTH_ISSUER_URL ?? "";
    const publicUrl = process.env.DOCS_MCP_SERVER_PUBLIC_URL ?? "https://example.com";

    await expect(
      JwtAccessTokenVerifier.create({
        issuerUrl,
        audience: process.env.DOCS_MCP_AUTH_AUDIENCE || `${publicUrl}/mcp`,
      }),
    ).resolves.toBeInstanceOf(JwtAccessTokenVerifier);
  });
});
