/**
 * Helpers for serving the application under the path of its public URL, e.g.
 * `https://example.com/docs`, behind proxies that either forward or strip that
 * prefix.
 */

import { RESERVED_ROOT_SEGMENTS } from "../utils/serverOrigin";

/**
 * Remove the base path from a request URL, so a single set of root-mounted
 * routes serves both proxy styles. The match is segment-aware: `/docs` and
 * `/docs/…` are stripped, `/docs-old` is not.
 * @param url - The request URL (path plus optional query).
 * @param basePath - `""` or a path without a trailing slash, e.g. `/docs`.
 * @returns The URL relative to the base path, always starting with `/`.
 */
export function stripBasePath(url: string, basePath: string): string {
  if (!basePath || !url.startsWith(basePath)) {
    return url;
  }
  const rest = url.slice(basePath.length);
  if (rest === "") {
    return "/";
  }
  if (rest.startsWith("/")) {
    return rest;
  }
  if (rest.startsWith("?")) {
    return `/${rest}`;
  }
  return url;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Insert `<base href="{basePath}/">` as the first child of `<head>`. The web UI
 * is built with relative asset URLs, so the base element makes them resolve
 * under the base path, including on deep links, and at the root when there is
 * no base path.
 * @param html - The SPA shell.
 * @param basePath - `""` or a path without a trailing slash.
 * @returns The shell with the base element.
 */
export function injectBaseHref(html: string, basePath: string): string {
  const baseElement = `<base href="${escapeHtmlAttribute(basePath)}/">`;
  const headTag = /<head(\s[^>]*)?>/i;
  if (headTag.test(html)) {
    return html.replace(headTag, (match) => `${match}${baseElement}`);
  }
  return `${baseElement}${html}`;
}

/**
 * Whether a path is `prefix` itself or lies below it: `/api` and `/api/x`
 * match `/api`, `/apix` does not.
 * @param pathname - A request path without query string.
 * @param prefix - A path without a trailing slash.
 * @returns `true` when the path is under the prefix.
 */
export function isUnderPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Paths that never fall back to the web UI: the server's own root routes, plus
 * the removed OAuth proxy endpoints, so clients probing those get a clean 404
 * instead of an HTML page.
 */
const NON_SPA_PREFIXES = [...RESERVED_ROOT_SEGMENTS, "oauth"].map(
  (segment) => `/${segment}`,
);

/**
 * Whether an unmatched request should get the web UI shell, so client-side
 * routes and deep links load. Everything else gets a JSON 404.
 * @param method - The HTTP method.
 * @param url - The request URL, after the base path has been stripped.
 * @returns `true` for GET/HEAD requests outside the API, MCP, metadata and asset paths.
 */
export function servesSpaShell(method: string, url: string): boolean {
  if (method !== "GET" && method !== "HEAD") {
    return false;
  }
  const pathname = url.split("?")[0];
  return !NON_SPA_PREFIXES.some((prefix) => isUnderPath(pathname, prefix));
}
