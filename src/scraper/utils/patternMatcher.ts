import { minimatch } from "minimatch";
import { getEffectiveExclusionPatterns } from "./defaultPatterns";

/**
 * Utility functions for pattern matching (glob and regex) for URL filtering.
 * Supports auto-detection and conversion of glob patterns to RegExp.
 *
 * Default exclusion patterns are applied when no user-provided exclude patterns are specified.
 * This includes common documentation files (CHANGELOG.md, LICENSE, etc.) and folders
 * (archive directories, non-English locales, etc.).
 *
 * Patterns starting and ending with '/' are treated as regex, otherwise as glob (minimatch syntax).
 * Glob wildcards supported: '*' (any chars except '/'), '**' (any chars, including '/').
 *
 * @module patternMatcher
 */

/**
 * Detects if a pattern is a regex (starts and ends with '/')
 */
export function isRegexPattern(pattern: string): boolean {
  return pattern.length > 2 && pattern.startsWith("/") && pattern.endsWith("/");
}

/**
 * Converts a pattern string to a RegExp instance (auto-detects glob/regex).
 * For globs, uses minimatch's internal conversion.
 */
export function patternToRegExp(pattern: string): RegExp {
  if (isRegexPattern(pattern)) {
    return new RegExp(pattern.slice(1, -1));
  }
  // For globs, minimatch.makeRe returns a RegExp
  const re = minimatch.makeRe(pattern, { dot: true });
  if (!re) throw new Error(`Invalid glob pattern: ${pattern}`);
  return re;
}

/**
 * Matches an absolute URL with a scheme (e.g. `https://`, `file://`).
 * Used to avoid prepending a `/` to inputs that are already full URLs.
 */
const URL_WITH_PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Checks if a given path matches any pattern in the list.
 * For globs, uses minimatch. For regex, uses RegExp.
 */
export function matchesAnyPattern(path: string, patterns?: string[]): boolean {
  if (!patterns || patterns.length === 0) return false;
  // Always match from a leading slash for path-based globs, but leave full
  // URLs (with scheme) untouched so anchored regex patterns like `^https://`
  // still match.
  const isFullUrl = URL_WITH_PROTOCOL_RE.test(path);
  const normalizedPath = isFullUrl || path.startsWith("/") ? path : `/${path}`;
  return patterns.some((pattern) => {
    if (isRegexPattern(pattern)) {
      return patternToRegExp(pattern).test(normalizedPath);
    }
    // For glob patterns:
    // - If pattern starts with '/', strip leading slash from BOTH pattern and path for minimatch
    // - Otherwise, strip leading slash only from path
    const pathForMatch = normalizedPath.replace(/^\//, "");
    const patternForMatch = pattern.startsWith("/") ? pattern.slice(1) : pattern;
    return minimatch(pathForMatch, patternForMatch, { dot: true });
  });
}

/**
 * Matches a flat string (hostname, label, etc.) against patterns without any
 * path normalization. Patterns use the same syntax as URL patterns: a glob
 * processed by minimatch, or a regex wrapped in `/.../`. Matching is
 * case-insensitive, which matches DNS semantics for the hostname use case.
 */
export function matchesAnyHostPattern(value: string, patterns?: string[]): boolean {
  if (!patterns || patterns.length === 0) return false;
  const normalized = value.toLowerCase();
  return patterns.some((pattern) => {
    if (isRegexPattern(pattern)) {
      return patternToRegExp(pattern).test(value);
    }
    return minimatch(normalized, pattern.toLowerCase(), { dot: true });
  });
}

/**
 * Extracts the path and query from a URL string (no domain).
 */
export function extractPathAndQuery(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + (u.search || "");
  } catch {
    return url; // fallback: return as-is
  }
}

/**
 * Determines if a URL should be included based on include/exclude patterns.
 * Exclude patterns take precedence. If no include patterns, all are included by default.
 *
 * If no user exclude patterns are provided, default exclusion patterns are automatically applied.
 * These defaults exclude common documentation files (CHANGELOG.md, LICENSE, etc.) and folders
 * (archives, non-English locales, etc.).
 *
 * Patterns are matched against both the full URL and the pathname for maximum flexibility:
 * - Full URL: `https://example.com/docs/v3/**` matches `https://example.com/docs/v3/guide`
 * - Pathname: `/docs/v3/**` matches `https://example.com/docs/v3/guide`
 */
export function shouldIncludeUrl(
  url: string,
  includePatterns?: string[],
  excludePatterns?: string[],
): boolean {
  // Extract pathname for path-based pattern matching
  const path = extractPathAndQuery(url);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  // For file:// URLs, also match against the basename (strip leading slash from pattern for basename matching)
  let basename: string | undefined;
  if (url.startsWith("file://")) {
    try {
      const u = new URL(url);
      basename = u.pathname ? u.pathname.split("/").pop() : undefined;
    } catch {}
  }
  // Helper to strip leading slash from patterns for basename matching
  const stripSlash = (patterns?: string[]) =>
    patterns?.map((p) => (p.startsWith("/") ? p.slice(1) : p));

  // Get effective exclusion patterns (merges defaults with user patterns)
  const effectiveExcludePatterns = getEffectiveExclusionPatterns(excludePatterns);

  // Exclude patterns take precedence
  // Match against BOTH full URL and pathname for flexibility
  if (
    matchesAnyPattern(url, effectiveExcludePatterns) ||
    matchesAnyPattern(normalizedPath, effectiveExcludePatterns) ||
    (basename && matchesAnyPattern(basename, stripSlash(effectiveExcludePatterns)))
  )
    return false;
  if (!includePatterns || includePatterns.length === 0) return true;
  // Match against BOTH full URL and pathname for flexibility
  return (
    matchesAnyPattern(url, includePatterns) ||
    matchesAnyPattern(normalizedPath, includePatterns) ||
    (basename ? matchesAnyPattern(basename, stripSlash(includePatterns)) : false)
  );
}
