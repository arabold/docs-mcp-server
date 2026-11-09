/**
 * User agent browser contexts fall back to when no caller or fingerprint value
 * is available. Bump the Chrome version when it starts looking implausibly old
 * to the anti-bot heuristics this exists to satisfy.
 */
export const DEFAULT_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/**
 * Reads a header by name, ignoring case.
 *
 * HTTP header names are case-insensitive, but caller-supplied headers arrive as
 * a plain object, so `headers["User-Agent"]` misses a caller who wrote
 * `user-agent`.
 *
 * @param headers Caller-supplied request headers.
 * @param name The header name to look up.
 * @returns The matching value, or undefined when absent.
 */
export function getHeader(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const target = name.toLowerCase();
  for (const [header, value] of Object.entries(headers)) {
    if (header.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

/**
 * Connection-level headers, which the client that opens a connection sets for
 * itself. Chromium refuses to take them from a page: a navigation that carries
 * one fails with `net::ERR_INVALID_ARGUMENT`. Generated Firefox fingerprints
 * include `TE: trailers`, and a few include `Connection: keep-alive`.
 */
const CONNECTION_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie2",
  "host",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Returns headers without the connection-level ones.
 *
 * A generated fingerprint copies a browser's headers, connection-level ones
 * included. The HTTP client that sends the request manages its own connection
 * and sets these itself: a copied `Connection: keep-alive` asks the server to
 * hold open a connection the client may never reuse.
 *
 * @param headers Request headers, such as a generated fingerprint.
 * @returns The headers minus any connection-level entry, in any letter case.
 */
export function withoutConnectionHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([header]) => !CONNECTION_HEADERS.has(header.toLowerCase()),
    ),
  );
}

/**
 * Returns headers without the ones Chromium sets for itself.
 *
 * A browser sets the `Sec-Fetch-*` family with values that fit each request: a
 * script gets `Sec-Fetch-Dest: script`, not the `document` of the page that
 * loads it. While Playwright intercepts requests, Chromium fails every
 * sub-resource request that carries an overridden one with
 * `net::ERR_INVALID_ARGUMENT`. Connection-level headers, such as `TE` or
 * `Transfer-Encoding`, belong to the browser's own connections, and Chromium
 * fails the navigation itself when a page asks for one.
 *
 * @param headers Request headers, such as a generated fingerprint.
 * @returns The headers minus any `Sec-Fetch-*` or connection-level entry, in
 * any letter case.
 */
export function withoutBrowserManagedHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(withoutConnectionHeaders(headers)).filter(
      ([header]) => !header.toLowerCase().startsWith("sec-fetch-"),
    ),
  );
}
