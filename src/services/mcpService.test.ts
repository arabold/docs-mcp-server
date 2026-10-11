/**
 * Tests for MCP service functionality including SSE heartbeat.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpServerInstance, resolveServerInstructions } from "../mcp/mcpServer";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { type AppConfig, loadConfig } from "../utils/config";
import { cleanupMcpService, registerMcpService } from "./mcpService";

// Mock the dependencies
vi.mock("../mcp/tools", () => ({
  initializeTools: vi.fn().mockResolvedValue({
    listLibraries: { execute: vi.fn() },
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

vi.mock("../mcp/mcpServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../mcp/mcpServer")>();
  return {
    createMcpServerInstance: vi.fn().mockReturnValue({
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }),
    resolveServerInstructions: vi.fn(actual.resolveServerInstructions),
  };
});

vi.mock("../telemetry", () => ({
  telemetry: {
    isEnabled: () => false,
  },
}));

describe("MCP Service", () => {
  let server: ReturnType<typeof Fastify>;
  let mockDocService: IDocumentManagement;
  let mockPipeline: IPipeline;
  let appConfig: AppConfig;

  beforeEach(() => {
    vi.useFakeTimers();
    server = Fastify({ logger: false });

    mockDocService = {} as IDocumentManagement;
    mockPipeline = {} as IPipeline;
    appConfig = loadConfig();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await server.close();
    vi.clearAllMocks();
  });

  describe("SSE Heartbeat", () => {
    // Note: Actual heartbeat message verification is done in the E2E test (test/mcp-http-e2e.test.ts)
    // which can observe raw SSE stream data. Unit tests here focus on setup and cleanup.

    it("should cleanup heartbeat intervals on service cleanup", async () => {
      // Register the MCP service
      const mcpServer = await registerMcpService(
        server,
        mockDocService,
        mockPipeline,
        appConfig,
      );

      // Verify the heartbeat intervals map is attached
      const mcpServerWithInternals = mcpServer as unknown as {
        _heartbeatIntervals: Record<string, NodeJS.Timeout>;
      };
      expect(mcpServerWithInternals._heartbeatIntervals).toBeDefined();

      // Cleanup should not throw
      await expect(cleanupMcpService(mcpServer)).resolves.not.toThrow();
    });

    it("should store transport references for cleanup", async () => {
      // Register the MCP service
      const mcpServer = await registerMcpService(
        server,
        mockDocService,
        mockPipeline,
        appConfig,
      );

      // Verify the transports map is attached
      const mcpServerWithInternals = mcpServer as unknown as {
        _sseTransports: Record<string, unknown>;
        _heartbeatIntervals: Record<string, NodeJS.Timeout>;
      };
      expect(mcpServerWithInternals._sseTransports).toBeDefined();
      expect(mcpServerWithInternals._heartbeatIntervals).toBeDefined();

      // Cleanup
      await cleanupMcpService(mcpServer);
    });
  });

  describe("Route Registration", () => {
    it("should register /sse endpoint", async () => {
      const mcpServer = await registerMcpService(
        server,
        mockDocService,
        mockPipeline,
        appConfig,
      );

      // Check that routes are registered (printRoutes uses a tree format)
      const routes = server.printRoutes();
      expect(routes).toContain("sse");

      await cleanupMcpService(mcpServer);
    });

    it("should register /messages endpoint", async () => {
      const mcpServer = await registerMcpService(
        server,
        mockDocService,
        mockPipeline,
        appConfig,
      );

      // Fastify's printRoutes() uses a radix tree format where common prefixes are shared.
      // Routes /messages and /mcp share the "m" prefix, so they appear as:
      //   └── m
      //       ├── essages (POST)
      //       └── cp (POST)
      // We check for "essages" which is the unique suffix for /messages.
      const routes = server.printRoutes();
      expect(routes).toContain("essages");

      await cleanupMcpService(mcpServer);
    });

    it("should register /mcp endpoint", async () => {
      const mcpServer = await registerMcpService(
        server,
        mockDocService,
        mockPipeline,
        appConfig,
      );

      // Fastify's printRoutes() uses a radix tree format where common prefixes are shared.
      // Routes /messages and /mcp share the "m" prefix, so /mcp appears as "cp" in the tree.
      // We check for "cp (POST)" which uniquely identifies the /mcp route.
      const routes = server.printRoutes();
      expect(routes).toContain("cp (POST");

      await cleanupMcpService(mcpServer);
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

    it("reads the instructions file once at startup, not per request", async () => {
      // Fastify's inject() schedules work on real timers.
      vi.useRealTimers();
      const instructionsFile = path.join(tmpDir, "instructions.md");
      fs.writeFileSync(instructionsFile, "Search acme docs before answering.");
      const config = {
        ...appConfig,
        server: { ...appConfig.server, instructionsFile },
      } as AppConfig;

      const mcpServer = await registerMcpService(
        server,
        mockDocService,
        mockPipeline,
        config,
      );
      fs.rmSync(instructionsFile);

      // The per-request server only needs to be created; failing its connect ends the
      // request immediately instead of waiting on a transport the mock never wires up.
      vi.mocked(createMcpServerInstance).mockReturnValueOnce({
        connect: vi.fn().mockRejectedValue(new Error("stop")),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as ReturnType<typeof createMcpServerInstance>);
      await server.inject({ method: "POST", url: "/mcp", payload: {} });

      expect(resolveServerInstructions).toHaveBeenCalledTimes(1);
      const createCalls = vi.mocked(createMcpServerInstance).mock.calls;
      expect(createCalls).toHaveLength(2);
      for (const call of createCalls) {
        expect(call[2]).toBe("Search acme docs before answering.");
      }

      await cleanupMcpService(mcpServer);
    });

    it("fails to register when the instructions cannot be resolved", async () => {
      const config = {
        ...appConfig,
        server: {
          ...appConfig.server,
          instructionsFile: path.join(tmpDir, "missing.md"),
        },
      } as AppConfig;

      await expect(
        registerMcpService(server, mockDocService, mockPipeline, config),
      ).rejects.toThrow(/instructions file/i);
    });
  });
});
