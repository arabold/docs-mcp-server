/**
 * Tests for the MCP server factory: tool argument handling and response
 * formatting through a real MCP client, telemetry privacy, the advertised tool
 * schemas, and the instructions sent to clients during initialization.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpHandler, type McpServer } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { telemetry } from "../telemetry";
import type { AppConfig } from "../utils/config";
import { createMcpServerFactory, resolveServerInstructions } from "./mcpServer";
import type { McpServerTools } from "./tools";

vi.mock("../telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../telemetry")>()),
  telemetry: { track: vi.fn() },
}));

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

const mockTools = {
  listLibraries: { execute: vi.fn(async () => ({ libraries: [] })) },
  findVersion: { execute: vi.fn(async () => "Version found") },
  search: { execute: vi.fn(async () => ({ results: [] })) },
  fetchUrl: { execute: vi.fn(async () => "# Mock content") },
  scrape: { execute: vi.fn(async () => ({ jobId: "job-123" })) },
  refresh: { execute: vi.fn(async () => ({ jobId: "refresh-job-123" })) },
  listJobs: { execute: vi.fn(async () => ({ jobs: [] })) },
  getJobInfo: { execute: vi.fn(async () => ({ job: null })) },
  cancelJob: { execute: vi.fn(async () => ({ success: true, message: "Cancelled" })) },
  remove: { execute: vi.fn(async () => ({ message: "Removed" })) },
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
  },
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
  },
} as unknown as McpServerTools;

/** Creates a server the way the entry points do: through the factory, with instructions resolved from the config. */
function createServer(config: AppConfig): McpServer {
  return createMcpServerFactory(mockTools, config)();
}

/**
 * Connects a real MCP client to the server over an in-memory transport, so
 * tool arguments are validated and parsed by the SDK as they are in production.
 */
async function connectClient(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

/** Calls one tool on a fresh normal-mode server and returns the text of its response. */
async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const client = await connectClient(createServer(mockConfig));
  const result = await client.callTool({ name, arguments: args });
  return (result.content as Array<{ text: string }>).map((part) => part.text).join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MCP tools", () => {
  it("forwards startChunk and tells the agent how to continue a long page", async () => {
    vi.mocked(mockTools.readPage.execute).mockResolvedValueOnce({
      url: "https://example.com/long",
      title: "Long",
      contentType: "text/markdown",
      content: "part two",
      startChunk: 2,
      totalChunks: 5,
      nextChunk: 4,
    });

    const text = await callTool("read_page", {
      library: "react",
      pathOrUrl: "/long",
      startChunk: 2,
    });

    expect(mockTools.readPage.execute).toHaveBeenCalledWith(
      expect.objectContaining({ startChunk: 2 }),
    );
    expect(text).toContain("chunks 3-4 of 5");
    expect(text).toContain("startChunk: 4");
  });

  it("says when startChunk is past the end of the page", async () => {
    vi.mocked(mockTools.readPage.execute).mockResolvedValueOnce({
      url: "https://example.com/short",
      title: "Short",
      contentType: "text/markdown",
      content: "",
      startChunk: 9,
      totalChunks: 3,
      nextChunk: null,
    });

    const text = await callTool("read_page", {
      library: "react",
      pathOrUrl: "/short",
      startChunk: 9,
    });

    expect(text).toContain("past the end");
    expect(text).toContain("3 chunks");
  });

  it("lists pages as escaped links with their depth", async () => {
    vi.mocked(mockTools.listPages.execute).mockResolvedValueOnce({
      library: "react",
      version: "19.0.0",
      total: 1,
      pages: [{ url: "https://example.com/docs", title: "[Beta] Guide", depth: 1 }],
      limit: 50,
      offset: 0,
      hasMore: false,
    });

    const text = await callTool("list_pages", { library: "react", version: "19.0.0" });

    expect(text).toContain("Indexed pages for react@19.0.0");
    expect(text).toContain("- [\\[Beta\\] Guide](<https://example.com/docs>) (depth: 1)");
  });

  it("keeps URL paths, queries and search text out of telemetry", async () => {
    const cases: Array<{
      tool: string;
      args: Record<string, unknown>;
      execute: (...args: never[]) => unknown;
      forbidden: string[];
      sent: Record<string, unknown>;
    }> = [
      {
        tool: "read_page",
        args: {
          library: "react",
          pathOrUrl: "file:///private/documents/secret.md#token",
        },
        execute: mockTools.readPage.execute,
        forbidden: ["secret", "file://"],
        sent: { tool: "read_page" },
      },
      {
        tool: "scrape_docs",
        args: {
          library: "internal",
          url: "https://intranet.example.com/team/secret?q=1",
        },
        execute: mockTools.scrape.execute,
        forbidden: ["secret"],
        sent: { url: "intranet.example.com", urlProtocol: "https" },
      },
      {
        tool: "fetch_url",
        args: { url: "https://intranet.example.com/team/secret?q=1" },
        execute: mockTools.fetchUrl.execute,
        forbidden: ["secret"],
        sent: { url: "intranet.example.com", urlProtocol: "https" },
      },
      {
        tool: "search_docs",
        args: { library: "react", query: "secret roadmap" },
        execute: mockTools.search.execute,
        forbidden: ["secret"],
        sent: { queryLength: 14 },
      },
      {
        tool: "list_pages",
        args: { library: "react", contains: "/private/secret/path" },
        execute: mockTools.listPages.execute,
        forbidden: ["secret"],
        sent: { tool: "list_pages" },
      },
    ];

    for (const { tool, args, execute, forbidden, sent } of cases) {
      await callTool(tool, args);

      const event = vi
        .mocked(telemetry.track)
        .mock.calls.find(([, data]) => data?.tool === tool);
      expect.soft(event?.[1], `${tool} event`).toMatchObject(sent);
      for (const text of forbidden) {
        expect.soft(JSON.stringify(event), `${tool} event`).not.toContain(text);
      }
      // The tool itself still gets the full argument
      expect
        .soft(JSON.stringify(vi.mocked(execute).mock.calls), `${tool} call`)
        .toContain("secret");
    }
  });

  it("maps scrape_docs arguments onto the scrape options", async () => {
    await callTool("scrape_docs", {
      url: "https://example.com/#/guide",
      library: "example-lib",
      preserveHashes: true,
      includePatterns: "/version-v0.3/",
      excludePatterns: ["/exclude/"],
      replace: true,
    });
    await callTool("scrape_docs", { url: "https://example.com", library: "lib" });

    const calls = vi
      .mocked(mockTools.scrape.execute)
      .mock.calls.map(([options]) => options);
    expect(calls[0]).toMatchObject({
      url: "https://example.com/#/guide",
      library: "example-lib",
      replace: true,
      options: {
        preserveHashes: true,
        includePatterns: ["/version-v0.3/"],
        excludePatterns: ["/exclude/"],
      },
    });
    expect(calls[1]).toMatchObject({ replace: false });
  });

  it("splits scrape_docs pattern strings without breaking regex or glob constructs", async () => {
    const cases: Array<{ label: string; input: string | string[]; patterns: string[] }> =
      [
        {
          label: "comma inside a regex quantifier is preserved",
          input: "/\\/v\\d{1,3}\\//",
          patterns: ["/\\/v\\d{1,3}\\//"],
        },
        {
          label: "comma inside glob brace expansion is preserved",
          input: "**/*.{js,ts}",
          patterns: ["**/*.{js,ts}"],
        },
        {
          label: "comma inside a character class is preserved",
          input: "/docs/[a-z,0-9]+/",
          patterns: ["/docs/[a-z,0-9]+/"],
        },
        {
          label: "top-level commas split into multiple patterns",
          input: "/version-v0.3/, /versioned_docs/version-v0.3/",
          patterns: ["/version-v0.3/", "/versioned_docs/version-v0.3/"],
        },
        {
          label: "escaped commas are literal commas, not separators",
          input: "/docs/v1\\,2/",
          patterns: ["/docs/v1\\,2/"],
        },
        {
          label: "empty segments are dropped",
          input: "/version-v0.3/, , /version-v0.2/",
          patterns: ["/version-v0.3/", "/version-v0.2/"],
        },
        {
          label: "an array is kept as it is",
          input: ["/version-v0.3/", "/versioned_docs/version-v0.3/"],
          patterns: ["/version-v0.3/", "/versioned_docs/version-v0.3/"],
        },
      ];

    for (const { label, input, patterns } of cases) {
      vi.mocked(mockTools.scrape.execute).mockClear();
      await callTool("scrape_docs", {
        url: "https://example.com",
        library: "example-lib",
        includePatterns: input,
      });

      const options = vi.mocked(mockTools.scrape.execute).mock.calls[0]?.[0].options;
      expect.soft(options?.includePatterns, label).toEqual(patterns);
    }
  });
});

describe("MCP versions resource", () => {
  it("finds a library by its name, ignoring case and percent-encoding", async () => {
    vi.mocked(mockTools.listLibraries.execute).mockResolvedValue({
      libraries: [
        { name: "React", versions: [{ version: "19.0.0" }] },
        { name: "@tanstack/query", versions: [{ version: "5.0.0" }] },
      ],
    } as unknown as Awaited<ReturnType<McpServerTools["listLibraries"]["execute"]>>);
    const client = await connectClient(createServer(mockConfig));
    const cases = [
      {
        label: "case-insensitive",
        uri: "docs://libraries/react/versions",
        versions: ["19.0.0"],
      },
      {
        label: "percent-encoded name containing a slash",
        uri: "docs://libraries/%40tanstack%2Fquery/versions",
        versions: ["5.0.0"],
      },
    ];

    for (const { label, uri, versions } of cases) {
      const result = await client.readResource({ uri });
      const texts = result.contents.map((content) =>
        "text" in content ? content.text : "",
      );
      expect.soft(texts, label).toEqual(versions);
    }
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
      "list_pages",
      "read_page",
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
      "list_pages",
      "read_page",
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

describe("MCP Server instructions", () => {
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
});
