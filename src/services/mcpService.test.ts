/**
 * Tests for MCP service functionality including SSE heartbeat.
 */

import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("../mcp/mcpServer", () => ({
  createMcpServerInstance: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../telemetry", () => ({
  telemetry: {
    isEnabled: () => false,
  },
}));

vi.mock("../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
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
});
