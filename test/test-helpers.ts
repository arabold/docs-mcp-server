import fs from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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
