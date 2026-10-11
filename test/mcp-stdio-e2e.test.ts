/**
 * E2E test for MCP server running in stdio mode.
 *
 * This test spawns the MCP server as a child process, communicates via stdin/stdout
 * using the MCP protocol, and verifies basic functionality works correctly.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Client } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBusService } from "../src/events";
import { buildDefaultInstructions } from "../src/mcp/defaultInstructions";
import { createLocalDocumentManagement } from "../src/store";
import { loadConfig } from "../src/utils/config";
import { getCliCommand, writeTestConfig } from "./test-helpers";

/** A transport that spawns the CLI over stdio with a test store and no telemetry. */
function createStdioTransport(overrides: Record<string, string> = {}): StdioClientTransport {
  const projectRoot = path.resolve(import.meta.dirname, "..");
  // Without VITEST_WORKER_ID the child process logs as it does in production.
  const env = { ...process.env };
  delete env.VITEST_WORKER_ID;
  const { cmd, args } = getCliCommand();
  return new StdioClientTransport({
    command: cmd,
    args,
    cwd: projectRoot,
    env: {
      ...env,
      DOCS_MCP_STORE_PATH: path.join(projectRoot, "test", ".test-store-stdio"),
      DOCS_MCP_TELEMETRY: "false",
      ...overrides,
    },
  });
}

describe("MCP stdio server E2E", () => {
  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;
  let storeDir: string | null = null;

  beforeEach(() => {
    // Reset state before each test
    client = null;
    transport = null;
  });

  afterEach(async () => {
    // Clean up client connection
    if (client) {
      try {
        await client.close();
      } catch {
        // Ignore errors during cleanup
      }
      client = null;
    }

    // Clean up transport
    if (transport) {
      try {
        await transport.close();
      } catch {
        // Ignore errors during cleanup
      }
      transport = null;
    }

    // Remove a seeded store only after the server has released it
    if (storeDir) {
      rmSync(storeDir, { recursive: true, force: true });
      storeDir = null;
    }
  });

  it("should start, respond to initialize with the built-in instructions, and list tools", async () => {
    transport = createStdioTransport();

    // Create MCP client
    client = new Client(
      {
        name: "test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );

    // Connect client to server via transport
    await client.connect(transport);

    // No instructions are configured, so the built-in instructions are sent
    expect(client.getInstructions()).toBe(buildDefaultInstructions(false));

    // List available tools - this is a basic operation that should work
    const toolsResult = await client.listTools();

    // Verify we got some tools back
    expect(toolsResult).toBeDefined();
    expect(toolsResult.tools).toBeDefined();
    expect(Array.isArray(toolsResult.tools)).toBe(true);

    // The server should have at least some tools registered
    // Based on the codebase, we expect tools like scrape_docs, search_docs, etc.
    expect(toolsResult.tools.length).toBeGreaterThan(0);

    // Verify some expected tool names
    const toolNames = toolsResult.tools.map((t) => t.name);
    expect(toolNames).toContain("search_docs");
    expect(toolNames).toContain("list_libraries");

    // A client left at defaults opens with the handshake of an earlier
    // revision, which stdio keeps serving.
    expect(client.getProtocolEra()).toBe("legacy");
  }, 30000);

  it("serves a client on protocol revision 2026-07-28", async () => {
    transport = createStdioTransport();
    client = new Client(
      { name: "modern-client", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );

    await client.connect(transport);

    expect(client.getProtocolEra()).toBe("modern");
    const toolsResult = await client.listTools();
    expect(toolsResult.tools.map((t) => t.name)).toContain("search_docs");
  }, 60000);

  it("should report the configured server name, title and instructions on initialize", async () => {
    transport = createStdioTransport({
      DOCS_MCP_SERVER_NAME: "acme-docs",
      DOCS_MCP_SERVER_TITLE: "Acme Docs",
      DOCS_MCP_SERVER_INSTRUCTIONS: "Search acme docs before answering.",
    });

    client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await client.connect(transport);

    expect(client.getServerVersion()?.name).toBe("acme-docs");
    expect(client.getServerVersion()?.title).toBe("Acme Docs");
    expect(client.getServerVersion()?.version).not.toBe("0.1.0");
    expect(client.getInstructions()).toBe("Search acme docs before answering.");
  }, 30000);

  it("should handle shutdown gracefully", async () => {
    transport = createStdioTransport();

    client = new Client(
      {
        name: "test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );

    // Connect
    await client.connect(transport);

    // Verify connection works
    const toolsResult = await client.listTools();
    expect(toolsResult.tools.length).toBeGreaterThan(0);

    // Close the client (should send shutdown/exit)
    await client.close();
    client = null;

    // Close the transport
    await transport.close();
    transport = null;
  }, 30000);

  it("should list the pages of a seeded store and read one of them", async () => {
    storeDir = mkdtempSync(path.join(tmpdir(), "mcp-stdio-pages-"));

    // Seed a real store before the server opens it
    const appConfig = loadConfig();
    appConfig.app.storePath = storeDir;
    appConfig.app.embeddingModel = "";
    const docService = await createLocalDocumentManagement(new EventBusService(), appConfig);
    await docService.addScrapeResult("pages-lib", "1.0.0", 1, {
      url: "https://example.com/docs/guide",
      title: "Guide",
      sourceContentType: "text/markdown",
      contentType: "text/markdown",
      textContent: "irrelevant",
      links: [],
      errors: [],
      chunks: [
        { types: ["text"], content: "# Guide", section: { level: 1, path: ["Guide"] } },
        {
          types: ["text"],
          content: "Install the package first.",
          section: { level: 1, path: ["Guide"] },
        },
      ],
    });
    await docService.shutdown();

    transport = createStdioTransport({
      DOCS_MCP_STORE_PATH: storeDir,
      DOCS_MCP_EMBEDDING_MODEL: "",
    });
    client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);

    const textOf = (result: Awaited<ReturnType<Client["callTool"]>>) =>
      (result.content as Array<{ type: string; text: string }>)[0].text;

    const listed = await client.callTool({
      name: "list_pages",
      arguments: { library: "pages-lib" },
    });
    expect(textOf(listed)).toContain("https://example.com/docs/guide");

    const read = await client.callTool({
      name: "read_page",
      arguments: { library: "pages-lib", pathOrUrl: "/docs/guide" },
    });
    expect(read.isError).toBeFalsy();
    expect(textOf(read)).toContain("> Source: https://example.com/docs/guide");
    expect(textOf(read)).toContain("# Guide\n\nInstall the package first.");
  }, 60000);

  it("rejects scrape_docs for an existing version and names the replace argument", async () => {
    const projectRoot = path.resolve(import.meta.dirname, "..");
    storeDir = mkdtempSync(path.join(tmpdir(), "mcp-stdio-replace-"));
    const configPath = writeTestConfig(storeDir);

    transport = createStdioTransport({
      DOCS_MCP_STORE_PATH: storeDir,
      DOCS_MCP_CONFIG: configPath,
    });
    const connected = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    client = connected;
    await connected.connect(transport);

    const scrape = () =>
      connected.callTool({
        name: "scrape_docs",
        arguments: {
          library: "Stdio Lib",
          url: `file://${path.join(projectRoot, "test", "fixtures", "html.html")}`,
        },
      });

    const first = await scrape();
    expect(first.isError).toBeFalsy();

    const second = await scrape();
    expect(second.isError).toBe(true);
    const text = (second.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('"Stdio Lib"');
    expect(text).toContain("replace: true");
  }, 30000);
});
