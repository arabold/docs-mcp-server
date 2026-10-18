/**
 * Data sanitization utilities for privacy-first telemetry.
 * Events carry the host of a URL instead of the URL itself, and error messages
 * and stack traces lose URLs, file paths and credentials before they are sent.
 */

/**
 * Extracts hostname from URL for aggregated analytics without exposing paths.
 * Examples:
 * - https://docs.python.org/3/library/os.html -> docs.python.org
 * - https://github.com/owner/repo -> github.com
 * - http://localhost:3000/api -> localhost
 *
 * @param url - The URL to extract the hostname from.
 * @returns The hostname, an empty string for `file:` URLs, or "invalid-hostname".
 */
export function extractHostname(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return "invalid-hostname";
  }
}

/**
 * Extracts protocol from URL or file path for privacy-safe analytics.
 * Examples:
 * - https://github.com/owner/repo -> "https"
 * - file:///local/path -> "file"
 * - /local/path -> "file" (detected as local file)
 * - C:\local\path -> "file" (detected as local file)
 *
 * @param urlOrPath - The URL or local path to inspect.
 * @returns The protocol without its trailing colon, "file", or "unknown".
 */
export function extractProtocol(urlOrPath: string): string {
  try {
    const parsed = new URL(urlOrPath);
    return parsed.protocol.replace(":", "");
  } catch {
    // If URL parsing fails, check if it looks like a local file path
    if (urlOrPath.startsWith("/") || /^[A-Za-z]:/.test(urlOrPath)) {
      return "file";
    }
    return "unknown";
  }
}

/**
 * Sanitizes error messages to remove sensitive information while preserving diagnostic value.
 * Examples:
 * - "Failed to fetch https://secret.com/api" -> "Failed to fetch [url]"
 * - "File not found: /home/user/secret.txt" -> "File not found: [path]"
 * - "ENOENT: no such file or directory, scandir '/home/user/docs'" -> "... scandir '[path]'"
 *
 * @param message - The raw error message.
 * @returns The message without URLs, paths or credentials, cut to 200 characters.
 */
export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s]+/gi, "[url]")
    .replace(/file:\/\/[^\s]+/gi, "[file-url]")
    .replace(/(?<![\w\]])(?:~|\.{1,2})?\/[^\s'"`<>()]*\/[^\s'"`<>()]*/g, "[path]")
    .replace(/\/[^\s]*\.[a-z]{2,4}/gi, "[path]")
    .replace(/[A-Za-z]:\\[^\s]+/g, "[path]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [token]")
    .replace(/api[_-]?key[=:]\s*[^\s]+/gi, "api_key=[redacted]")
    .replace(/token[=:]\s*[^\s]+/gi, "token=[redacted]")
    .substring(0, 200); // Limit length
}

/** Splits a stack frame into its prefix, location and `:line:column` suffix. */
const STACK_FRAME = /^(\s*at (?:.*? \()?)(.+?)(:\d+:\d+\)?)$/;

/**
 * Shortens a stack frame location to the path below the last `node_modules`
 * directory, or to the file name, so no user or directory names remain.
 */
function shortenFrameLocation(location: string): string {
  if (location.startsWith("node:")) return location;
  const normalized = location.replace(/^file:\/\//, "").replace(/\\/g, "/");
  const marker = "/node_modules/";
  const nodeModules = normalized.lastIndexOf(marker);
  if (nodeModules !== -1) return normalized.slice(nodeModules + marker.length);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

/**
 * Creates a copy of an error that is safe to send to error tracking. The message
 * goes through {@link sanitizeErrorMessage}, stack frames keep only the file name
 * (or the package path below `node_modules`), and causes are sanitized the same way.
 *
 * @param error - The error to sanitize.
 * @returns A new error with the same name and sanitized message, stack and cause.
 */
export function sanitizeErrorForTracking(error: Error): Error {
  const message = sanitizeErrorMessage(error.message);
  const cause =
    error.cause instanceof Error ? sanitizeErrorForTracking(error.cause) : undefined;
  const sanitized = new Error(message, cause ? { cause } : undefined);
  sanitized.name = error.name;

  const frames = (error.stack ?? "")
    .split("\n")
    .filter((line) => /^\s*at /.test(line))
    .map((line) => {
      const match = STACK_FRAME.exec(line);
      if (!match) return line;
      const [, prefix, location, suffix] = match;
      return `${prefix}${shortenFrameLocation(location)}${suffix}`;
    });
  sanitized.stack = [`${error.name}: ${message}`, ...frames].join("\n");

  return sanitized;
}
