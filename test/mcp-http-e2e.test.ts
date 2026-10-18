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

import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getFreePort,
  launchChromium,
  requestWithHost,
  startCliServer,
  stopChildProcess,
  tryWebSocket,
  withStore,
  writeTestConfig,
} from "./test-helpers";

/** The library seeded into the server's store, and a phrase only its page contains. */
const SEEDED_LIBRARY = "http-e2e-lib";
const SEEDED_PHRASE = "The flux capacitor needs exactly 1.21 gigawatts.";

/** Writes one page of {@link SEEDED_LIBRARY} into the store at `storePath`. */
async function seedStore(storePath: string, configPath: string): Promise<void> {
  await withStore(
    storePath,
    (store) =>
      store.addScrapeResult(SEEDED_LIBRARY, "1.0.0", 1, {
        url: "https://example.com/docs/flux",
        title: "Flux",
        sourceContentType: "text/markdown",
        contentType: "text/markdown",
        textContent: SEEDED_PHRASE,
        links: [],
        errors: [],
        chunks: [
          { types: ["text"], content: "# Flux", section: { level: 1, path: ["Flux"] } },
          { types: ["text"], content: SEEDED_PHRASE, section: { level: 1, path: ["Flux"] } },
        ],
      }),
    { configPath },
  );
}

/** Spawns the server and resolves with its advertised base URL once it is ready. */
function startServer(
  port: number,
  storePath: string,
  configPath: string,
): Promise<{ process: ChildProcess; url: string }> {
  return startCliServer(["--protocol", "http", "--port", String(port)], {
    DOCS_MCP_STORE_PATH: storePath,
    DOCS_MCP_CONFIG: configPath,
    DOCS_MCP_TELEMETRY: "false",
    LOG_LEVEL: "info",
  });
}

/** The text of a tool result, its parts joined. */
function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as Array<{ text: string }>).map((part) => part.text).join("\n");
}

async function connectClient(baseUrl: string): Promise<Client> {
  const client = new Client(
    { name: "e2e-client", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", baseUrl)));
  return client;
}

describe("MCP HTTP server E2E", () => {
  let server: { process: ChildProcess; url: string } | undefined;
  let baseUrl = "";
  let storeDir = "";

  beforeAll(async () => {
    storeDir = mkdtempSync(path.join(tmpdir(), "mcp-http-e2e-"));
    const configPath = writeTestConfig(storeDir);
    await seedStore(storeDir, configPath);
    server = await startServer(await getFreePort(), storeDir, configPath);
    baseUrl = server.url;
  }, 60000);

  afterAll(async () => {
    await stopChildProcess(server?.process);
    rmSync(storeDir, { recursive: true, force: true });
  });

  it.each([
    {
      name: "a 2026-07-28 client on /mcp",
      era: "modern",
      connect: (client: Client) =>
        client.connect(new StreamableHTTPClientTransport(new URL("/mcp", baseUrl))),
      pinned: true,
    },
    {
      // Without version negotiation options, the client opens with the
      // initialize handshake of an earlier protocol revision.
      name: "a handshake-era client on /mcp",
      era: "legacy",
      connect: (client: Client) =>
        client.connect(new StreamableHTTPClientTransport(new URL("/mcp", baseUrl))),
      pinned: false,
    },
    {
      name: "a handshake-era client over the deprecated SSE transport",
      era: "legacy",
      connect: (client: Client) =>
        client.connect(new SSEClientTransport(new URL("/sse", baseUrl))),
      pinned: false,
    },
  ])("serves $name: tools and a tool call", async ({ era, connect, pinned }) => {
    const client = new Client(
      { name: "e2e-client", version: "1.0.0" },
      pinned ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : undefined,
    );
    await connect(client);
    try {
      expect(client.getProtocolEra()).toBe(era);

      const tools = await client.listTools();
      const toolNames = tools.tools.map((tool) => tool.name);
      expect(toolNames).toContain("search_docs");
      expect(toolNames).toContain("list_libraries");

      const search = await client.callTool({
        name: "search_docs",
        arguments: { library: SEEDED_LIBRARY, query: "flux capacitor" },
      });
      expect(search.isError, textOf(search)).toBeFalsy();
      expect(textOf(search)).toContain(SEEDED_PHRASE);
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
      expect(read.contents.map((content) => ("text" in content ? content.text : ""))).toContain(
        SEEDED_LIBRARY,
      );
    } finally {
      await client.close();
    }
  }, 30000);

  it("answers GET on the MCP endpoint with 405 and Allow: POST", async () => {
    const response = await fetch(new URL("/mcp", baseUrl));

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

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
    const browser = await launchChromium();
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

  it("accepts the WebSocket without an Origin header and refuses it from a foreign origin", async () => {
    const wsUrl = new URL("/api", baseUrl).href.replace(/^http/, "ws");

    expect(await tryWebSocket(wsUrl)).toBe("open");
    expect(await tryWebSocket(wsUrl, { origin: new URL(baseUrl).origin })).toBe("open");
    expect(await tryWebSocket(wsUrl, { origin: "https://attacker.example" })).toBe("refused");
  });

  it("accepts the WebSocket at the root, where coordinators of earlier releases connect", async () => {
    expect(await tryWebSocket(new URL("/", baseUrl).href.replace(/^http/, "ws"))).toBe(
      "open",
    );
  });

  it.each(["/mcp", "/sse", "/libraries"])(
    "refuses a WebSocket upgrade on %s, which is not the API",
    async (pathname) => {
      const wsUrl = new URL(pathname, baseUrl).href.replace(/^http/, "ws");

      expect(await tryWebSocket(wsUrl)).toBe("refused");
    },
  );

  it.each([
    ["GET", "/api/ping"],
    ["GET", "/"],
    ["POST", "/mcp"],
    ["GET", "/sse"],
  ])("refuses %s %s for a foreign host name without an Origin header", async (method, path) => {
    const port = new URL(baseUrl).port;

    const { status } = await requestWithHost(
      new URL(path, baseUrl).href,
      `attacker.rebind.example:${port}`,
      method,
    );

    expect(status).toBe(403);
  });

  it("serves requests addressed to localhost by name", async () => {
    const port = new URL(baseUrl).port;

    const { status } = await requestWithHost(
      new URL("/api/ping", baseUrl).href,
      `localhost:${port}`,
    );

    expect(status).toBe(200);
  });

  it("refuses the WebSocket for a foreign host name", async () => {
    const wsUrl = new URL("/api", baseUrl).href.replace(/^http/, "ws");

    const outcome = await tryWebSocket(wsUrl, {
      headers: { host: `attacker.rebind.example:${new URL(baseUrl).port}` },
    });

    expect(outcome).toBe("refused");
  });
});
