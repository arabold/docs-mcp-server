/**
 * E2E test for the MCP server over HTTP.
 *
 * Spawns the full server (`server --protocol http`, web UI and API enabled,
 * default loopback bind), connects a client pinned to protocol revision
 * 2026-07-28, and checks the HTTP surface around the MCP endpoint: which
 * paths serve MCP, how other methods and old protocol revisions are answered,
 * that the deprecated SSE transport still serves old clients while auth is
 * off, and how the unauthenticated API is shielded from foreign web pages.
 */

import { type ChildProcess, spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ClientOptions, WebSocket as WsClient } from "ws";
import { getCliCommand, getFreePort, tryNodeWebSocket } from "./test-helpers";

/** Spawns the server and resolves with its advertised base URL once it is ready. */
async function startServer(port: number): Promise<{ process: ChildProcess; url: string }> {
  const projectRoot = path.resolve(import.meta.dirname, "..");
  const testEnv = { ...process.env };
  delete testEnv.VITEST_WORKER_ID;
  const { cmd, args } = getCliCommand();

  const child = spawn(cmd, [...args, "--protocol", "http", "--port", String(port)], {
    cwd: projectRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...testEnv,
      DOCS_MCP_STORE_PATH: path.join(projectRoot, "test", ".test-store-http"),
      DOCS_MCP_TELEMETRY: "false",
      LOG_LEVEL: "info",
    },
  });

  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server startup timed out")), 30000);
    let output = "";
    const handleOutput = (data: Buffer) => {
      const text = data.toString();
      output += text;
      const match = text.match(/available at (http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    };
    child.stdout?.on("data", handleOutput);
    child.stderr?.on("data", handleOutput);
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Server process error: ${err.message}`));
    });
    child.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}. Output: ${output}`));
      }
    });
  });

  return { process: child, url };
}

async function stopServer(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 3000);
    child.on("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function connectClient(baseUrl: string): Promise<Client> {
  const client = new Client(
    { name: "e2e-client", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", baseUrl)));
  return client;
}

/**
 * Opens a WebSocket with explicit handshake options, such as the `Origin` a
 * browser page sends or a rebound `Host`.
 */
async function tryWebSocketWith(url: string, options: ClientOptions): Promise<"open" | "refused"> {
  const socket = new WsClient(url, options);
  return await new Promise((resolve) => {
    socket.on("open", () => {
      socket.close();
      resolve("open");
    });
    socket.on("error", () => resolve("refused"));
  });
}

/**
 * Sends a request with an explicit `Host` and no `Origin`, the way a page on a
 * DNS-rebound domain fetches its own origin, and returns the status code.
 */
async function requestWithHost(url: string, host: string, method = "GET"): Promise<number> {
  return await new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers: { host } }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on("error", reject);
    request.end();
  });
}

describe("MCP HTTP server E2E", () => {
  let server: { process: ChildProcess; url: string } | undefined;
  let baseUrl = "";

  beforeAll(async () => {
    server = await startServer(await getFreePort());
    baseUrl = server.url;
  }, 60000);

  afterAll(async () => {
    await stopServer(server?.process);
  });

  it("serves a 2026-07-28 client: discovery, tools and a tool call", async () => {
    const client = await connectClient(baseUrl);
    try {
      expect(client.getProtocolEra()).toBe("modern");

      const tools = await client.listTools();
      const toolNames = tools.tools.map((tool) => tool.name);
      expect(toolNames).toContain("search_docs");
      expect(toolNames).toContain("list_libraries");

      const search = await client.callTool({
        name: "search_docs",
        arguments: { library: "no-such-library", query: "anything" },
      });
      expect(search.content).toBeDefined();
    } finally {
      await client.close();
    }
  }, 30000);

  it("lists and reads resources", async () => {
    const client = await connectClient(baseUrl);
    try {
      const resources = await client.listResources();
      const resource = resources.resources.find((item) =>
        item.uri.startsWith("docs://libraries"),
      );
      expect(resource).toBeDefined();

      const read = await client.readResource({ uri: resource?.uri ?? "docs://libraries" });
      expect(Array.isArray(read.contents)).toBe(true);
    } finally {
      await client.close();
    }
  }, 30000);

  it("serves a handshake-era client on the same endpoint", async () => {
    // Without version negotiation options, the client opens with the
    // initialize handshake of an earlier protocol revision.
    const client = new Client({ name: "e2e-legacy-client", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", baseUrl)));
    try {
      expect(client.getProtocolEra()).toBe("legacy");

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("search_docs");

      const search = await client.callTool({
        name: "search_docs",
        arguments: { library: "no-such-library", query: "anything" },
      });
      expect(search.content).toBeDefined();
    } finally {
      await client.close();
    }
  }, 30000);

  it("answers GET on the MCP endpoint with 405 and Allow: POST", async () => {
    const response = await fetch(new URL("/mcp", baseUrl));

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("serves a handshake-era client over the deprecated SSE transport", async () => {
    const client = new Client({ name: "e2e-legacy-sse", version: "1.0.0" });
    await client.connect(new SSEClientTransport(new URL("/sse", baseUrl)));
    try {
      expect(client.getProtocolEra()).toBe("legacy");

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("search_docs");

      const search = await client.callTool({
        name: "search_docs",
        arguments: { library: "no-such-library", query: "anything" },
      });
      expect(search.content).toBeDefined();
    } finally {
      await client.close();
    }
  }, 30000);

  it.each([
    ["GET", "/mcp/anything"],
    ["GET", "/.well-known/unknown-document"],
    ["GET", "/.well-known/oauth-authorization-server"],
    ["GET", "/.well-known/oauth-protected-resource"],
    ["GET", "/oauth/authorize"],
    ["POST", "/oauth/token"],
    ["POST", "/oauth/register"],
    ["POST", "/oauth/revoke"],
  ])("answers %s %s with a 404 that is not the web UI", async (method, pathname) => {
    const response = await fetch(new URL(pathname, baseUrl), { method });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type") ?? "").not.toContain("text/html");
  });

  it("still serves the web UI for client-side routes", async () => {
    const response = await fetch(new URL("/libraries", baseUrl));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain('<base href="/">');
  });

  it("renders the web UI in a browser at the root, including a deep link", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(new URL("/libraries/react", baseUrl).href);
      const jobsLink = page.locator('a[href="/jobs"]');
      await jobsLink.waitFor();

      const iconWidths = await page.evaluate(() =>
        Array.from(document.querySelectorAll("svg use")).map(
          (use) => use.getBoundingClientRect().width,
        ),
      );
      expect(Math.max(0, ...iconWidths)).toBeGreaterThan(0);

      await jobsLink.click();
      await page.waitForURL(new URL("/jobs", baseUrl).href);
    } finally {
      await browser.close();
    }
  }, 60000);

  it("serves the API to the web UI's own origin and without an Origin header", async () => {
    const same = await fetch(new URL("/api/ping", baseUrl), {
      headers: { origin: new URL(baseUrl).origin },
    });
    const none = await fetch(new URL("/api/ping", baseUrl));

    expect(same.status).toBe(200);
    expect(none.status).toBe(200);
  });

  it("refuses API requests from a foreign origin on a loopback bind", async () => {
    const response = await fetch(new URL("/api/ping", baseUrl), {
      headers: { origin: "https://attacker.example" },
    });

    expect(response.status).toBe(403);
  });

  it("accepts the WebSocket from Node's client and refuses it from a foreign origin", async () => {
    const wsUrl = new URL("/api", baseUrl).href.replace(/^http/, "ws");

    expect(await tryNodeWebSocket(wsUrl)).toBe("open");
    expect(await tryWebSocketWith(wsUrl, { origin: new URL(baseUrl).origin })).toBe("open");
    expect(await tryWebSocketWith(wsUrl, { origin: "https://attacker.example" })).toBe("refused");
  });

  it.each([
    ["GET", "/api/ping"],
    ["GET", "/"],
    ["POST", "/mcp"],
    ["GET", "/sse"],
  ])("refuses %s %s for a foreign host name without an Origin header", async (method, path) => {
    const port = new URL(baseUrl).port;

    const status = await requestWithHost(
      new URL(path, baseUrl).href,
      `attacker.rebind.example:${port}`,
      method,
    );

    expect(status).toBe(403);
  });

  it("serves requests addressed to localhost by name", async () => {
    const port = new URL(baseUrl).port;

    expect(await requestWithHost(new URL("/api/ping", baseUrl).href, `localhost:${port}`)).toBe(
      200,
    );
  });

  it("refuses the WebSocket for a foreign host name", async () => {
    const wsUrl = new URL("/api", baseUrl).href.replace(/^http/, "ws");

    const outcome = await tryWebSocketWith(wsUrl, {
      headers: { host: `attacker.rebind.example:${new URL(baseUrl).port}` },
    });

    expect(outcome).toBe("refused");
  });
});
