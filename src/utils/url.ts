import psl from "psl";
import { InvalidUrlError } from "./errors";
import { MimeTypeUtils } from "./mimeTypeUtils";

interface UrlNormalizerOptions {
  removeHash?: boolean;
  removeTrailingSlash?: boolean;
  removeQuery?: boolean;
  removeIndex?: boolean;
}

const defaultNormalizerOptions: UrlNormalizerOptions = {
  removeHash: true,
  removeTrailingSlash: true,
  removeQuery: false,
  removeIndex: true,
};

export function normalizeUrl(
  url: string,
  options: UrlNormalizerOptions = defaultNormalizerOptions,
): string {
  try {
    const finalOptions = { ...defaultNormalizerOptions, ...options };
    const normalized = new URL(url);

    // Captured before the reset below, so the URL is parsed once rather than twice.
    const originalHash = normalized.hash;
    const originalSearch = normalized.search;

    // Reset search and hash for the normalized base
    normalized.search = "";
    normalized.hash = "";

    // Remove index files first, before handling trailing slashes
    if (finalOptions.removeIndex) {
      normalized.pathname = normalized.pathname.replace(
        /\/index\.(html|htm|asp|php|jsp)$/i,
        "/",
      );
    }

    // Handle trailing slash
    if (finalOptions.removeTrailingSlash && normalized.pathname.length > 1) {
      normalized.pathname = normalized.pathname.replace(/\/+$/, "");
    }

    // Keep original parts we want to preserve
    const preservedHash = !finalOptions.removeHash ? originalHash : "";
    const preservedSearch = !finalOptions.removeQuery ? originalSearch : "";

    // Construct final URL string
    // Use href to get the full string, but we need to re-assemble if we want query/hash specific control
    // Easier: use the modified normalized object
    if (!finalOptions.removeQuery) {
      normalized.search = preservedSearch;
    }
    if (!finalOptions.removeHash) {
      normalized.hash = preservedHash;
    }

    // Case is deliberately left alone. A URL path, query and fragment are
    // case-sensitive, so folding them can merge two different documents into
    // one — and since this value is the crawl's dedup key, the second one is
    // then never fetched. Servers that do serve paths case-insensitively will
    // index a page twice instead, which is the failure that leaves evidence.
    return normalized.href;
  } catch {
    return url; // Return original URL if parsing fails
  }
}

/**
 * Validates if a string is a valid URL
 * @throws {InvalidUrlError} If the URL is invalid
 */
export function validateUrl(url: string): void {
  try {
    new URL(url);
  } catch (error) {
    throw new InvalidUrlError(url, error instanceof Error ? error : undefined);
  }
}

/**
 * Extracts the primary/registrable domain from a hostname using the public suffix list.
 * This properly handles complex TLDs like .co.uk, .com.au, etc.
 *
 * Examples:
 * - docs.python.org -> python.org
 * - api.github.com -> github.com
 * - example.co.uk -> example.co.uk
 * - user.github.io -> user.github.io (special case for GitHub Pages)
 * - localhost -> localhost
 * - 192.168.1.1 -> 192.168.1.1 (IP addresses returned as-is)
 */
export function extractPrimaryDomain(hostname: string): string {
  // Handle IP addresses - return as-is
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || /^[0-9a-fA-F:]+$/.test(hostname)) {
    return hostname;
  }

  // Handle localhost and other single-part hostnames
  if (!hostname.includes(".")) {
    return hostname;
  }

  // Use public suffix list for accurate domain extraction
  const domain = psl.get(hostname.toLowerCase());
  return domain || hostname; // Fallback to original hostname if psl fails
}

export type { UrlNormalizerOptions };

/**
 * Rewrites a published Markdown file's URL to the page it represents.
 *
 * `https://example.com/guide.md` and `https://example.com/guide` name the same
 * document, so they must share one identity — otherwise a site whose `llms.txt`
 * lists `.md` URLs is indexed twice, once per spelling.
 *
 * The extension is only half the test. Callers SHALL also establish that the
 * response really was Markdown, because a server that ignores the extension and
 * answers with HTML or a soft error would otherwise fold a page onto an identity
 * that does not serve it.
 *
 * @param url The absolute URL the content was fetched from.
 * @returns The page URL, or `url` unchanged when the path names no Markdown file.
 */
export function stripMarkdownExtension(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  // Gated on the shared detector rather than on "has a dot", so the name stays
  // true and the set of Markdown extensions has one home. The pathname is passed
  // deliberately: given a whole URL the detector would read a host like
  // `example.md` as a Markdown file.
  const detected = MimeTypeUtils.detectMimeTypeFromPath(parsed.pathname);
  if (!detected || !MimeTypeUtils.isMarkdown(detected)) return url;

  // A leading dot is not an extension separator, so `/.md` is left alone — it
  // names no page to fold onto.
  const stripped = parsed.pathname.replace(/([^/])\.[^/.]*$/, "$1");
  if (stripped === parsed.pathname) return url;

  parsed.pathname = stripped;
  return parsed.toString();
}
