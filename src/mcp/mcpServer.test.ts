/**
 * Tests for the MCP server factory: read-only mode, server identity (name, title,
 * version), and the instructions sent to clients during initialization.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VersionAlreadyExistsError } from "../store/errors";
import { telemetry } from "../telemetry";
import type { AppConfig } from "../utils/config";
import { buildDefaultInstructions } from "./defaultInstructions";
import { createMcpServerInstance, resolveServerInstructions } from "./mcpServer";
import type { McpServerTools } from "./tools";

vi.mock("../telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../telemetry")>()),
  telemetry: { track: vi.fn() },
}));

// Mock config
const mockConfig = {
  app: { readOnly: false },
  server: { name: "docs-mcp-server" },
  scraper: { maxPages: 100, maxDepth: 3 },
} as unknown as AppConfig;

const mockReadOnlyConfig = {
  app: { readOnly: true },
  server: { name: "docs-mcp-server" },
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
      contentType: "text/markdown",
      content: "# Test",
      startChunk: 0,
      totalChunks: 1,
      nextChunk: null,
    })),
  } as any,
};

/** Creates a server the way the entry points do, with instructions resolved from the config. */
function createServer(config: AppConfig): McpServer {
  return createMcpServerInstance(mockTools, config, resolveServerInstructions(config));
}

describe("MCP Server Read-Only Mode", () => {
  it("should create server instance in normal mode", () => {
    const server = createServer(mockConfig);
    expect(server).toBeInstanceOf(McpServer);
  });

  it("should create server instance in read-only mode", () => {
    const server = createServer(mockReadOnlyConfig);
    expect(server).toBeInstanceOf(McpServer);
  });

  it("should create server without prompts capability and not fail", () => {
    // This test verifies that the server can be created successfully
    // without advertising prompts capability, which was the root cause
    // of the issue with some MCP clients failing to connect
    const server = createServer(mockConfig);
    expect(server).toBeInstanceOf(McpServer);

    // Verify the server has the expected name and can be instantiated
    // This ensures our capability changes don't break server creation
    expect(server).toBeDefined();
  });

  it("should register read_page and list_pages in both normal and read-only mode", () => {
    const normalServer = createServer(mockConfig);
    const readOnlyServer = createServer(mockReadOnlyConfig);

    expect((normalServer as any)._registeredTools.read_page).toBeDefined();
    expect((normalServer as any)._registeredTools.list_pages).toBeDefined();

    expect((readOnlyServer as any)._registeredTools.read_page).toBeDefined();
    expect((readOnlyServer as any)._registeredTools.list_pages).toBeDefined();
  });

  it("should handle read_page tool execution and format source header", async () => {
    const server = createServer(mockConfig);
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

  it("should forward startChunk and tell the agent how to continue a long page", async () => {
    (mockTools.readPage.execute as any).mockResolvedValueOnce({
      url: "https://example.com/long",
      title: "Long",
      contentType: "text/markdown",
      content: "part two",
      startChunk: 2,
      totalChunks: 5,
      nextChunk: 4,
    });
    const server = createServer(mockConfig);
    const readPageTool = (server as any)._registeredTools.read_page;

    const response = await readPageTool.handler({
      library: "react",
      pathOrUrl: "/long",
      startChunk: 2,
    });

    expect(mockTools.readPage.execute).toHaveBeenCalledWith(
      expect.objectContaining({ startChunk: 2 }),
    );
    expect(response.content[0].text).toContain("chunks 3-4 of 5");
    expect(response.content[0].text).toContain("startChunk: 4");
  });

  it("should say when startChunk is past the end of the page", async () => {
    (mockTools.readPage.execute as any).mockResolvedValueOnce({
      url: "https://example.com/short",
      title: "Short",
      contentType: "text/markdown",
      content: "",
      startChunk: 9,
      totalChunks: 3,
      nextChunk: null,
    });
    const server = createServer(mockConfig);
    const readPageTool = (server as any)._registeredTools.read_page;

    const response = await readPageTool.handler({
      library: "react",
      pathOrUrl: "/short",
      startChunk: 9,
    });

    expect(response.content[0].text).toContain("past the end");
    expect(response.content[0].text).toContain("3 chunks");
  });

  it("should not send read_page URLs or paths to telemetry", async () => {
    vi.mocked(telemetry.track).mockClear();
    const server = createServer(mockConfig);
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

  it("should not send list_pages URL filters to telemetry", async () => {
    vi.mocked(telemetry.track).mockClear();
    const server = createServer(mockConfig);
    const listPagesTool = (server as any)._registeredTools.list_pages;
    const contains = "/private/secret/path";

    await listPagesTool.handler({ library: "react", contains });

    const event = vi
      .mocked(telemetry.track)
      .mock.calls.find(([, data]) => data?.tool === "list_pages");
    expect(event).toBeDefined();
    expect(JSON.stringify(event)).not.toContain("secret");
    expect(mockTools.listPages.execute).toHaveBeenCalledWith(
      expect.objectContaining({ contains }),
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

    const server = createServer(mockConfig);
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

  it("should register scrape_docs with preserveHashes support and propagate it", async () => {
    const server = createServer(mockConfig);
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
    const server = createServer(mockConfig);
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
    const server = createServer(mockConfig);
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

  it("should pass replace to ScrapeTool and default it to false", async () => {
    const server = createServer(mockConfig);
    const scrapeTool = (server as any)._registeredTools.scrape_docs;

    expect(
      scrapeTool.inputSchema.parse({ url: "https://example.com", library: "lib" })
        .replace,
    ).toBe(false);

    await scrapeTool.handler(
      scrapeTool.inputSchema.parse({
        url: "https://example.com",
        library: "lib",
        replace: true,
      }),
    );

    expect(mockTools.scrape.execute).toHaveBeenCalledWith(
      expect.objectContaining({ replace: true }),
    );
  });

  it("should return an existing-version conflict as a tool error naming the remedy", async () => {
    const server = createServer(mockConfig);
    const scrapeTool = (server as any)._registeredTools.scrape_docs;
    vi.mocked(mockTools.scrape.execute).mockRejectedValueOnce(
      new VersionAlreadyExistsError("React", ""),
    );

    const result = await scrapeTool.handler(
      scrapeTool.inputSchema.parse({ url: "https://example.com", library: "react" }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("replace: true");
  });
});

describe("MCP versions resource", () => {
  const listedLibraries = {
    libraries: [
      { name: "React", versions: [{ version: "19.0.0" }] },
      { name: "@tanstack/query", versions: [{ version: "5.0.0" }] },
    ],
  };

  async function readVersions(uri: string) {
    vi.mocked(mockTools.listLibraries.execute).mockResolvedValue(listedLibraries as any);
    const server = createServer(mockConfig);
    const template = (server as any)._registeredResourceTemplates.versions;
    const variables = template.resourceTemplate.uriTemplate.match(uri);
    const result = await template.readCallback(new URL(uri), variables, {});
    return result.contents.map((c: { text: string }) => c.text);
  }

  it("matches a library name case-insensitively", async () => {
    expect(await readVersions("docs://libraries/react/versions")).toEqual(["19.0.0"]);
  });

  it("decodes a percent-encoded name containing a slash", async () => {
    expect(await readVersions("docs://libraries/%40tanstack%2Fquery/versions")).toEqual([
      "5.0.0",
    ]);
  });
});

/**
 * Connects a real MCP client to the server over an in-memory transport so the
 * initialize handshake can be observed end to end.
 */
async function connectClient(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

describe("MCP Server identity", () => {
  it("reports the configured server name and the package version", async () => {
    const config = {
      ...mockConfig,
      server: { name: "acme-docs" },
    } as unknown as AppConfig;

    const client = await connectClient(createServer(config));

    expect(client.getServerVersion()).toEqual({
      name: "acme-docs",
      version: __APP_VERSION__,
    });
  });

  it("reports the configured server title alongside the name", async () => {
    const config = {
      ...mockConfig,
      server: { name: "acme-docs", title: "Acme Internal Docs" },
    } as unknown as AppConfig;

    const client = await connectClient(createServer(config));

    expect(client.getServerVersion()).toEqual({
      name: "acme-docs",
      title: "Acme Internal Docs",
      version: __APP_VERSION__,
    });
  });

  it("sends the given instructions to the client", async () => {
    const client = await connectClient(
      createMcpServerInstance(
        mockTools,
        mockConfig,
        "Search acme docs before answering.",
      ),
    );

    expect(client.getInstructions()).toBe("Search acme docs before answering.");
  });

  it("sends the built-in instructions when none are configured", async () => {
    const client = await connectClient(createServer(mockConfig));

    expect(client.getInstructions()).toBe(buildDefaultInstructions(false));
  });

  it.each([
    { mode: "normal", config: mockConfig },
    { mode: "read-only", config: mockReadOnlyConfig },
  ])(
    "names only registered tools in the built-in instructions ($mode mode)",
    async ({ config }) => {
      const client = await connectClient(createServer(config));
      const { tools } = await client.listTools();
      const registered = tools.map((tool) => tool.name);

      // Tool names are the backtick-quoted snake_case words; parameters like `version` are not.
      const named = [
        ...(client.getInstructions() ?? "").matchAll(/`([a-z]+(?:_[a-z]+)+)`/g),
      ].map((match) => match[1]);

      expect(named.length).toBeGreaterThan(0);
      for (const name of named) {
        expect(registered).toContain(name);
      }
    },
  );
});

describe("resolveServerInstructions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-instructions-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns configured inline instructions in place of the built-in text", () => {
    const config = {
      ...mockConfig,
      server: { name: "acme-docs", instructions: "Search acme docs before answering." },
    } as unknown as AppConfig;

    expect(resolveServerInstructions(config)).toBe("Search acme docs before answering.");
  });

  it("returns the configured file contents in place of the built-in text", () => {
    const instructionsFile = path.join(tmpDir, "instructions.md");
    fs.writeFileSync(instructionsFile, "# Acme docs\n\nAlways search first.\n");
    const config = {
      ...mockConfig,
      server: { name: "acme-docs", instructionsFile },
    } as unknown as AppConfig;

    expect(resolveServerInstructions(config)).toBe(
      "# Acme docs\n\nAlways search first.\n",
    );
  });

  it("returns the built-in instructions for the current mode when none are configured", () => {
    expect(resolveServerInstructions(mockConfig)).toBe(buildDefaultInstructions(false));
    expect(resolveServerInstructions(mockReadOnlyConfig)).toBe(
      buildDefaultInstructions(true),
    );
  });

  it("fails when both inline instructions and an instructions file are set", () => {
    const instructionsFile = path.join(tmpDir, "instructions.md");
    fs.writeFileSync(instructionsFile, "from file");
    const config = {
      ...mockConfig,
      server: { name: "acme-docs", instructions: "inline", instructionsFile },
    } as unknown as AppConfig;

    expect(() => resolveServerInstructions(config)).toThrow(
      /server\.instructions.*server\.instructionsFile/,
    );
  });

  it("fails when the instructions file cannot be read", () => {
    const instructionsFile = path.join(tmpDir, "missing.md");
    const config = {
      ...mockConfig,
      server: { name: "acme-docs", instructionsFile },
    } as unknown as AppConfig;

    expect(() => resolveServerInstructions(config)).toThrow(/instructions file/i);
  });
});
