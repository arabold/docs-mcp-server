// Utility for scope filtering, extracted from WebScraperStrategy
import type { URL } from "node:url";
import { extractPrimaryDomain } from "../../utils/url";

const INDEX_FILE_PATTERN = /^index(\.[a-z0-9]+)?$/i;

/**
 * Extensions that mark a URL's last segment as a page rather than a directory.
 * Kept in step with the document formats {@link MimeTypeUtils} recognizes.
 */
const PAGE_FILE_EXTENSION_PATTERN =
  /\.(?:html?|xhtml|php|aspx?|jsp|mdx?|markdown|txt|rst|adoc|json|ya?ml|xml|pdf)$/i;

/**
 * Returns true when a URL path names a page rather than a directory.
 *
 * An extension alone is too loose — a version directory like `/docs/v1.0` ends
 * in `.0` — so only known page extensions count, plus the bare `index` form
 * that {@link computeBaseDirectory} already treats as a file.
 *
 * @param pathname The URL pathname to classify.
 * @returns Whether the last segment names a file.
 */
export function isFileLikePath(pathname: string): boolean {
  const lastSegment = pathname.split("/").filter(Boolean).at(-1);
  if (!lastSegment) {
    return false;
  }
  return (
    PAGE_FILE_EXTENSION_PATTERN.test(lastSegment) || INDEX_FILE_PATTERN.test(lastSegment)
  );
}

/**
 * Compute the effective base directory for scope=subpages.
 * Rules:
 * - Empty path or "/" → "/"
 * - Path ending with "/" → returned unchanged
 * - Last segment matches /^index(\.[a-z0-9]+)?$/i (case-insensitive, extension optional)
 *   → parent directory with trailing slash. Covers /api/index, /api/index.html, /api/Index.HTML, etc.
 * - Otherwise → path with trailing slash appended (path is treated as a directory)
 */
export function computeBaseDirectory(pathname: string): string {
  if (pathname === "" || pathname === "/") return "/";
  if (pathname.endsWith("/")) return pathname;
  const lastSegment = pathname.split("/").at(-1) || "";
  if (INDEX_FILE_PATTERN.test(lastSegment)) {
    return pathname.replace(/\/[^/]*$/, "/");
  }
  return `${pathname}/`;
}

/**
 * Returns true when `childPath` is the same as `parentPath` or is a path-descendant of it.
 * `parentPath` is normalized to end with "/" before comparison so directory semantics apply.
 *
 * Examples:
 * - isPathDescendant("/api", "/api") → true (equal after normalization)
 * - isPathDescendant("/api", "/api/") → true
 * - isPathDescendant("/api", "/api/foo") → true
 * - isPathDescendant("/api", "/api~hash") → false (siblingwise, not under /api/)
 * - isPathDescendant("/api", "/blog") → false
 */
export function isPathDescendant(parentPath: string, childPath: string): boolean {
  const normalizedParent = parentPath.endsWith("/") ? parentPath : `${parentPath}/`;
  if (childPath === normalizedParent) return true;
  if (`${childPath}/` === normalizedParent) return true; // child is parent without trailing slash
  return childPath.startsWith(normalizedParent);
}

/**
 * Strip a single trailing "." from a hostname. DNS names like "example.com." and "example.com"
 * resolve identically; comparison code should treat them as equivalent.
 */
export function stripTrailingDot(hostname: string): string {
  return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
}

/**
 * Returns true if the targetUrl is in scope of the baseUrl for the given scope.
 * - "subpages": same host (incl. port) AND target path starts with the base directory of base path
 * - "hostname": same host (incl. port)
 * - "domain": same primary domain (registrable domain, port-agnostic)
 *
 * Protocol equality is required for all scopes. Hostname trailing-dot is normalized for all scopes.
 */
export function isInScope(
  baseUrl: URL,
  targetUrl: URL,
  scope: "subpages" | "hostname" | "domain",
): boolean {
  if (baseUrl.protocol !== targetUrl.protocol) return false;

  const baseHostNoDot = normalizeHost(baseUrl.host, baseUrl.hostname);
  const targetHostNoDot = normalizeHost(targetUrl.host, targetUrl.hostname);

  switch (scope) {
    case "subpages": {
      if (baseHostNoDot !== targetHostNoDot) return false;
      const baseDir = computeBaseDirectory(baseUrl.pathname);
      return targetUrl.pathname.startsWith(baseDir);
    }
    case "hostname":
      return baseHostNoDot === targetHostNoDot;
    case "domain": {
      return (
        extractPrimaryDomain(stripTrailingDot(baseUrl.hostname)) ===
        extractPrimaryDomain(stripTrailingDot(targetUrl.hostname))
      );
    }
    default:
      return false;
  }
}

/**
 * Strip the trailing dot only from the hostname portion of a `host` string (which may include
 * a port). Returns the host with the trailing dot removed from the hostname, port preserved.
 */
function normalizeHost(host: string, hostname: string): string {
  const stripped = stripTrailingDot(hostname);
  if (stripped === hostname) return host;
  // Replace the leading hostname portion with the stripped version, preserving any ":port" suffix.
  return host.replace(hostname, stripped);
}
