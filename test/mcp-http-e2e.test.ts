/**
 * E2E test for MCP server running in HTTP mode.
 *
 * This test spawns the MCP server as a child process in HTTP mode,
 * connects via SSE transport, and verifies basic functionality.
 *
 * Note: We intentionally use SSEClientTransport (deprecated) to test the /sse endpoint
 * which is maintained for backwards compatibility with older MCP clients.
 * The /mcp endpoint uses the newer StreamableHTTPServerTransport.
 */

import { type ChildProcess, spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
// Using deprecated SSEClientTransport intentionally to test the legacy /sse endpoint
// eslint-disable-next-line deprecation/deprecation
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { afterEach, describe, expect, it } from "vitest";

describe("MCP HTTP server E2E", () => {
  let serverProcess: ChildProcess | null = null;
  let client: Client | null = null;
  let transport: SSEClientTransport | null = null;

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

    // Kill server process if still running
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill("SIGTERM");
      // Wait a bit for graceful shutdown
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (serverProcess && !serverProcess.killed) {
            serverProcess.kill("SIGKILL");
          }
          resolve();
        }, 3000);

        serverProcess?.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      serverProcess = null;
    }
  });

  /**
   * Spawns the server and waits for it to be ready.
   * Returns the server URL when ready.
   */
  async function startServer(port: number): Promise<string> {
    const projectRoot = path.resolve(import.meta.dirname, "..");
    const entryPoint = path.join(projectRoot, "src", "index.ts");

    // Build environment without VITEST_WORKER_ID
    const testEnv = { ...process.env };
    delete testEnv.VITEST_WORKER_ID;

    serverProcess = spawn(
      "npx",
      ["vite-node", entryPoint, "--protocol", "http", "--port", String(port)],
      {
        cwd: projectRoot,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...testEnv,
          DOCS_MCP_STORE_PATH: path.join(projectRoot, "test", ".test-store-http"),
          DOCS_MCP_TELEMETRY: "false",
        },
      },
    );

    // Wait for server to start by watching stdout/stderr for the "available at" message
    const serverUrl = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Server startup timed out"));
      }, 15000);

      let output = "";

      const handleOutput = (data: Buffer) => {
        const text = data.toString();
        output += text;

        // Look for the "available at" message that indicates the server is ready
        // Pattern: "🚀 ... available at http://..."
        const match = text.match(/available at (http:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      };

      serverProcess?.stdout?.on("data", handleOutput);
      serverProcess?.stderr?.on("data", handleOutput);

      serverProcess?.on("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`Server process error: ${err.message}`));
      });

      serverProcess?.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          clearTimeout(timeout);
          reject(new Error(`Server exited with code ${code}. Output: ${output}`));
        }
      });
    });

    return serverUrl;
  }

  it("should start HTTP server, respond to initialize, and list tools", async () => {
    // Use a high port to avoid conflicts
    const port = 39123;
    const serverUrl = await startServer(port);

    // Construct SSE endpoint URL
    const sseUrl = new URL("/sse", serverUrl);

    // Create SSE transport
    transport = new SSEClientTransport(sseUrl);

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
    expect(toolsResult.tools.length).toBeGreaterThan(0);

    // Verify some expected tool names
    const toolNames = toolsResult.tools.map((t) => t.name);
    expect(toolNames).toContain("search_docs");
    expect(toolNames).toContain("list_libraries");
  }, 30000);

  it("should handle shutdown gracefully", async () => {
    const port = 39124;
    const serverUrl = await startServer(port);

    const sseUrl = new URL("/sse", serverUrl);
    transport = new SSEClientTransport(sseUrl);

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

    // Close the client
    await client.close();
    client = null;

    // Close the transport
    await transport.close();
    transport = null;
  }, 30000);

  it("should send SSE heartbeat messages to keep connection alive", async () => {
    const port = 39125;
    const serverUrl = await startServer(port);

    // Connect directly to SSE endpoint to observe raw data
    const sseUrl = new URL("/sse", serverUrl);

    // Collect received data including heartbeats
    const receivedData: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Test timed out waiting for heartbeat"));
      }, 40000); // Wait up to 40 seconds (heartbeat should come within 30s)

      const req = http.request(
        {
          hostname: sseUrl.hostname,
          port: sseUrl.port,
          path: sseUrl.pathname,
          method: "GET",
          headers: {
            Accept: "text/event-stream",
          },
        },
        (res) => {
          res.setEncoding("utf8");

          res.on("data", (chunk: string) => {
            receivedData.push(chunk);

            // Check if we received a heartbeat comment
            // SSE comments start with ':'
            if (chunk.includes(": heartbeat")) {
              clearTimeout(timeout);
              // Close the connection once we've verified heartbeat
              res.destroy();
              resolve();
            }
          });

          res.on("end", () => {
            // Connection ended - no action needed, test resolves on heartbeat receipt
          });

          res.on("error", (err) => {
            // Ignore errors from destroying the response
            if (!err.message.includes("aborted")) {
              clearTimeout(timeout);
              reject(err);
            }
          });
        },
      );

      req.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      req.end();
    });

    // Verify we received some data including the heartbeat
    expect(receivedData.length).toBeGreaterThan(0);
    expect(receivedData.some((data) => data.includes(": heartbeat"))).toBe(true);
  }, 45000);
});
