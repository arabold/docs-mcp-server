import type { AppConfig } from "./config";

/**
 * Normalize a configured public origin into a canonical URL origin.
 *
 * Empty strings are treated as absent so container environments can leave the
 * variable declared but unset.
 */
export function normalizePublicOrigin(origin: string | undefined): string | undefined {
  const trimmed = origin?.trim();
  if (!trimmed) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      "server.publicOrigin must be an absolute HTTP(S) origin without path, query, or fragment.",
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("server.publicOrigin must use the http or https protocol.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("server.publicOrigin must not include credentials.");
  }

  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(
      "server.publicOrigin must not include a path, query string, or fragment.",
    );
  }

  return parsed.origin;
}

/**
 * Build an HTTP origin from the local bind host and port.
 *
 * The server itself listens over HTTP; deployments that terminate TLS should
 * configure server.publicOrigin to advertise an HTTPS origin.
 */
export function buildBindOrigin(host: string, port: number): string {
  const formattedHost = formatHostForUrl(host);
  return new URL(`http://${formattedHost}:${port}`).origin;
}

/**
 * Resolve the canonical origin used for generated endpoint URLs.
 */
export function getCanonicalServerOrigin(config: AppConfig, port: number): string {
  return (
    normalizePublicOrigin(config.server.publicOrigin) ??
    buildBindOrigin(config.server.host, port)
  );
}

/**
 * Return true when a host value represents a wildcard bind address.
 */
export function isWildcardBindHost(host: string): boolean {
  const normalized = stripIpv6Brackets(host.trim().toLowerCase());
  return (
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    normalized === "::0" ||
    normalized === "0:0:0:0:0:0:0:0" ||
    normalized === "0000:0000:0000:0000:0000:0000:0000:0000"
  );
}

function formatHostForUrl(host: string): string {
  const trimmed = host.trim();
  const unbracketed = stripIpv6Brackets(trimmed);
  if (unbracketed.includes(":")) {
    return `[${unbracketed}]`;
  }
  return trimmed;
}

function stripIpv6Brackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}
