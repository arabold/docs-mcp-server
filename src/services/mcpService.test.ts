/**
 * Behavior tests for the MCP endpoint: request-check order, protocol revision,
 * browser origins and CORS, and the authentication challenge. Also covers the
 * deprecated HTTP+SSE transport served while authentication is off.
 */

import { Client, SSEClientTransport } from "@modelcontextprotocol/client";
import {
  type AuthInfo,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOriginPolicy } from "../app/originPolicy";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import type { AppConfig } from "../utils/config";
import { logger } from "../utils/logger";
import { registerMcpService } from "./mcpService";

vi.mock("../mcp/tools", () => ({
  initializeTools: vi.fn().mockResolvedValue({
    listLibraries: { execute: vi.fn(async () => ({ libraries: [] })) },
    findVersion: { execute: vi.fn() },
    search: { execute: vi.fn() },
    fetchUrl: { execute: vi.fn() },
    scrape: { execute: vi.fn() },
    refresh: { execute: vi.fn() },
    listJobs: { execute: vi.fn() },
    getJobInfo: { execute: vi.fn() },
    cancelJob: { execute: vi.fn() },
    remove: { execute: vi.fn() },
  }),
}));

vi.mock("../telemetry", () => ({
  telemetry: { isEnabled: () => false, track: vi.fn() },
  TelemetryEvent: {},
}));

const config = {
  app: { readOnly: false },
  scraper: { maxPages: 100, maxDepth: 3 },
  server: { heartbeatMs: 30_000 },
} as unknown as AppConfig;

const RESOURCE_METADATA_URL =
  "https://example.com/docs/.well-known/oauth-protected-resource/mcp";

const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(token): Promise<AuthInfo> {
    if (token === "good") {
      return {
        token,
        clientId: "client",
        scopes: [],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };
    }
    if (token === "outage") {
      throw new OAuthError(OAuthErrorCode.ServerError, "Issuer keys unavailable");
    }
    throw new OAuthError(OAuthErrorCode.InvalidToken, "Token rejected");
  },
};

const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
};

function modernRequest(method: string, extraHeaders: Record<string, string> = {}) {
  return {
    method: "POST" as const,
    url: "/mcp",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...extraHeaders,
    },
    payload: { jsonrpc: "2.0", id: 1, method, params: { _meta: META } },
  };
}

function legacyInitialize(extraHeaders: Record<string, string> = {}) {
  return {
    method: "POST" as const,
    url: "/mcp",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...extraHeaders,
    },
    payload: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "legacy", version: "1" },
      },
    },
  };
}

let server: FastifyInstance | undefined;

const BASE_PATH = "/docs";

async function startServer(options: { withAuth?: boolean } = {}) {
  // Strips the base path the way AppServer does, so URLs match production.
  server = Fastify({
    logger: false,
    rewriteUrl: (request) => {
      const url = request.url ?? "/";
      return url.startsWith(`${BASE_PATH}/`) ? url.slice(BASE_PATH.length) : url;
    },
  });
  await registerMcpService(
    server,
    {
      docService: {} as IDocumentManagement,
      pipeline: {} as IPipeline,
      config,
      originPolicy: createOriginPolicy({
        publicHostname: "example.com",
        allowedOrigins: ["https://inspector.example.com"],
      }),
      location: {
        url: `https://example.com${BASE_PATH}`,
        origin: "https://example.com",
        basePath: BASE_PATH,
      },
    },
    options.withAuth
      ? { verifier, resourceMetadataUrl: RESOURCE_METADATA_URL }
      : undefined,
  );
  return server;
}

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

/** Opens `/docs/sse` and returns the stream plus the message URL from its `endpoint` event. */
async function openSseStream(baseUrl: string) {
  const abort = new AbortController();
  const response = await fetch(`${baseUrl}${BASE_PATH}/sse`, {
    headers: { accept: "text/event-stream" },
    signal: abort.signal,
  });
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("SSE response has no body");
  }
  const decoder = new TextDecoder();
  let buffered = "";
  const readUntil = async (pattern: RegExp): Promise<RegExpMatchArray> => {
    for (;;) {
      const match = buffered.match(pattern);
      if (match) {
        buffered = buffered.slice((match.index ?? 0) + match[0].length);
        return match;
      }
      const { value, done } = await reader.read();
      if (done) {
        throw new Error(`SSE stream ended before ${pattern}`);
      }
      buffered += decoder.decode(value, { stream: true });
    }
  };
  const [, endpoint] = await readUntil(/event: endpoint\ndata: (.+)\n\n/);
  return { response, endpoint, readUntil, close: () => abort.abort() };
}

afterEach(async () => {
  vi.useRealTimers();
  await server?.close();
  server = undefined;
});

describe("MCP endpoint protocol", () => {
  it("answers a current-revision tools/list", async () => {
    const app = await startServer();

    const response = await app.inject(modernRequest("tools/list"));

    expect(response.statusCode).toBe(200);
    expect(
      response.json().result.tools.map((tool: { name: string }) => tool.name),
    ).toContain("search_docs");
  });

  it("lists 2026-07-28 as the only supported revision in server/discover", async () => {
    const app = await startServer();

    const response = await app.inject(modernRequest("server/discover"));

    expect(response.statusCode).toBe(200);
    expect(response.json().result.supportedVersions).toEqual(["2026-07-28"]);
  });

  it("answers a handshake-era initialize statelessly, without a session", async () => {
    const app = await startServer();

    const response = await app.inject(legacyInitialize());

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"protocolVersion":"2025-06-18"');
    expect(response.headers["mcp-session-id"]).toBeUndefined();
  });

  it.each(["GET", "DELETE"] as const)(
    "answers %s with 405 and Allow: POST",
    async (method) => {
      const app = await startServer();

      const response = await app.inject({ method, url: "/mcp" });

      expect(response.statusCode).toBe(405);
      expect(response.headers.allow).toBe("POST");
    },
  );

  it("marks event-stream responses as unbuffered for proxies", async () => {
    const app = await startServer();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const abort = new AbortController();

    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      signal: abort.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "subscriptions/listen",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "subscriptions/listen",
        params: { notifications: { toolsListChanged: true }, _meta: META },
      }),
    });
    abort.abort();

    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
  });
});

describe("MCP endpoint browser origins", () => {
  it("processes requests without an Origin header", async () => {
    const app = await startServer();

    const response = await app.inject(modernRequest("tools/list"));

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it.each([
    "http://localhost:6274",
    "https://example.com",
    "https://inspector.example.com",
  ])(
    "processes requests from allowed origin %s and lets the page read them",
    async (origin) => {
      const app = await startServer();

      const response = await app.inject(modernRequest("tools/list", { origin }));

      expect(response.statusCode).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
      expect(response.headers.vary).toContain("Origin");
    },
  );

  it("rejects a foreign origin with 403 even when the token is valid", async () => {
    const app = await startServer({ withAuth: true });

    const response = await app.inject(
      modernRequest("tools/list", {
        origin: "https://attacker.example",
        authorization: "Bearer good",
      }),
    );

    expect(response.statusCode).toBe(403);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers a preflight from an allowed origin without a token", async () => {
    const app = await startServer({ withAuth: true });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/mcp",
      headers: {
        origin: "http://localhost:6274",
        "access-control-request-method": "POST",
        "access-control-request-headers":
          "authorization, content-type, mcp-protocol-version",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:6274");
    expect(response.headers["access-control-allow-methods"]).toBe("POST");
    expect(response.headers["access-control-allow-headers"]).toBe(
      "authorization, content-type, mcp-protocol-version",
    );
  });

  it("rejects a preflight from a foreign origin", async () => {
    const app = await startServer();

    const response = await app.inject({
      method: "OPTIONS",
      url: "/mcp",
      headers: {
        origin: "https://attacker.example",
        "access-control-request-method": "POST",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("MCP endpoint authentication", () => {
  it("checks the method before authentication", async () => {
    const app = await startServer({ withAuth: true });

    const response = await app.inject({ method: "GET", url: "/mcp" });

    expect(response.statusCode).toBe(405);
  });

  it("authenticates before protocol processing", async () => {
    const app = await startServer({ withAuth: true });

    const response = await app.inject(legacyInitialize());

    expect(response.statusCode).toBe(401);
  });

  it("challenges a request without a token with resource_metadata and no error code", async () => {
    const app = await startServer({ withAuth: true });

    const response = await app.inject(modernRequest("tools/list"));

    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toBe(
      `Bearer resource_metadata="${RESOURCE_METADATA_URL}"`,
    );
  });

  it("makes the challenge readable by a page on an allowed origin", async () => {
    const app = await startServer({ withAuth: true });

    const response = await app.inject(
      modernRequest("tools/list", { origin: "http://localhost:6274" }),
    );

    expect(response.statusCode).toBe(401);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:6274");
    expect(response.headers["access-control-expose-headers"]).toContain(
      "WWW-Authenticate",
    );
  });

  it("challenges a rejected token with invalid_token and resource_metadata", async () => {
    const app = await startServer({ withAuth: true });

    const response = await app.inject(
      modernRequest("tools/list", { authorization: "Bearer bad" }),
    );

    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toContain('error="invalid_token"');
    expect(response.headers["www-authenticate"]).toContain(
      `resource_metadata="${RESOURCE_METADATA_URL}"`,
    );
  });

  it("answers an issuer outage with a server error, not a token rejection", async () => {
    const app = await startServer({ withAuth: true });

    const response = await app.inject(
      modernRequest("tools/list", { authorization: "Bearer outage" }),
    );

    expect(response.statusCode).toBeGreaterThanOrEqual(500);
    expect(response.headers["www-authenticate"] ?? "").not.toContain("invalid_token");
  });

  it("processes a request carrying a valid token", async () => {
    const app = await startServer({ withAuth: true });

    const response = await app.inject(
      modernRequest("tools/list", { authorization: "Bearer good" }),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().result.tools.length).toBeGreaterThan(0);
  });
});

describe("Deprecated HTTP+SSE transport", () => {
  it("names a message URL under the base path in the endpoint event", async () => {
    const baseUrl = await listen(await startServer());

    const stream = await openSseStream(baseUrl);
    stream.close();

    expect(stream.response.headers.get("content-type")).toBe("text/event-stream");
    expect(stream.response.headers.get("x-accel-buffering")).toBe("no");
    expect(stream.endpoint).toMatch(/^\/docs\/messages\?sessionId=[\w-]+$/);
  });

  it("serves a handshake-era client end to end", async () => {
    const baseUrl = await listen(await startServer());
    const client = new Client({ name: "legacy-sse", version: "1.0.0" });

    await client.connect(new SSEClientTransport(new URL(`${baseUrl}${BASE_PATH}/sse`)));
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("search_docs");
    } finally {
      await client.close();
    }
  });

  it("answers a message for an unknown session with 404", async () => {
    const app = await startServer();

    const response = await app.inject({
      method: "POST",
      url: `${BASE_PATH}/messages?sessionId=unknown`,
      headers: { "content-type": "application/json" },
      payload: { jsonrpc: "2.0", id: 1, method: "ping" },
    });

    expect(response.statusCode).toBe(404);
  });

  it.each([
    ["GET", "/sse"],
    ["POST", "/messages?sessionId=abc"],
  ] as const)("rejects %s %s from a foreign origin with 403", async (method, path) => {
    const app = await startServer();

    const response = await app.inject({
      method,
      url: `${BASE_PATH}${path}`,
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      payload: method === "POST" ? { jsonrpc: "2.0", id: 1, method: "ping" } : undefined,
    });

    expect(response.statusCode).toBe(403);
  });

  it.each([
    ["GET", "/sse"],
    ["POST", "/messages?sessionId=abc"],
  ] as const)(
    "does not serve %s %s with authentication enabled",
    async (method, path) => {
      const app = await startServer({ withAuth: true });

      const response = await app.inject({
        method,
        url: `${BASE_PATH}${path}`,
        headers: { "content-type": "application/json" },
        payload:
          method === "POST" ? { jsonrpc: "2.0", id: 1, method: "ping" } : undefined,
      });

      expect(response.statusCode).toBe(404);
    },
  );

  it("sends keep-alive comments on an idle stream", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const baseUrl = await listen(await startServer());
    const stream = await openSseStream(baseUrl);

    vi.advanceTimersByTime(config.server.heartbeatMs);
    const [comment] = await stream.readUntil(/: keepalive\n\n/);
    stream.close();

    expect(comment).toBe(": keepalive\n\n");
  });

  it("warns once that the transport is deprecated, naming the MCP endpoint", async () => {
    const warn = vi.mocked(logger.warn);
    warn.mockClear();
    const baseUrl = await listen(await startServer());

    const first = await openSseStream(baseUrl);
    const second = await openSseStream(baseUrl);
    first.close();
    second.close();

    const deprecations = warn.mock.calls.filter(([message]) =>
      String(message).includes("deprecated HTTP+SSE"),
    );
    expect(deprecations).toHaveLength(1);
    expect(String(deprecations[0][0])).toContain("https://example.com/docs/mcp");
  });
});
