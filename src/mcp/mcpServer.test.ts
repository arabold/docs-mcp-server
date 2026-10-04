/**
 * Tests for MCP server read-only mode functionality
 */
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../utils/config";
import { createMcpServerFactory } from "./mcpServer";
import type { McpServerTools } from "./tools";

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
  it("should create server instance in normal mode", () => {
    const server = createMcpServerFactory(mockTools, mockConfig)();
    expect(server).toBeInstanceOf(McpServer);
  });

  it("should create server instance in read-only mode", () => {
    const server = createMcpServerFactory(mockTools, mockReadOnlyConfig)();
    expect(server).toBeInstanceOf(McpServer);
  });

  it("should create server without prompts capability and not fail", () => {
    // This test verifies that the server can be created successfully
    // without advertising prompts capability, which was the root cause
    // of the issue with some MCP clients failing to connect
    const server = createMcpServerFactory(mockTools, mockConfig)();
    expect(server).toBeInstanceOf(McpServer);

    // Verify the server has the expected name and can be instantiated
    // This ensures our capability changes don't break server creation
    expect(server).toBeDefined();
  });

  it("should register scrape_docs with preserveHashes support and propagate it", async () => {
    const server = createMcpServerFactory(mockTools, mockConfig)();
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
    const server = createMcpServerFactory(mockTools, mockConfig)();
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
    const server = createMcpServerFactory(mockTools, mockConfig)();
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

/**
 * Lists tools the way a 2026-07-28 client sees them: a real `tools/list`
 * request through the SDK's HTTP handler, so the assertions cover the
 * advertised JSON Schema rather than the server's internal registry.
 */
async function listToolsOverTheWire(config: AppConfig) {
  const handler = createMcpHandler(createMcpServerFactory(mockTools, config));
  const response = await handler.fetch(
    new Request("http://127.0.0.1/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/list",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    result: {
      tools: Array<{
        name: string;
        description?: string;
        inputSchema: Record<string, any>;
      }>;
    };
  };
  return body.result.tools;
}

describe("MCP tool advertisement over protocol 2026-07-28", () => {
  it("advertises every tool in normal mode", async () => {
    const tools = await listToolsOverTheWire(mockConfig);

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "cancel_job",
      "fetch_url",
      "find_version",
      "get_job_info",
      "list_jobs",
      "list_libraries",
      "refresh_version",
      "remove_docs",
      "scrape_docs",
      "search_docs",
    ]);
  });

  it("advertises only read tools in read-only mode", async () => {
    const tools = await listToolsOverTheWire(mockReadOnlyConfig);

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "fetch_url",
      "find_version",
      "list_libraries",
      "search_docs",
    ]);
  });

  it("advertises pattern arguments as a string or an array of strings", async () => {
    const tools = await listToolsOverTheWire(mockConfig);
    const scrape = tools.find((tool) => tool.name === "scrape_docs");
    const includePatterns = scrape?.inputSchema.properties.includePatterns;

    expect(includePatterns.anyOf).toEqual([
      { type: "string" },
      { type: "array", items: { type: "string" } },
    ]);
  });

  it("keeps argument descriptions in the advertised schema", async () => {
    const tools = await listToolsOverTheWire(mockConfig);
    const scrape = tools.find((tool) => tool.name === "scrape_docs");
    const search = tools.find((tool) => tool.name === "search_docs");

    expect(scrape?.inputSchema.properties.url.description).toBe(
      "Documentation root URL to scrape.",
    );
    expect(scrape?.inputSchema.properties.includePatterns.description).toMatch(
      /^Patterns for including URLs during scraping/,
    );
    for (const [name, property] of Object.entries(search?.inputSchema.properties ?? {})) {
      expect((property as { description?: string }).description, name).toBeTruthy();
    }
  });
});
