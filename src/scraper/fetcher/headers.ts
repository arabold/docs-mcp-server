export const MARKDOWN_PREFERRED_ACCEPT = "text/markdown, text/html;q=0.9, */*;q=0.8";

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
 * Returns headers with a Markdown-preferred Accept default unless one was supplied.
 * @param headers Existing request headers.
 * @returns Headers with an Accept value suitable for web scraping.
 */
export function withMarkdownPreferredAccept(
  headers: Record<string, string>,
  callerHeaders: Record<string, string> = {},
): Record<string, string> {
  const hasCallerAccept = Object.keys(callerHeaders).some(
    (header) => header.toLowerCase() === "accept",
  );

  if (hasCallerAccept) {
    return headers;
  }

  const withoutGeneratedAccept = Object.fromEntries(
    Object.entries(headers).filter(([header]) => header.toLowerCase() !== "accept"),
  );

  return {
    ...withoutGeneratedAccept,
    Accept: MARKDOWN_PREFERRED_ACCEPT,
  };
}
