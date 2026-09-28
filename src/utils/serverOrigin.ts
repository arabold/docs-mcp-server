import type { AppConfig } from "./config";

/**
 * Normalize a configured origin (`scheme://host[:port]`) into its canonical form.
 *
 * Empty strings are treated as absent so container environments can leave the
 * variable declared but unset.
 *
 * @param origin - The configured value.
 * @param settingName - The setting named in error messages.
 * @returns The canonical origin, or `undefined` when absent.
 * @throws Error naming the setting when the value is not an HTTP(S) origin.
 */
export function normalizePublicOrigin(
  origin: string | undefined,
  settingName = "server.publicOrigin",
): string | undefined {
  const configured = parseConfiguredUrl(
    origin,
    settingName,
    "origin without path, query, or fragment",
  );
  if (!configured) {
    return undefined;
  }
  const { parsed } = configured;

  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`${settingName} must not include a path, query string, or fragment.`);
  }

  return parsed.origin;
}

/**
 * First path segments of the server's own root routes. A public URL must not
 * start with one: stripping such a base path from a request the proxy already
 * stripped would remove the route itself (`/mcp` under a base path of `/mcp`
 * would become `/`). These paths also never fall back to the web UI.
 */
export const RESERVED_ROOT_SEGMENTS: readonly string[] = [
  "mcp",
  "api",
  "assets",
  ".well-known",
  "sse",
  "messages",
];

/**
 * Normalize a configured public URL: an absolute HTTP(S) URL that may carry a
 * path, returned without a trailing slash.
 *
 * Empty strings are treated as absent so container environments can leave the
 * variable declared but unset.
 *
 * @param value - The configured `server.publicUrl` value.
 * @returns The canonical URL (e.g. `https://example.com/docs`), or `undefined` when absent.
 * @throws Error naming `server.publicUrl` when the value has credentials, a query
 *   string, a fragment, a non-HTTP(S) protocol, or a first path segment that
 *   collides with a route the server serves at its root.
 */
export function normalizePublicUrl(value: string | undefined): string | undefined {
  const configured = parseConfiguredUrl(
    value,
    "server.publicUrl",
    "URL without query string or fragment",
  );
  if (!configured) {
    return undefined;
  }
  const { parsed, trimmed } = configured;

  if (parsed.search || parsed.hash || trimmed.includes("?") || trimmed.includes("#")) {
    throw new Error("server.publicUrl must not include a query string or fragment.");
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  const firstSegment = path.split("/")[1]?.toLowerCase();
  if (firstSegment && RESERVED_ROOT_SEGMENTS.includes(firstSegment)) {
    throw new Error(
      `server.publicUrl path must not start with "/${firstSegment}": the server serves its own route there, so requests could not be told apart. Choose a different path, such as "/docs".`,
    );
  }

  return `${parsed.origin}${path}`;
}

/**
 * Parse a configured HTTP(S) URL and apply the checks every such setting shares.
 * Empty values count as absent.
 * @returns The parsed URL and the trimmed input, or `undefined` when absent.
 * @throws Error naming the setting when the value is not an HTTP(S) URL or has credentials.
 */
function parseConfiguredUrl(
  value: string | undefined,
  settingName: string,
  expectedShape: string,
): { parsed: URL; trimmed: string } | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${settingName} must be an absolute HTTP(S) ${expectedShape}.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${settingName} must use the http or https protocol.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${settingName} must not include credentials.`);
  }

  return { parsed, trimmed };
}

/**
 * Where clients reach the server, split into the parts that URL generation and
 * request routing need.
 */
export interface PublicLocation {
  /**
   * Whether an operator configured the location (`server.publicUrl` or the
   * deprecated `server.publicOrigin`), rather than it being derived from the bind address.
   */
  configured: boolean;
  /** Canonical base URL without a trailing slash, e.g. `https://example.com/docs`. */
  url: string;
  /** Scheme, host and port, e.g. `https://example.com`. */
  origin: string;
  /** Path prefix without a trailing slash: `""` or e.g. `/docs`. */
  basePath: string;
}

/**
 * Resolve the public location from configuration: `server.publicUrl` first,
 * then the deprecated `server.publicOrigin`, then the bind-derived origin.
 *
 * @param config - The loaded application configuration.
 * @param port - The port this process listens on (used for the bind fallback).
 * @returns The resolved public location.
 * @throws Error when a configured value is invalid (configuration loading
 *   normally rejects those earlier).
 */
export function resolvePublicLocation(config: AppConfig, port: number): PublicLocation {
  const configuredUrl =
    normalizePublicUrl(config.server.publicUrl) ??
    normalizePublicOrigin(config.server.publicOrigin);
  const url = configuredUrl ?? buildBindOrigin(config.server.host, port);
  const origin = new URL(url).origin;
  return {
    configured: configuredUrl !== undefined,
    url,
    origin,
    basePath: url.slice(origin.length),
  };
}

/**
 * Describe deprecation problems with the configured public location, for the
 * caller to log at startup.
 *
 * @param config - The loaded application configuration.
 * @returns Warning messages; empty when nothing needs attention.
 */
export function describePublicLocationWarnings(config: AppConfig): string[] {
  const hasUrl = Boolean(config.server.publicUrl?.trim());
  const hasOrigin = Boolean(config.server.publicOrigin?.trim());
  if (hasUrl && hasOrigin) {
    return [
      "server.publicOrigin is ignored because server.publicUrl is also set. Remove server.publicOrigin.",
    ];
  }
  if (hasOrigin) {
    return ["server.publicOrigin is deprecated. Use server.publicUrl instead."];
  }
  return [];
}

/**
 * Build an HTTP origin from the local bind host and port.
 *
 * The server itself listens over HTTP; deployments that terminate TLS should
 * configure server.publicUrl to advertise an HTTPS URL.
 */
export function buildBindOrigin(host: string, port: number): string {
  const formattedHost = formatHostForUrl(host);
  return new URL(`http://${formattedHost}:${port}`).origin;
}

function formatHostForUrl(host: string): string {
  const trimmed = host.trim();
  const unbracketed = stripIpv6Brackets(trimmed);
  if (unbracketed.includes(":")) {
    return `[${unbracketed}]`;
  }
  return trimmed;
}

/**
 * Remove the brackets around an IPv6 address literal, as URLs and `Host`
 * headers write it. Other values are returned unchanged.
 * @param host - A host, e.g. `[::1]` or `example.com`.
 * @returns The host without brackets, e.g. `::1`.
 */
export function stripIpv6Brackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}
