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
