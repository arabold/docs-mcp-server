export const MARKDOWN_PREFERRED_ACCEPT = "text/markdown, text/html;q=0.9, */*;q=0.8";

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
