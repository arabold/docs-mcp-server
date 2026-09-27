import fs from "node:fs";
import http, { createServer, type IncomingMessage, type Server } from "node:http";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";

/**
 * Returns the command and arguments to run the CLI.
 * Prefers the built 'dist/index.js' if available for faster execution.
 * Falls back to 'npx vite-node src/index.ts' for development.
 */
export function getCliCommand(): { cmd: string; args: string[] } {
  const projectRoot = path.resolve(import.meta.dirname, "..");
  const distEntry = path.join(projectRoot, "dist", "index.js");

  // Check if dist/index.js exists
  if (fs.existsSync(distEntry)) {
    return { cmd: "node", args: [distEntry] };
  }

  // Fallback to vite-node
  const srcEntry = path.join(projectRoot, "src", "index.ts");
  return { cmd: "npx", args: ["vite-node", srcEntry] };
}

/** Listen on a random loopback port and return it. */
export async function listenOnFreePort(server: Server): Promise<number> {
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
    if (
      pathname !== basePath &&
      !url.startsWith(`${basePath}/`) &&
      !url.startsWith(`${basePath}?`)
    ) {
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
 * Open a WebSocket with Node's global client, the one the worker link uses
 * through tRPC, and report whether the upgrade succeeded.
 * @param url - The `ws://` URL.
 * @returns `"open"` or `"refused"`.
 */
export async function tryNodeWebSocket(url: string): Promise<"open" | "refused"> {
  const socket = new WebSocket(url);
  return await new Promise((resolve) => {
    socket.addEventListener("open", () => {
      socket.close();
      resolve("open");
    });
    socket.addEventListener("error", () => resolve("refused"));
  });
}
