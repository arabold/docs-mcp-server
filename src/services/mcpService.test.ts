/**
 * Behavior tests for the MCP endpoint: request-check order, protocol revision,
 * browser origins and CORS, and issuer outages. Also covers the deprecated
 * HTTP+SSE transport served while authentication is off. The challenge and
 * token checks over HTTP are in test/auth-e2e.test.ts.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type AuthInfo,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripBasePath } from "../app/basePath";
import { createOriginPolicy } from "../app/originPolicy";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import type { AppConfig } from "../utils/config";
import { logger } from "../utils/logger";
import { LEGACY_SSE_MAX_SESSIONS, registerMcpService } from "./mcpService";

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
  server: { name: "docs-mcp-server", heartbeatMs: 30_000 },
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

const MCP_TOKEN = "dmcp_test_access_token_for_service_requests";
const revoked = new Set<string>();
const tokenRecord = (token: string) => ({
  id: token === MCP_TOKEN ? 1 : 2,
  token,
  comment: token === MCP_TOKEN ? "Alice" : "Bob",
  createdAt: "2026-01-01T00:00:00Z",
  lastUsedAt: null,
});
const documents = {
  validateMcpToken: async (token: string) =>
    !revoked.has(token) && [MCP_TOKEN, "other-token"].includes(token)
      ? tokenRecord(token)
      : null,
  touchMcpToken: async () => {},
  recordMcpToolCall: async () => {},
} as unknown as IDocumentManagement;

beforeEach(() => {
  revoked.clear();
});

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
      authorization: `Bearer ${MCP_TOKEN}`,
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
      authorization: `Bearer ${MCP_TOKEN}`,
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

async function startServer(options: { withAuth?: boolean; config?: AppConfig } = {}) {
  // Strips the base path the way AppServer does, so URLs match production.
  server = Fastify({
    logger: false,
    rewriteUrl: (request) => stripBasePath(request.url ?? "/", BASE_PATH),
  });
  await registerMcpService(
    server,
    {
      docService: documents,
      pipeline: {} as IPipeline,
      config: options.config ?? config,
      originPolicy: createOriginPolicy({
        publicOrigin: "https://example.com",
        allowedOrigins: ["https://inspector.example.com"],
      }),
      location: {
        configured: true,
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

/** Listen on a free loopback port and return the base URL. */
async function listen(app: FastifyInstance): Promise<string> {
  return await app.listen({ port: 0, host: "127.0.0.1" });
}

/** Opens `/docs/sse` and returns the stream plus the message URL from its `endpoint` event. */
async function openSseStream(baseUrl: string) {
  const abort = new AbortController();
  const response = await fetch(`${baseUrl}${BASE_PATH}/sse`, {
    headers: { accept: "text/event-stream", authorization: `Bearer ${MCP_TOKEN}` },
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

  it("answers GET and DELETE with 405 and Allow: POST", async () => {
    const app = await startServer();

    for (const method of ["GET", "DELETE"] as const) {
      const response = await app.inject({ method, url: "/mcp" });

      expect.soft(response.statusCode, method).toBe(405);
      expect.soft(response.headers.allow, method).toBe("POST");
    }
  });

  it("marks event-stream responses on both transports as unbuffered for proxies", async () => {
    const baseUrl = await listen(await startServer());
    const abort = new AbortController();
    const legacyStream = await openSseStream(baseUrl);
    legacyStream.close();

    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      signal: abort.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "subscriptions/listen",
        authorization: `Bearer ${MCP_TOKEN}`,
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
    expect(legacyStream.response.headers.get("content-type")).toBe("text/event-stream");
    expect(legacyStream.response.headers.get("x-accel-buffering")).toBe("no");
  });
});

describe("MCP endpoint browser origins", () => {
  it("processes requests without an Origin or from an allowed one, and lets the page read them", async () => {
    const app = await startServer();
    const origins = [
      undefined,
      "http://localhost:6274",
      "https://example.com",
      "https://inspector.example.com",
    ];

    for (const origin of origins) {
      const label = origin ?? "no Origin";
      const response = await app.inject(
        modernRequest("tools/list", origin ? { origin } : {}),
      );

      expect.soft(response.statusCode, label).toBe(200);
      expect.soft(response.headers["access-control-allow-origin"], label).toBe(origin);
      if (origin) expect.soft(response.headers.vary, label).toContain("Origin");
    }
  });

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
  it("rejects MCP requests without a database access token", async () => {
    // arrange
    const app = await startServer();

    // act
    const response = await app.inject(modernRequest("tools/list", { authorization: "" }));

    // assert
    expect(response.statusCode).toBe(401);
  });

  it("rejects a token supplied only in the URL", async () => {
    // arrange
    const app = await startServer();

    // act
    const response = await app.inject({
      ...modernRequest("tools/list", { authorization: "" }),
      url: `/mcp?token=${MCP_TOKEN}`,
    });

    // assert
    expect(response.statusCode).toBe(401);
  });

  it("rejects an invalid database access token", async () => {
    // arrange
    const app = await startServer();

    // act
    const response = await app.inject(
      modernRequest("tools/list", { authorization: "Bearer invalid" }),
    );

    // assert
    expect(response.statusCode).toBe(401);
  });

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

  it("answers an issuer outage with a server error, not a token rejection", async () => {
    const app = await startServer({ withAuth: true });

    const response = await app.inject(
      modernRequest("tools/list", { authorization: "Bearer outage" }),
    );

    expect(response.statusCode).toBeGreaterThanOrEqual(500);
    expect(response.headers["www-authenticate"] ?? "").not.toContain("invalid_token");
  });
});

describe("Deprecated HTTP+SSE transport", () => {
  it.each([
    { name: "a missing token", token: "", revoke: false, status: 401 },
    { name: "a revoked token", token: MCP_TOKEN, revoke: true, status: 401 },
    { name: "another caller's token", token: "other-token", revoke: false, status: 403 },
  ])("rejects SSE messages with $name", async ({ token, revoke, status }) => {
    // arrange
    const baseUrl = await listen(await startServer());
    const stream = await openSseStream(baseUrl);
    if (revoke) revoked.add(MCP_TOKEN);
    try {
      // act
      const response = await fetch(new URL(stream.endpoint, baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });

      // assert
      expect(response.status).toBe(status);
    } finally {
      stream.close();
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

  it("rejects the stream and its messages from a foreign origin with 403", async () => {
    const app = await startServer();

    for (const [method, path] of [
      ["GET", "/sse"],
      ["POST", "/messages?sessionId=abc"],
    ] as const) {
      const response = await app.inject({
        method,
        url: `${BASE_PATH}${path}`,
        headers: {
          origin: "https://attacker.example",
          "content-type": "application/json",
        },
        payload:
          method === "POST" ? { jsonrpc: "2.0", id: 1, method: "ping" } : undefined,
      });

      expect.soft(response.statusCode, `${method} ${path}`).toBe(403);
    }
  });

  it("refuses streams beyond the cap with 503", async () => {
    const baseUrl = await listen(await startServer());
    const streams = await Promise.all(
      Array.from({ length: LEGACY_SSE_MAX_SESSIONS }, () => openSseStream(baseUrl)),
    );

    try {
      const response = await fetch(`${baseUrl}${BASE_PATH}/sse`, {
        headers: { authorization: `Bearer ${MCP_TOKEN}` },
      });

      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("30");
    } finally {
      for (const stream of streams) {
        stream.close();
      }
    }
  });

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

describe("Server instructions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-service-instructions-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function withInstructionsFile(instructionsFile: string): AppConfig {
    return { ...config, server: { ...config.server, instructionsFile } } as AppConfig;
  }

  it("reads the instructions file once at startup and sends it with every request", async () => {
    const instructionsFile = path.join(tmpDir, "instructions.md");
    fs.writeFileSync(instructionsFile, "Search acme docs before answering.");
    const app = await startServer({ config: withInstructionsFile(instructionsFile) });
    // Requests after startup no longer need the file.
    fs.rmSync(instructionsFile);

    for (const _request of [1, 2]) {
      const response = await app.inject(legacyInitialize());
      expect(response.body).toContain(
        '"instructions":"Search acme docs before answering."',
      );
    }
  });

  it("fails to register when the instructions file cannot be read", async () => {
    await expect(
      startServer({ config: withInstructionsFile(path.join(tmpDir, "missing.md")) }),
    ).rejects.toThrow(/instructions file/i);
  });
});
