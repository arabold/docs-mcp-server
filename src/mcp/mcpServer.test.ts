/**
 * Tests for MCP server read-only mode functionality
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { telemetry } from "../telemetry";
import type { AppConfig } from "../utils/config";
import { createMcpServerInstance } from "./mcpServer";
import type { McpServerTools } from "./tools";

vi.mock("../telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../telemetry")>()),
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
  listPages: {
    execute: vi.fn(async () => ({
      library: "test",
      version: "",
      total: 0,
      pages: [],
      limit: 50,
      offset: 0,
      hasMore: false,
    })),
  } as any,
  readPage: {
    execute: vi.fn(async () => ({
      url: "https://example.com",
      title: "Test",
      content: "# Test",
      contentType: "text/markdown",
      charCount: 6,
      chunksCount: 1,
      truncated: false,
    })),
  } as any,
  compactStore: {
    execute: vi.fn(async () => ({
      skipped: false,
      vacuumed: true,
      beforeBytes: 1000,
      afterBytes: 500,
      reclaimedBytes: 500,
    })),
  } as any,
};

describe("MCP Server Read-Only Mode", () => {
  it("should create server instance in normal mode", () => {
    const server = createMcpServerInstance(mockTools, mockConfig);
    expect(server).toBeInstanceOf(McpServer);
  });

  it("should create server instance in read-only mode", () => {
    const server = createMcpServerInstance(mockTools, mockReadOnlyConfig);
    expect(server).toBeInstanceOf(McpServer);
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

  it("should register read_page and list_pages in both normal and read-only mode", () => {
    const normalServer = createMcpServerInstance(mockTools, mockConfig);
    const readOnlyServer = createMcpServerInstance(mockTools, mockReadOnlyConfig);

    expect((normalServer as any)._registeredTools.read_page).toBeDefined();
    expect((normalServer as any)._registeredTools.list_pages).toBeDefined();

    expect((readOnlyServer as any)._registeredTools.read_page).toBeDefined();
    expect((readOnlyServer as any)._registeredTools.list_pages).toBeDefined();
  });

  it("should register compact_store in normal mode and omit in read-only mode", () => {
    const normalServer = createMcpServerInstance(mockTools, mockConfig);
    const readOnlyServer = createMcpServerInstance(mockTools, mockReadOnlyConfig);

    expect((normalServer as any)._registeredTools.compact_store).toBeDefined();
    expect((readOnlyServer as any)._registeredTools.compact_store).toBeUndefined();
  });

  it("should handle read_page tool execution and format source header", async () => {
    const server = createMcpServerInstance(mockTools, mockConfig);
    const readPageTool = (server as any)._registeredTools.read_page;

    expect(readPageTool).toBeDefined();

    const response = await readPageTool.handler({
      library: "react",
      pathOrUrl: "/reference/react",
      version: "19.0.0",
    });

    expect(mockTools.readPage.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        library: "react",
        pathOrUrl: "/reference/react",
        version: "19.0.0",
      }),
    );
    expect(response.content[0].text).toContain("> Source: https://example.com");
    expect(response.content[0].text).toContain("# Test");
  });

  it("should not send read_page URLs or paths to telemetry", async () => {
    vi.mocked(telemetry.track).mockClear();
    const server = createMcpServerInstance(mockTools, mockConfig);
    const readPageTool = (server as any)._registeredTools.read_page;
    const secretUrl = "file:///private/documents/secret.md#token";

    await readPageTool.handler({ library: "react", pathOrUrl: secretUrl });

    const event = vi
      .mocked(telemetry.track)
      .mock.calls.find(([, data]) => data?.tool === "read_page");
    expect(event).toBeDefined();
    expect(JSON.stringify(event)).not.toContain("secret");
    expect(JSON.stringify(event)).not.toContain("file://");
    expect(mockTools.readPage.execute).toHaveBeenCalledWith(
      expect.objectContaining({ pathOrUrl: secretUrl }),
    );
  });

  it("should not send list_pages prefixes to telemetry", async () => {
    vi.mocked(telemetry.track).mockClear();
    const server = createMcpServerInstance(mockTools, mockConfig);
    const listPagesTool = (server as any)._registeredTools.list_pages;
    const prefix = "/private/secret/path";

    await listPagesTool.handler({ library: "react", prefix });

    const event = vi
      .mocked(telemetry.track)
      .mock.calls.find(([, data]) => data?.tool === "list_pages");
    expect(event).toBeDefined();
    expect(JSON.stringify(event)).not.toContain("secret");
    expect(mockTools.listPages.execute).toHaveBeenCalledWith(
      expect.objectContaining({ prefix }),
    );
  });

  it("should describe the supported search limit of 100", () => {
    const server = createMcpServerInstance(mockTools, mockConfig);
    const schema = (server as any)._registeredTools.search_docs.inputSchema;

    expect(schema.shape.limit.description).toContain("max 100");
    expect(schema.parse({ library: "react", query: "useEffect", limit: 100 }).limit).toBe(
      100,
    );
  });

  it("should handle list_pages tool execution and format links with depth", async () => {
    (mockTools.listPages.execute as any).mockResolvedValueOnce({
      library: "react",
      version: "19.0.0",
      total: 1,
      pages: [{ url: "https://example.com/docs", title: "[Beta] Guide", depth: 1 }],
      limit: 50,
      offset: 0,
      hasMore: false,
    });

    const server = createMcpServerInstance(mockTools, mockConfig);
    const listPagesTool = (server as any)._registeredTools.list_pages;

    expect(listPagesTool).toBeDefined();

    const response = await listPagesTool.handler({
      library: "react",
      version: "19.0.0",
    });

    expect(mockTools.listPages.execute).toHaveBeenCalled();
    expect(response.content[0].text).toContain("Indexed pages for react@19.0.0");
    expect(response.content[0].text).toContain("\\[Beta\\] Guide");
  });

  it("should handle compact_store tool execution and format memory stats", async () => {
    const server = createMcpServerInstance(mockTools, mockConfig);
    const compactTool = (server as any)._registeredTools.compact_store;

    expect(compactTool).toBeDefined();

    const response = await compactTool.handler({ force: true, vacuum: true });

    expect(mockTools.compactStore.execute).toHaveBeenCalledWith({
      force: true,
      vacuum: true,
    });
    expect(response.content[0].text).toContain("Database compacted successfully");
    expect(response.content[0].text).toContain("VACUUM executed: yes");
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
