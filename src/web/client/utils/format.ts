/**
 * Cross-page formatting helpers shared by more than one screen. Page-specific
 * formatters (e.g. the Jobs page's verbose relative time, or the Library
 * pages' version-label wording) stay next to their page — only genuinely
 * general-purpose, identical-everywhere helpers belong here.
 */

/** Strips the protocol from a URL for compact display, e.g. "react.dev/reference". */
export function displayUrl(url: string | null | undefined): string {
  if (!url) return "";
  return url.replace(/^https?:\/\//, "");
}

/**
 * Formats a past `Date` as a compact relative time: "now", "5m ago", "3h ago",
 * "2d ago", "4w ago". Callers handle the null/empty case with their own label
 * (e.g. "—" vs "just now"), since that presentation is context-specific.
 */
export function formatRelativeShort(date: Date): string {
  const diffMin = Math.round((Date.now() - date.getTime()) / 60_000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return `${Math.round(diffDay / 7)}w ago`;
}

/**
 * Whether a source URL points at the local filesystem, and so is handled by
 * `LocalFileStrategy` rather than a web strategy. Deliberately an exact,
 * case-sensitive prefix test: it must agree with the server-side routing in
 * `ScraperRegistry`, which would not send `FILE://…` to the local strategy.
 * @param url Source URL to test; `null`/`undefined`/empty read as non-local.
 * @returns True when the URL is a local `file://` URL.
 */
export function isLocalFileUrl(url: string | null | undefined): boolean {
  return Boolean(url?.trim().startsWith("file://"));
}

/**
 * Returns a URL's host (host:port), dropping protocol and path — e.g.
 * `http://127.0.0.1:8080/api` → "127.0.0.1:8080". Falls back to the
 * protocol-stripped string when the input isn't a parseable URL.
 */
export function displayHost(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return displayUrl(url);
  }
}
