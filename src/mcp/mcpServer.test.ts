/**
 * Tests for MCP server read-only mode functionality
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { telemetry } from "../telemetry";
import type { AppConfig } from "../utils/config";
import { createMcpServerInstance } from "./mcpServer";
import { createReadOnlyMcpServer } from "./readOnlyMcpServer";
import type { McpServerTools } from "./tools";

vi.mock("../telemetry", () => ({
  TelemetryEvent: { TOOL_USED: "tool_used" },
  telemetry: { track: vi.fn() },
}));

// Mock config
const mockConfig = {
  app: { readOnly: false },
  scraper: { maxPages: 100, maxDepth: 3 },
} as unknown as AppConfig;

const mockReadOnlyConfig = {
  app: { readOnly: true },
  scraper: { maxPages: 100, maxDepth: 3 },
} as unknown as AppConfig;

// Mock tools
const mockTools: McpServerTools = {
  listLibraries: {
    execute: vi.fn(async () => ({ libraries: [] })),
  } as any,
  findVersion: {
    execute: vi.fn(async () => "Version found"),
  } as any,
  search: {
    execute: vi.fn(async () => ({ results: [] })),
  } as any,
  fetchUrl: {
    execute: vi.fn(async () => "# Mock content"),
  } as any,
  scrape: {
    execute: vi.fn(async () => ({ jobId: "job-123" })),
  } as any,
  refresh: {
    execute: vi.fn(async () => ({ jobId: "refresh-job-123" })),
  } as any,
  listJobs: {
    execute: vi.fn(async () => ({ jobs: [] })),
  } as any,
  getJobInfo: {
    execute: vi.fn(async () => ({ job: null })),
  } as any,
  cancelJob: {
    execute: vi.fn(async () => ({ success: true, message: "Cancelled" })),
  } as any,
  remove: {
    execute: vi.fn(async () => ({ message: "Removed" })),
  } as any,
};

describe("MCP Server Read-Only Mode", () => {
  it("does not expose the Search Query or raw search failure", async () => {
    const query = "private Search Query";
    const rawFailure = "raw failure with http://private-worker.internal:8080/api";
    vi.mocked(telemetry.track).mockClear();
    vi.mocked(mockTools.search.execute).mockRejectedValueOnce(new Error(rawFailure));
    const server = createMcpServerInstance(mockTools, mockConfig);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "mcp-server-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "search_docs",
      arguments: { library: "lib", query, limit: 5 },
    });

    await client.close();
    await server.close();

    expect(JSON.stringify(vi.mocked(telemetry.track).mock.calls)).not.toContain(query);
    expect(JSON.stringify(result)).not.toContain(rawFailure);
    expect(JSON.stringify(result)).not.toContain("private-worker.internal");
  });

  it("should create server instance in normal mode", () => {
    const server = createMcpServerInstance(mockTools, mockConfig);
    expect(server).toBeInstanceOf(McpServer);
  });

  it("should create server instance in read-only mode", () => {
    const server = createMcpServerInstance(mockTools, mockReadOnlyConfig);
    expect(server).toBeInstanceOf(McpServer);
  });

  it("creates the packaged extension server with exactly three local read tools", async () => {
    const server = createReadOnlyMcpServer(mockTools);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "mcpb-server-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    expect(client.getServerVersion()?.name).toBe("lib-docs");
    const result = await client.listTools();

    await client.close();
    await server.close();

    expect(result.tools.map((tool) => tool.name).sort()).toEqual([
      "find_version",
      "list_libraries",
      "search_docs",
    ]);
    expect(result.tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);
    expect(result.tools.every((tool) => tool.annotations?.openWorldHint === false)).toBe(
      true,
    );
  });

  it("should create server without prompts capability and not fail", () => {
    // This test verifies that the server can be created successfully
    // without advertising prompts capability, which was the root cause
    // of the issue with some MCP clients failing to connect
    const server = createMcpServerInstance(mockTools, mockConfig);
    expect(server).toBeInstanceOf(McpServer);

    // Verify the server has the expected name and can be instantiated
    // This ensures our capability changes don't break server creation
    expect(server).toBeDefined();
  });

  it("should register scrape_docs with preserveHashes support and propagate it", async () => {
    const server = createMcpServerInstance(mockTools, mockConfig);
    const scrapeTool = (server as any)._registeredTools.scrape_docs;

    expect(scrapeTool).toBeDefined();
    expect(scrapeTool.inputSchema).toBeDefined();

    const parsed = scrapeTool.inputSchema.parse({
      url: "https://example.com/#/guide",
      library: "example-lib",
      preserveHashes: true,
    });
    expect(parsed.preserveHashes).toBe(true);

    await scrapeTool.handler({
      url: "https://example.com/#/guide",
      library: "example-lib",
      preserveHashes: true,
    });

    expect(mockTools.scrape.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          preserveHashes: true,
        }),
      }),
    );
  });

  it("should normalize includePatterns/excludePatterns to string arrays", async () => {
    const server = createMcpServerInstance(mockTools, mockConfig);
    const scrapeTool = (server as any)._registeredTools.scrape_docs;

    // Single pattern passed as a string stays whole, commas preserved
    const single = scrapeTool.inputSchema.parse({
      url: "https://example.com",
      library: "example-lib",
      includePatterns: "/\\/v\\d{1,3}\\//",
    });
    expect(single.includePatterns).toEqual(["/\\/v\\d{1,3}\\//"]);

    // Multiple patterns passed as an array are kept as-is
    const multiple = scrapeTool.inputSchema.parse({
      url: "https://example.com",
      library: "example-lib",
      includePatterns: ["/version-v0.3/", "/versioned_docs/version-v0.3/"],
    });
    expect(multiple.includePatterns).toEqual([
      "/version-v0.3/",
      "/versioned_docs/version-v0.3/",
    ]);

    // The handler receives the normalized array and propagates it to the scraper
    const args = scrapeTool.inputSchema.parse({
      url: "https://example.com",
      library: "example-lib",
      includePatterns: "/version-v0.3/, /versioned_docs/version-v0.3/",
      excludePatterns: ["/exclude/"],
    });
    await scrapeTool.handler(args);

    expect(mockTools.scrape.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          includePatterns: ["/version-v0.3/", "/versioned_docs/version-v0.3/"],
          excludePatterns: ["/exclude/"],
        }),
      }),
    );
  });

  it("should split comma-separated pattern strings without breaking regex constructs", () => {
    const server = createMcpServerInstance(mockTools, mockConfig);
    const scrapeTool = (server as any)._registeredTools.scrape_docs;
    const parse = (includePatterns: string) =>
      scrapeTool.inputSchema.parse({
        url: "https://example.com",
        library: "example-lib",
        includePatterns,
      }).includePatterns;

    // Comma inside a regex quantifier is preserved
    expect(parse("/\\/v\\d{1,3}\\//")).toEqual(["/\\/v\\d{1,3}\\//"]);

    // Comma inside glob brace expansion is preserved
    expect(parse("**/*.{js,ts}")).toEqual(["**/*.{js,ts}"]);

    // Comma inside a character class is preserved
    expect(parse("/docs/[a-z,0-9]+/")).toEqual(["/docs/[a-z,0-9]+/"]);

    // Top-level commas split into multiple patterns
    expect(parse("/version-v0.3/, /versioned_docs/version-v0.3/")).toEqual([
      "/version-v0.3/",
      "/versioned_docs/version-v0.3/",
    ]);

    // Escaped commas are treated as literal commas, not separators
    expect(parse("/docs/v1\\,2/")).toEqual(["/docs/v1\\,2/"]);

    // Empty segments are dropped
    expect(parse("/version-v0.3/, , /version-v0.2/")).toEqual([
      "/version-v0.3/",
      "/version-v0.2/",
    ]);
  });
});
