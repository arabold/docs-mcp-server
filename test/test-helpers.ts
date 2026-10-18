import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import http, { createServer, type IncomingMessage, type Server } from "node:http";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Database } from "better-sqlite3";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { type Browser, chromium } from "playwright";
import { expect, vi } from "vitest";
import { type ClientOptions, WebSocket } from "ws";
import { EventBusService } from "../src/events/EventBusService";
import { ScrapeMode, type ScraperOptions } from "../src/scraper/types";
import type { ApiClient } from "../src/services/apiClient";
import { DocumentManagementService } from "../src/store/DocumentManagementService";
import { loadConfig } from "../src/utils/config";

/** The `file://` URL of the one-page HTML fixture the CLI and worker suites scrape. */
export const HTML_FIXTURE_URL = pathToFileURL(
  path.resolve(import.meta.dirname, "fixtures", "html.html"),
).href;

/**
 * Opens the FTS-only store at `storePath` on its own, the way another process
 * would, runs `work` on it, and closes it again.
 *
 * @param storePath The store directory.
 * @param work What to do with the open store.
 * @param options.configPath A config file to load instead of the defaults.
 * @returns What `work` returns.
 */
export async function withStore<T>(
  storePath: string,
  work: (store: DocumentManagementService) => Promise<T>,
  options: { configPath?: string } = {},
): Promise<T> {
  const config = loadConfig({}, options.configPath ? { configPath: options.configPath } : {});
  config.app.storePath = storePath;
  config.app.embeddingModel = "";
  const store = new DocumentManagementService(new EventBusService(), config);
  await store.initialize();
  try {
    return await work(store);
  } finally {
    await store.shutdown();
  }
}

/**
 * Environment for a spawned CLI that has to stay on full-text search. Without
 * it, an `OPENAI_API_KEY` from the shell or `.env` makes `loadConfig()` pick an
 * embedding model despite the test config, and the child calls the real
 * service. Empty strings also keep dotenv from filling the values in.
 */
export const FTS_ONLY_ENV = { OPENAI_API_KEY: "", DOCS_MCP_EMBEDDING_MODEL: "" } as const;

/**
 * Returns the command and arguments to run the CLI.
 * Prefers the built 'dist/index.js' if available for faster execution;
 * `global-setup.ts` rebuilds it first when it is older than the sources.
 * Falls back to vite-node on 'src/index.ts' for development, as in CI, which
 * tests before it builds.
 *
 * Either way the command is this Node running the CLI itself, never a wrapper
 * such as npx: a test that kills the process must reach the CLI, and npx cannot
 * pass on SIGKILL, so the CLI behind it would keep running.
 */
export function getCliCommand(): { cmd: string; args: string[] } {
  const projectRoot = path.resolve(import.meta.dirname, "..");
  const distEntry = path.join(projectRoot, "dist", "index.js");

  // Check if dist/index.js exists
  if (fs.existsSync(distEntry)) {
    return { cmd: process.execPath, args: [distEntry] };
  }

  const srcEntry = path.join(projectRoot, "src", "index.ts");
  const viteNodePackage = createRequire(import.meta.url).resolve("vite-node/package.json");
  const { bin } = JSON.parse(fs.readFileSync(viteNodePackage, "utf8")) as {
    bin: Record<string, string>;
  };
  const viteNodeCli = path.join(path.dirname(viteNodePackage), bin["vite-node"]);
  return { cmd: process.execPath, args: [viteNodeCli, srcEntry] };
}

/**
 * Runs the CLI to the end, the way a user runs a command.
 *
 * @param args CLI arguments, e.g. `["list", "--store-path", dir]`.
 * @param timeoutMs Kill the process after this long and report exit code 1.
 * @returns The exit code and everything the process printed.
 */
export function runCli(
  args: string[],
  timeoutMs?: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const { cmd, args: cliArgs } = getCliCommand();
    const proc = spawn(cmd, [...cliArgs, ...args], {
      cwd: path.resolve(import.meta.dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, VITEST_WORKER_ID: undefined },
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    proc.on("error", reject);
  });
}

/**
 * Spawns a long-running CLI command (a server or worker) and waits until it
 * logs that it is available. Output is collected across chunks, so a ready
 * line split between two reads still counts.
 *
 * @param args CLI arguments, e.g. `["worker", "--port", "6280"]`.
 * @param env Extra environment variables; `undefined` removes one.
 * @param timeoutMs How long to wait for the ready line (default 30 s).
 * @returns The process and the URL from its "available at" line; stop it with `stopChildProcess`.
 */
export async function startCliServer(
  args: string[],
  env: Record<string, string | undefined> = {},
  timeoutMs = 30000,
): Promise<{ process: ChildProcess; url: string }> {
  const { cmd, args: cliArgs } = getCliCommand();
  const child = spawn(cmd, [...cliArgs, ...args], {
    cwd: path.resolve(import.meta.dirname, ".."),
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, VITEST_WORKER_ID: undefined, ...env },
  });

  const url = await new Promise<string>((resolve, reject) => {
    let output = "";
    let ready = false;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Server startup timed out. Output: ${output}`));
    }, timeoutMs);
    const handleOutput = (data: Buffer) => {
      if (ready) {
        return;
      }
      output += data.toString();
      const match = output.match(/available at (http:\/\/\S+)/);
      if (match) {
        ready = true;
        clearTimeout(timeout);
        resolve(match[1]);
      }
    };
    child.stdout?.on("data", handleOutput);
    child.stderr?.on("data", handleOutput);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`Server process error: ${error.message}`));
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited with code ${code}. Output: ${output}`));
    });
  });

  return { process: child, url };
}

/**
 * Starts a worker (`docs-mcp-server worker`) on a free loopback port.
 *
 * @param storePath The worker's store directory.
 * @param configPath The config file to start it with.
 * @param extraArgs More worker options, for example `["--no-resume"]`.
 * @returns The process and the worker's API URL; stop it with `stopChildProcess`.
 */
export async function startWorker(
  storePath: string,
  configPath: string,
  extraArgs: string[] = [],
): Promise<{ process: ChildProcess; url: string }> {
  return startCliServer(
    [
      "worker",
      "--host",
      "127.0.0.1",
      "--port",
      String(await getFreePort()),
      "--store-path",
      storePath,
      "--config",
      configPath,
      ...extraArgs,
    ],
    { LOG_LEVEL: "info", ...FTS_ONLY_ENV },
  );
}

/**
 * A TCP proxy to a loopback port. `cut()` drops every connection and stops
 * accepting until `listen()` runs again. With `blockUpgrades`, it answers
 * WebSocket upgrades with 403, like a reverse proxy without WebSocket support.
 *
 * @param targetPort The loopback port to forward to.
 * @param options.blockUpgrades Refuse WebSocket upgrades, pass everything else.
 */
export function createTcpProxy(
  targetPort: number,
  options: { blockUpgrades?: boolean } = {},
) {
  const sockets = new Set<net.Socket>();
  let server: net.Server | undefined;

  const forward = (client: net.Socket, first: Buffer | string) => {
    if (options.blockUpgrades && /^upgrade:\s*websocket/im.test(first.toString())) {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    const upstream = net.connect(targetPort, "127.0.0.1");
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on("error", () => socket.destroy());
      socket.on("close", () => {
        sockets.delete(socket);
        client.destroy();
        upstream.destroy();
      });
    }
    upstream.write(first);
    client.pipe(upstream).pipe(client);
  };

  return {
    /**
     * Starts accepting on `port` (a free one when omitted) and returns the
     * port; while it is accepting already, returns the port it uses.
     */
    async listen(port = 0): Promise<number> {
      if (server?.listening) return (server.address() as AddressInfo).port;
      const listener = net.createServer((client) =>
        client.once("data", (first) => forward(client, first)),
      );
      server = listener;
      await new Promise<void>((resolve, reject) => {
        listener.once("error", reject);
        listener.listen(port, "127.0.0.1", () => {
          listener.off("error", reject);
          resolve();
        });
      });
      return (listener.address() as AddressInfo).port;
    },
    /** Drops every connection and stops accepting new ones. */
    async cut(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    },
  };
}

/**
 * Submits a scrape of a slow site (see {@link startSlowSite}) to a worker and
 * waits until the job runs, so a test can act on a job that is in progress.
 *
 * @param api The worker's API client.
 * @param siteUrl The slow site's URL.
 * @param library The library to scrape it as.
 * @param version The version, or `null` for unversioned.
 * @returns The running job's id.
 */
export async function startRunningSlowJob(
  api: ApiClient,
  siteUrl: string,
  library: string,
  version: string | null,
): Promise<string> {
  // Limits far past the chain the site serves, so only a cancellation ends the job
  const options = {
    url: siteUrl,
    library,
    version: version ?? "",
    scrapeMode: ScrapeMode.Fetch,
    maxConcurrency: 1,
    maxDepth: 100_000,
    maxPages: 100_000,
  } as ScraperOptions;
  const { jobId } = await api.enqueueScrapeJob.mutate({ library, version, options });
  await vi.waitFor(
    async () => expect((await api.getJob.query({ id: jobId }))?.status).toBe("running"),
    { timeout: 30_000, interval: 200 },
  );
  return jobId;
}

/**
 * Writes an explicit config for a spawned CLI or server, so a test does not
 * depend on the machine's own configuration: FTS-only (no embedding calls), no
 * telemetry, and unrestricted `file://` access to fixtures, including hidden
 * path segments, since the checkout may itself sit under a hidden folder (e.g. a
 * worktree).
 *
 * @param dir Directory to write `config.yaml` into.
 * @param options.allowPrivateNetworks Let scrapes reach local test servers.
 * @param options.maxConcurrency How many jobs run at once; the default otherwise.
 * @param options.telemetryEnabled Turn telemetry on, for the suite that checks how it is switched off.
 * @returns The config file's path.
 */
export function writeTestConfig(
  dir: string,
  options: {
    allowPrivateNetworks?: boolean;
    maxConcurrency?: number;
    telemetryEnabled?: boolean;
  } = {},
): string {
  const configPath = path.join(dir, "config.yaml");
  fs.writeFileSync(
    configPath,
    [
      "app:",
      '  embeddingModel: ""',
      `  telemetryEnabled: ${options.telemetryEnabled ?? false}`,
      "scraper:",
      ...(options.maxConcurrency ? [`  maxConcurrency: ${options.maxConcurrency}`] : []),
      "  security:",
      "    fileAccess:",
      "      mode: unrestricted",
      "      includeHidden: true",
      ...(options.allowPrivateNetworks
        ? ["    network:", "      allowPrivateNetworks: true"]
        : []),
      "",
    ].join("\n"),
  );
  return configPath;
}

/**
 * Serves a chain of pages, each linking to the next and answering only after
 * `delayMs`, so a scrape of it keeps running until it is cancelled.
 *
 * @param delayMs How long each page takes to answer.
 * @returns The site's URL and a function that stops it.
 */
export async function startSlowSite(
  delayMs = 500,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const page = Number(request.url?.match(/\/p(\d+)/)?.[1] ?? 0);
    setTimeout(() => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        `<html><body><h1>Page ${page}</h1><p>Slow page ${page}.</p><a href="/p${page + 1}">next</a></body></html>`,
      );
    }, delayMs);
  });
  const port = await listenOnFreePort(server);
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * Puts `libraries` back into its shape before migration 017 and forgets 017, so
 * the next `applyMigrations` runs 017 against rows seeded in the old shape. Call
 * on a fully migrated database, before seeding.
 */
export function restorePre017Libraries(db: Database): void {
  db.exec(`
    DROP TABLE libraries;
    CREATE TABLE libraries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_libraries_lower_name ON libraries(LOWER(name));
    DELETE FROM _schema_migrations WHERE id = '017-add-library-display-name.sql';
  `);
}

/**
 * Launch headless Chromium for the browser E2E tests. CI installs only the
 * full Chromium build (`playwright install --no-shell`), so this asks for it
 * instead of the headless shell Playwright launches by default.
 * @returns The browser; close it when done.
 */
export function launchChromium(): Promise<Browser> {
  return chromium.launch({ channel: "chromium" });
}

/**
 * PIDs of the Chromium browsers this test process launched. Playwright starts
 * the browser as a direct child, talking to it over `--remote-debugging-pipe`;
 * its renderer and GPU helpers are children of the browser, not of this process.
 * Relies on `pgrep`, so it is not available on Windows.
 */
export function chromiumPids(): number[] {
  // pgrep exits with 1 when nothing matches, which spawnSync does not treat as
  // an error.
  const { stdout } = spawnSync(
    "pgrep",
    ["-P", String(process.pid), "-f", "remote-debugging-pipe"],
    { encoding: "utf8" },
  );
  return stdout.split("\n").filter(Boolean).map(Number);
}

/** Listen on a random loopback port and return it. */
export async function listenOnFreePort(server: net.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

/** Reserve a free loopback port and release it again. */
export async function getFreePort(): Promise<number> {
  const probe = createServer();
  const port = await listenOnFreePort(probe);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

/** A local OAuth authorization server for E2E tests. */
export interface LocalIssuer {
  /** The issuer identifier, e.g. `http://127.0.0.1:54321`. */
  url: string;
  /** Mint an access token. `aud` is omitted when not given; `keys` defaults to the issuer's own. */
  mint(claims: { aud?: string; iss?: string; exp?: number }, keys?: KeyPair): Promise<string>;
  /** A key pair the issuer does not publish, for signature tests. */
  foreignKeys: KeyPair;
  close(): Promise<void>;
}

/**
 * Start a local authorization server: an RS256 key pair, RFC 8414 metadata at
 * `/.well-known/oauth-authorization-server` and the key set at `/jwks`.
 */
export async function startLocalIssuer(): Promise<LocalIssuer> {
  const keys = await generateKeyPair("RS256");
  const foreignKeys = await generateKeyPair("RS256");
  const publicJwk: JWK = { ...(await exportJWK(keys.publicKey)), kid: "e2e-key", alg: "RS256" };
  let url = "";
  const server = createServer((request, response) => {
    const routes: Record<string, unknown> = {
      "/.well-known/oauth-authorization-server": { issuer: url, jwks_uri: `${url}/jwks` },
      "/jwks": { keys: [publicJwk] },
    };
    const body = routes[request.url ?? ""];
    if (body === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  url = `http://127.0.0.1:${await listenOnFreePort(server)}`;

  return {
    url,
    foreignKeys,
    async mint(claims, signingKeys = keys) {
      const jwt = new SignJWT({ client_id: "e2e-client", scope: "openid profile" })
        .setProtectedHeader({ alg: "RS256", kid: "e2e-key", typ: "at+jwt" })
        .setIssuer(claims.iss ?? url)
        .setSubject("user_e2e")
        .setIssuedAt()
        .setExpirationTime(claims.exp ?? "5m");
      if (claims.aud !== undefined) {
        jwt.setAudience(claims.aud);
      }
      return jwt.sign(signingKeys.privateKey);
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** How a {@link startPrefixProxy} forwards the base path to the upstream server. */
export type PrefixProxyMode = "strip" | "forward";

/**
 * A reverse proxy that serves an upstream server under `basePath` on a free
 * loopback port, standing in for nginx or Traefik. In `strip` mode it removes
 * the prefix before forwarding, in `forward` mode it keeps it. It also forwards
 * the RFC 9728 host-root metadata location and WebSocket upgrades.
 * @param upstreamPort - The port of the server behind the proxy.
 * @param basePath - The path prefix, e.g. `/docs`.
 * @returns The proxy's port, a mode switch and `close`.
 */
export async function startPrefixProxy(upstreamPort: number, basePath: string) {
  let mode: PrefixProxyMode = "strip";
  const hostRootMetadata = `/.well-known/oauth-protected-resource${basePath}/mcp`;

  const rewrite = (url: string): string | undefined => {
    const pathname = url.split("?")[0];
    if (pathname === hostRootMetadata) {
      return url;
    }
    if (pathname !== basePath && !url.startsWith(`${basePath}/`)) {
      return undefined;
    }
    if (mode === "forward") {
      return url;
    }
    const rest = url.slice(basePath.length);
    return rest.startsWith("/") ? rest : `/${rest}`;
  };

  const server: Server = createServer((request, response) => {
    const upstreamPath = rewrite(request.url ?? "/");
    if (upstreamPath === undefined) {
      response.writeHead(404, { "content-type": "text/plain" }).end("no proxy location\n");
      return;
    }
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: upstreamPort,
        method: request.method,
        path: upstreamPath,
        headers: request.headers,
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );
    upstream.on("error", () => response.writeHead(502).end());
    request.pipe(upstream);
  });

  server.on("upgrade", (request: IncomingMessage, socket: net.Socket, head: Buffer) => {
    const upstreamPath = rewrite(request.url ?? "/");
    if (upstreamPath === undefined) {
      socket.destroy();
      return;
    }
    const upstream = net.connect(upstreamPort, "127.0.0.1", () => {
      const headerLines: string[] = [];
      for (let i = 0; i < request.rawHeaders.length; i += 2) {
        headerLines.push(`${request.rawHeaders[i]}: ${request.rawHeaders[i + 1]}`);
      }
      upstream.write(
        `${request.method} ${upstreamPath} HTTP/1.1\r\n${headerLines.join("\r\n")}\r\n\r\n`,
      );
      if (head.length > 0) {
        upstream.write(head);
      }
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });

  const port = await listenOnFreePort(server);
  return {
    port,
    setMode(next: PrefixProxyMode) {
      mode = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * Open a WebSocket and report whether the server accepted the upgrade. Uses the
 * `ws` package rather than Node's global `WebSocket`, which the test setup's
 * MSW interceptor reports as open before the server has answered.
 * @param url - The `ws://` URL.
 * @param options - Client options, e.g. an `origin` to send; none by default.
 * @returns `"open"`, `"refused"`, or `"no answer"` when the server has not
 *   answered the upgrade within five seconds.
 */
export async function tryWebSocket(
  url: string,
  options: ClientOptions = {},
): Promise<"open" | "refused" | "no answer"> {
  const socket = new WebSocket(url, options);
  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve("no answer");
      socket.terminate();
    }, 5000);
    const settle = (outcome: "open" | "refused") => {
      clearTimeout(timer);
      resolve(outcome);
    };
    socket.on("open", () => {
      socket.close();
      settle("open");
    });
    socket.on("error", () => settle("refused"));
  });
}

/**
 * Send a request with an explicit `Host` header and no `Origin`, the way a
 * page on a DNS-rebound domain fetches its own origin.
 * @param url - The URL to request.
 * @param host - The `Host` header to send.
 * @param method - The HTTP method (default `GET`).
 * @returns The status code and the response body.
 */
export async function requestWithHost(
  url: string,
  host: string,
  method = "GET",
): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers: { host } }, (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on("error", reject);
    request.end();
  });
}

/**
 * Stop a spawned process: SIGTERM, then SIGKILL if it hasn't exited in time.
 * @param child - The process, if it was started.
 * @param timeoutMs - How long to wait for a clean exit (default 5 s).
 */
export async function stopChildProcess(
  child: ChildProcess | undefined,
  timeoutMs = 5000,
): Promise<void> {
  // A child killed by a signal keeps `exitCode` null and sets `signalCode`
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, timeoutMs);
    child.on("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}
