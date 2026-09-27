#!/usr/bin/env vite-node

/**
 * Live end-to-end check of MCP authentication against a Clerk development
 * instance. Not part of `npm test`: it needs the Clerk CLI and one browser
 * sign-in.
 *
 * What it does:
 * 1. Uses the Clerk CLI to find the instance's issuer and check the OAuth
 *    settings the server needs (optionally turning them on).
 * 2. Starts the built CLI behind a local proxy that serves it under `/docs`
 *    and strips the prefix, with authentication enabled through environment
 *    variables only.
 * 3. Connects the SDK client pinned to protocol 2026-07-28. It discovers the
 *    metadata from the 401 challenge, registers itself with Clerk, and opens
 *    the sign-in page in the browser. After sign-in it lists and calls tools.
 * 4. Checks the token's `aud` and `iss`, the challenge, the metadata, and that
 *    a tampered token is rejected.
 * 5. Deletes the OAuth client it registered, unless `--keep-client` is passed.
 *
 * Usage:
 *   npm run test:auth:clerk -- --app <app_id> [--instance dev] [--fix-settings] [--keep-client] [--verbose]
 *
 * `CLERK_APP_ID` can replace `--app`, and `CLERK_BIN` points at a Clerk CLI
 * that is not on the PATH.
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http, { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  Client,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import { decodeJwt } from "jose";
import { getCliCommand, getFreePort, listenOnFreePort } from "./test-helpers";

const BASE_PATH = "/docs";
const CLIENT_NAME = "docs-mcp-server auth E2E (safe to delete)";
const SCOPE = "openid profile email";
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

/** Settings the server needs on the Clerk instance, and the value each must have. */
const REQUIRED_SETTINGS = {
  dynamic_oauth_client_registration: true,
  oauth_jwt_access_tokens: true,
  aud_claim_enabled: true,
  pkce_required: true,
} as const;

const { values: options } = parseArgs({
  options: {
    app: { type: "string", default: process.env.CLERK_APP_ID },
    instance: { type: "string", default: "dev" },
    "fix-settings": { type: "boolean", default: false },
    "keep-client": { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
  },
});

const results: { name: string; ok: boolean }[] = [];

/** Record and print one check. */
function check(name: string, ok: boolean, detail?: string): boolean {
  results.push({ name, ok });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` (${detail})` : ""}`);
  return ok;
}

/** Run `clerk api` against the selected app and instance and parse its JSON output. */
function clerkApi(endpoint: string, extra: string[] = []): unknown {
  if (!options.app) {
    throw new Error("Pass --app <app_id> or set CLERK_APP_ID (see `clerk apps list`).");
  }
  const bin = process.env.CLERK_BIN ?? "clerk";
  const args = ["api", endpoint, "--app", options.app, "--instance", options.instance, ...extra];
  const result = spawnSync(bin, args, { encoding: "utf8" });
  if (result.error) {
    throw new Error(`Could not run the Clerk CLI (${bin}): ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`clerk ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim() ? JSON.parse(result.stdout) : undefined;
}

/** A proxy that serves `upstreamPort` under `/docs`, strips the prefix, and forwards the RFC 9728 host-root metadata path. */
async function startProxy(upstreamPort: number): Promise<{ port: number; close: () => Promise<void> }> {
  const hostRootMetadata = `/.well-known/oauth-protected-resource${BASE_PATH}/mcp`;
  const server: Server = createServer((request, response) => {
    const url = request.url ?? "/";
    let upstreamPath: string | undefined;
    if (url.split("?")[0] === hostRootMetadata) {
      upstreamPath = url;
    } else if (url === BASE_PATH || url.startsWith(`${BASE_PATH}/`)) {
      upstreamPath = url.slice(BASE_PATH.length) || "/";
    }
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
  const port = await listenOnFreePort(server);
  return {
    port,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Start the built CLI with authentication configured through the environment only. */
async function startDocsServer(options: {
  port: number;
  publicUrl: string;
  issuerUrl: string;
  storeDir: string;
}): Promise<{ child: ChildProcess; output: () => string }> {
  const configPath = path.join(options.storeDir, "config.yaml");
  writeFileSync(configPath, "");
  const { cmd, args } = getCliCommand();
  const child = spawn(cmd, [...args, "--protocol", "http", "--port", String(options.port)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      DOCS_MCP_AUTH_ENABLED: "true",
      DOCS_MCP_AUTH_ISSUER_URL: options.issuerUrl,
      DOCS_MCP_AUTH_AUDIENCE: "",
      DOCS_MCP_SERVER_PUBLIC_URL: options.publicUrl,
      DOCS_MCP_STORE_PATH: options.storeDir,
      DOCS_MCP_CONFIG: configPath,
      DOCS_MCP_EMBEDDING_MODEL: "",
      DOCS_MCP_TELEMETRY: "false",
      LOG_LEVEL: "info",
    },
  });
  let output = "";
  child.stdout?.on("data", (data: Buffer) => {
    output += data.toString();
  });
  child.stderr?.on("data", (data: Buffer) => {
    output += data.toString();
  });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited with code ${child.exitCode}:\n${output}`);
    }
    try {
      await fetch(`http://127.0.0.1:${options.port}/mcp`);
      return { child, output: () => output };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  child.kill("SIGKILL");
  throw new Error(`Server did not start within 60 seconds:\n${output}`);
}

async function stopDocsServer(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.on("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

/** Wait for the browser to come back to the redirect URI with the authorization response. */
function startCallbackServer(): Promise<{ redirectUri: string; response: Promise<URLSearchParams> }> {
  return new Promise((resolveServer) => {
    let resolveResponse: (params: URLSearchParams) => void = () => {};
    let rejectResponse: (error: Error) => void = () => {};
    const response = new Promise<URLSearchParams>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    const server = createServer((request, reply) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        reply.writeHead(404).end();
        return;
      }
      reply
        .writeHead(200, { "content-type": "text/plain" })
        .end("Signed in. You can close this tab and return to the terminal.\n");
      clearTimeout(timer);
      server.close();
      resolveResponse(url.searchParams);
    });
    const timer = setTimeout(() => {
      server.close();
      rejectResponse(new Error("Timed out after 5 minutes waiting for the browser sign-in"));
    }, SIGN_IN_TIMEOUT_MS);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolveServer({ redirectUri: `http://127.0.0.1:${port}/callback`, response });
    });
  });
}

/** An in-memory OAuth client that hands the authorization URL to the script instead of redirecting. */
class ScriptOAuthProvider implements OAuthClientProvider {
  authorizationUrl: URL | undefined;
  readonly expectedState = randomBytes(16).toString("base64url");
  private information: StoredOAuthClientInformation | undefined;
  private storedTokens: StoredOAuthTokens | undefined;
  private discovery: OAuthDiscoveryState | undefined;
  private verifier = "";

  constructor(private readonly callbackUrl: string) {}

  get redirectUrl(): string {
    return this.callbackUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: CLIENT_NAME,
      redirect_uris: [this.callbackUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    };
  }

  state(): string {
    return this.expectedState;
  }

  clientInformation(): StoredOAuthClientInformation | undefined {
    return this.information;
  }

  saveClientInformation(information: StoredOAuthClientInformation): void {
    this.information = information;
  }

  tokens(): StoredOAuthTokens | undefined {
    return this.storedTokens;
  }

  saveTokens(tokens: StoredOAuthTokens): void {
    this.storedTokens = tokens;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier;
  }

  codeVerifier(): string {
    return this.verifier;
  }

  // Kept so the SDK can check that the callback comes from the authorization
  // server it discovered (SEP-2352).
  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.discovery = state;
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.discovery;
  }
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(command, [url], {
      stdio: "ignore",
      detached: true,
      shell: process.platform === "win32",
    }).unref();
  } catch {
    // The URL is printed as well.
  }
}

function newClient(): Client {
  return new Client(
    { name: "docs-mcp-server-auth-e2e", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
}

async function postToolsList(mcpUrl: string, token?: string): Promise<Response> {
  return await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/list",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
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
  });
}

/** Delete the OAuth application Clerk created for `clientId` through dynamic registration. */
function deleteRegisteredClient(clientId: string): void {
  const list = clerkApi("/oauth_applications?limit=100") as {
    data?: { id: string; client_id: string; name: string }[];
  };
  const application = list.data?.find((item) => item.client_id === clientId);
  if (!application) {
    console.log(`⚠️  Registered client ${clientId} not found in Clerk; delete it in the dashboard.`);
    return;
  }
  clerkApi(`/oauth_applications/${application.id}`, ["-X", "DELETE", "--yes"]);
  console.log(`🧹 Deleted OAuth application ${application.id} ("${application.name}")`);
}

async function main(): Promise<void> {
  // 1. Clerk instance
  const domains = clerkApi("/domains") as { data: { frontend_api_url: string }[] };
  const issuerUrl = domains.data[0]?.frontend_api_url;
  if (!issuerUrl) {
    throw new Error("The Clerk instance reports no frontend API URL.");
  }
  console.log(`🔗 Clerk issuer: ${issuerUrl}`);

  const settings = clerkApi("/instance/oauth_application_settings") as Record<string, unknown>;
  const missing = Object.entries(REQUIRED_SETTINGS).filter(
    ([name, value]) => settings[name] !== value,
  );
  if (missing.length > 0 && options["fix-settings"]) {
    clerkApi("/instance/oauth_application_settings", [
      "-X",
      "PATCH",
      "--yes",
      "-d",
      JSON.stringify(Object.fromEntries(missing)),
    ]);
    console.log(`🔧 Turned on: ${missing.map(([name]) => name).join(", ")}`);
  } else if (missing.length > 0) {
    check("Clerk OAuth settings", false, `off: ${missing.map(([name]) => name).join(", ")}; rerun with --fix-settings`);
    return;
  }
  check("Clerk OAuth settings", true, Object.keys(REQUIRED_SETTINGS).join(", "));

  // 2. Server behind a prefix-stripping proxy
  const storeDir = mkdtempSync(path.join(tmpdir(), "docs-mcp-clerk-e2e-"));
  const upstreamPort = await getFreePort();
  const proxy = await startProxy(upstreamPort);
  const publicUrl = `http://127.0.0.1:${proxy.port}${BASE_PATH}`;
  const mcpUrl = `${publicUrl}/mcp`;
  const metadataUrl = `${publicUrl}/.well-known/oauth-protected-resource/mcp`;
  let server: Awaited<ReturnType<typeof startDocsServer>> | undefined;
  let registeredClientId: string | undefined;
  let completed = false;

  try {
    server = await startDocsServer({ port: upstreamPort, publicUrl, issuerUrl, storeDir });
    console.log(`🚀 Server running at ${publicUrl} (upstream port ${upstreamPort})`);
    check(
      "Startup output names the protected endpoint",
      server.output().includes(`Authentication: protects ${mcpUrl} only`),
    );

    // 3. Unauthenticated surface
    const challenge = await postToolsList(mcpUrl);
    check(
      "Request without a token gets 401 with resource_metadata",
      challenge.status === 401 &&
        challenge.headers.get("www-authenticate") === `Bearer resource_metadata="${metadataUrl}"`,
      `${challenge.status} ${challenge.headers.get("www-authenticate") ?? ""}`,
    );
    for (const [label, url] of [
      ["advertised", metadataUrl],
      ["RFC 9728 host-root", `http://127.0.0.1:${proxy.port}/.well-known/oauth-protected-resource${BASE_PATH}/mcp`],
    ]) {
      const response = await fetch(url);
      const document = (await response.json().catch(() => ({}))) as {
        resource?: string;
        authorization_servers?: string[];
      };
      check(
        `Protected resource metadata at the ${label} location`,
        response.status === 200 &&
          document.resource === mcpUrl &&
          document.authorization_servers?.[0] === issuerUrl,
        `resource ${document.resource}`,
      );
    }

    // 4. Discovery, registration and sign-in through the SDK
    const callback = await startCallbackServer();
    const provider = new ScriptOAuthProvider(callback.redirectUri);
    const firstTransport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
      authProvider: provider,
    });
    try {
      await newClient().connect(firstTransport);
      check("Client is asked to sign in", false, "connected without a token");
      return;
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) {
        throw error;
      }
    }
    registeredClientId = provider.clientInformation()?.client_id;
    check("Client registered itself with Clerk", Boolean(registeredClientId), registeredClientId);
    const authorizationUrl = provider.authorizationUrl;
    if (!authorizationUrl) {
      throw new Error("The SDK did not produce an authorization URL.");
    }
    check(
      "Authorization request names this server as the resource",
      authorizationUrl.searchParams.get("resource") === mcpUrl,
      authorizationUrl.searchParams.get("resource") ?? "missing",
    );

    console.log(`\n👉 Sign in in the browser. If it does not open, visit:\n${authorizationUrl}\n`);
    openBrowser(authorizationUrl.toString());
    const params = await callback.response;
    if (params.get("error")) {
      throw new Error(`Authorization failed: ${params.get("error")} ${params.get("error_description") ?? ""}`);
    }
    if (params.get("state") !== provider.expectedState) {
      throw new Error("State mismatch in the authorization response; aborting.");
    }
    await firstTransport.finishAuth(params);

    // 5. Authenticated MCP session
    const client = newClient();
    await client.connect(
      new StreamableHTTPClientTransport(new URL(mcpUrl), { authProvider: provider }),
    );
    try {
      check("Session uses protocol 2026-07-28", client.getProtocolEra() === "modern");
      const tools = await client.listTools();
      check(
        "Tools are listed with the token",
        tools.tools.some((tool) => tool.name === "search_docs"),
        `${tools.tools.length} tools`,
      );
      const libraries = await client.callTool({ name: "list_libraries", arguments: {} });
      check("A tool call succeeds", !libraries.isError);
    } finally {
      await client.close();
    }

    const accessToken = provider.tokens()?.access_token ?? "";
    const claims = decodeJwt(accessToken);
    const audiences = [claims.aud ?? []].flat();
    console.log(
      `   token claims: iss=${claims.iss} aud=${JSON.stringify(claims.aud)} sub=${claims.sub} scope=${String(claims.scope ?? "-")}`,
    );
    check("Token audience is the MCP endpoint", audiences.includes(mcpUrl));
    check("Token issuer is the Clerk instance", claims.iss === issuerUrl);

    const tampered = `${accessToken.slice(0, -2)}${accessToken.endsWith("AA") ? "BB" : "AA"}`;
    const rejected = await postToolsList(mcpUrl, tampered);
    check(
      "A tampered token is rejected",
      rejected.status === 401 &&
        (rejected.headers.get("www-authenticate") ?? "").includes('error="invalid_token"'),
      String(rejected.status),
    );
    completed = true;
  } finally {
    await stopDocsServer(server?.child);
    await proxy.close();
    if (options.verbose || !completed || results.some((result) => !result.ok)) {
      console.log(`\n--- server output ---\n${server?.output() ?? ""}`);
    }
    rmSync(storeDir, { recursive: true, force: true });
    if (registeredClientId && !options["keep-client"]) {
      deleteRegisteredClient(registeredClientId);
    }
  }
}

try {
  await main();
} catch (error) {
  check("Run completed", false, error instanceof Error ? error.message : String(error));
}
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${failed === 0 ? "✅ All" : `❌ ${failed} of`} ${results.length} checks ${failed === 0 ? "passed" : "failed"}`);
process.exit(failed === 0 ? 0 : 1);
