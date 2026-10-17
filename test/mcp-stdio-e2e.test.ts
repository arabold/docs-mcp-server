/**
 * E2E test for MCP server running in stdio mode.
 *
 * This test spawns the MCP server as a child process, communicates via stdin/stdout
 * using the MCP protocol, and verifies basic functionality works correctly, with
 * a local store and with a remote worker.
 */

import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Client } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDefaultInstructions } from "../src/mcp/defaultInstructions";
import { VersionStatus } from "../src/store/types";
import {
  getCliCommand,
  HTML_FIXTURE_URL,
  startWorker,
  stopChildProcess,
  withStore,
  writeTestConfig,
} from "./test-helpers";

/**
 * A transport that spawns the CLI over stdio with a test store and no telemetry.
 * @param overrides Environment variables to set.
 * @param cliArgs Arguments for the CLI; none runs the default command.
 */
function createStdioTransport(
  overrides: Record<string, string> = {},
  cliArgs: string[] = [],
): StdioClientTransport {
  const projectRoot = path.resolve(import.meta.dirname, "..");
  // Without VITEST_WORKER_ID the child process logs as it does in production.
  const env = { ...process.env };
  delete env.VITEST_WORKER_ID;
  const { cmd, args } = getCliCommand();
  return new StdioClientTransport({
    command: cmd,
    args: [...args, ...cliArgs],
    cwd: projectRoot,
    env: {
      ...env,
      DOCS_MCP_STORE_PATH: path.join(projectRoot, "test", ".test-store-stdio"),
      DOCS_MCP_TELEMETRY: "false",
      ...overrides,
    },
  });
}

/** The text of a tool result, its parts joined. */
function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as Array<{ text: string }>).map((part) => part.text).join("\n");
}

describe("MCP stdio server E2E", () => {
  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;
  let storeDir: string | null = null;
  let worker: ChildProcess | undefined;

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

    await stopChildProcess(worker);
    worker = undefined;

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
    await withStore(storeDir, (store) =>
      store.addScrapeResult("pages-lib", "1.0.0", 1, {
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
      }),
    );

    transport = createStdioTransport({
      DOCS_MCP_STORE_PATH: storeDir,
      DOCS_MCP_EMBEDDING_MODEL: "",
    });
    client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);

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
          url: HTML_FIXTURE_URL,
        },
      });

    const first = await scrape();
    expect(first.isError).toBeFalsy();

    const second = await scrape();
    expect(second.isError).toBe(true);
    expect(textOf(second)).toContain('"Stdio Lib"');
    expect(textOf(second)).toContain("replace: true");
  }, 30000);

  it.each([
    { command: "mcp", cliArgs: ["mcp", "--protocol", "stdio", "--read-only"] },
    // Without a terminal, the default command serves MCP over stdio
    { command: "the default command", cliArgs: ["--read-only"] },
  ])("$command leaves a version another process is running alone in read-only mode", async ({
    cliArgs,
  }) => {
    const dir = mkdtempSync(path.join(tmpdir(), "mcp-stdio-read-only-"));
    storeDir = dir;
    const statusOfBusy = () =>
      withStore(dir, async (store) => (await store.listLibraries())[0]?.versions[0]?.status);
    // A worker on the same store is scraping Busy 1.0
    await withStore(dir, async (store) => {
      const versionId = await store.ensureVersion({ library: "Busy", version: "1.0" });
      await store.updateVersionStatus(versionId, VersionStatus.RUNNING);
    });

    transport = createStdioTransport(
      { DOCS_MCP_STORE_PATH: dir, DOCS_MCP_EMBEDDING_MODEL: "" },
      cliArgs,
    );
    client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    // Connected means the server has opened the store and started up
    await client.connect(transport);
    await client.close();
    client = null;

    expect(await statusOfBusy()).toBe(VersionStatus.RUNNING);
  }, 30000);

  it("scrapes, searches and removes through a remote worker", async () => {
    storeDir = mkdtempSync(path.join(tmpdir(), "mcp-stdio-remote-"));
    const configPath = writeTestConfig(storeDir);
    const started = await startWorker(storeDir, configPath);
    worker = started.process;

    transport = createStdioTransport({ DOCS_MCP_CONFIG: configPath }, [
      "mcp",
      "--protocol",
      "stdio",
      "--server-url",
      started.url,
    ]);
    const connected = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    client = connected;
    await connected.connect(transport);

    const scraped = await connected.callTool({
      name: "scrape_docs",
      arguments: {
        library: "Remote Lib",
        url: HTML_FIXTURE_URL,
      },
    });
    expect(scraped.isError, textOf(scraped)).toBeFalsy();

    // The scrape runs on the worker; its documents become searchable there
    await vi.waitFor(
      async () => {
        const found = await connected.callTool({
          name: "search_docs",
          arguments: { library: "Remote Lib", query: "blacksmith" },
        });
        expect(textOf(found)).toContain("blacksmith");
      },
      { timeout: 30_000, interval: 500 },
    );

    const listLibraries = async () => {
      const listed = await connected.callTool({ name: "list_libraries", arguments: {} });
      expect(listed.isError, textOf(listed)).toBeFalsy();
      return textOf(listed);
    };
    expect(await listLibraries()).toContain("Remote Lib");

    const removed = await connected.callTool({
      name: "remove_docs",
      arguments: { library: "Remote Lib" },
    });
    expect(removed.isError, textOf(removed)).toBeFalsy();
    expect(await listLibraries()).not.toContain("Remote Lib");
  }, 90_000);
});
