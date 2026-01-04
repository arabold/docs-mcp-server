/**
 * E2E test for MCP server running in stdio mode.
 *
 * This test spawns the MCP server as a child process, communicates via stdin/stdout
 * using the MCP protocol, and verifies basic functionality works correctly.
 */

import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCliCommand } from "./test-helpers";

describe("MCP stdio server E2E", () => {
  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;

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

  });

  it("should start, respond to initialize, and list tools", async () => {
    // Using vite-node to run TypeScript directly
    const projectRoot = path.resolve(import.meta.dirname, "..");
    const entryPoint = path.join(projectRoot, "src", "index.ts");

    // Build environment without VITEST_WORKER_ID to ensure proper logging behavior
    const testEnv = { ...process.env };
    delete testEnv.VITEST_WORKER_ID;

    const { cmd, args } = getCliCommand();

    // Create stdio transport which spawns its own process
    transport = new StdioClientTransport({
      command: cmd,
      args: args,
      cwd: projectRoot,
      env: {
        ...testEnv,
        DOCS_MCP_STORE_PATH: path.join(projectRoot, "test", ".test-store-stdio"),
        DOCS_MCP_TELEMETRY: "false",
      },
    });

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
  }, 30000); // 30 second timeout for this test

  it("should handle shutdown gracefully", async () => {
    const projectRoot = path.resolve(import.meta.dirname, "..");
    const entryPoint = path.join(projectRoot, "src", "index.ts");

    // Create stdio transport which spawns its own process
    // Build environment without VITEST_WORKER_ID
    const testEnv = { ...process.env };
    delete testEnv.VITEST_WORKER_ID;

    const { cmd, args } = getCliCommand();

    transport = new StdioClientTransport({
      command: cmd,
      args: args,
      cwd: projectRoot,
      env: {
        ...testEnv,
        DOCS_MCP_STORE_PATH: path.join(projectRoot, "test", ".test-store-stdio"),
        DOCS_MCP_TELEMETRY: "false",
      },
    });

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
});
