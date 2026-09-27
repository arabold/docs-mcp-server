/**
 * Browser-origin policy shared by the MCP endpoint, the HTTP API and its
 * WebSocket upgrade.
 *
 * An `Origin` header is allowed when its host is loopback (any scheme and
 * port), when its host is the public URL's host, or when it exactly matches a
 * configured allowed origin. Requests without an `Origin` header come from
 * non-browser clients and are never refused because of it.
 */

import type { ServerResponse } from "node:http";
import { localhostAllowedOrigins } from "@modelcontextprotocol/server";

/** How a request's `Origin` header relates to the policy. */
export type OriginVerdict = "absent" | "allowed" | "denied";

/** Classifies `Origin` header values. */
export interface OriginPolicy {
  /**
   * Classify an `Origin` header value.
   * @param origin - The raw header value, or `undefined` when the header is missing.
   * @returns `"absent"` without a header; `"allowed"` or `"denied"` otherwise.
   *   `null`, unparsable and non-HTTP(S) values are `"denied"`.
   */
  check(origin: string | undefined): OriginVerdict;
}

/**
 * Build the origin policy.
 * @param options.publicHostname - Hostname of the configured public URL, when one is configured.
 * @param options.allowedOrigins - Canonical origins (`scheme://host[:port]`) that are allowed exactly.
 * @returns The policy.
 */
export function createOriginPolicy(options: {
  publicHostname?: string;
  allowedOrigins: readonly string[];
}): OriginPolicy {
  const loopbackHosts = new Set(
    localhostAllowedOrigins().map((host) => host.toLowerCase()),
  );
  const exactOrigins = new Set(options.allowedOrigins);
  const publicHostname = options.publicHostname?.toLowerCase();

  return {
    check(origin) {
      if (origin === undefined) {
        return "absent";
      }
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        return "denied";
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "denied";
      }
      const hostname = parsed.hostname.toLowerCase();
      if (loopbackHosts.has(hostname)) {
        return "allowed";
      }
      if (publicHostname !== undefined && hostname === publicHostname) {
        return "allowed";
      }
      return exactOrigins.has(parsed.origin) ? "allowed" : "denied";
    },
  };
}

/** Header names a CORS preflight may ask for: RFC 9110 field-name tokens only. */
const HEADER_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * Reduce a preflight's `Access-Control-Request-Headers` to valid header names,
 * so echoing it can never inject into the response.
 * @param requestedHeaders - The raw header value.
 * @returns The comma-separated valid names, or `undefined` when none remain.
 */
export function sanitizeRequestedHeaders(
  requestedHeaders: string | undefined,
): string | undefined {
  const names = (requestedHeaders ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => HEADER_TOKEN.test(name));
  return names.length > 0 ? names.join(", ") : undefined;
}

function appendVary(res: ServerResponse, ...fields: string[]): void {
  const existing = res.getHeader("Vary");
  const current =
    typeof existing === "string" ? existing.split(",").map((field) => field.trim()) : [];
  const merged = [...current.filter(Boolean)];
  for (const field of fields) {
    if (!merged.some((entry) => entry.toLowerCase() === field.toLowerCase())) {
      merged.push(field);
    }
  }
  res.setHeader("Vary", merged.join(", "));
}

/**
 * Add the CORS headers a browser needs to read a response from an allowed
 * origin, including the `WWW-Authenticate` challenge. Call only for an
 * `"allowed"` verdict, before anything is written.
 * @param res - The response to decorate.
 * @param origin - The request's `Origin` header value.
 */
export function setCorsResponseHeaders(res: ServerResponse, origin: string): void {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate");
  appendVary(res, "Origin");
}

/**
 * Set the headers of a CORS preflight answer for an allowed origin: allow POST
 * and echo the request headers the preflight names. The caller sends the
 * `204`. Call only for an `"allowed"` verdict.
 * @param res - The response to decorate.
 * @param origin - The request's `Origin` header value.
 * @param requestedHeaders - The preflight's `Access-Control-Request-Headers` value.
 */
export function setCorsPreflightHeaders(
  res: ServerResponse,
  origin: string,
  requestedHeaders: string | undefined,
): void {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST");
  const headers = sanitizeRequestedHeaders(requestedHeaders);
  if (headers) {
    res.setHeader("Access-Control-Allow-Headers", headers);
  }
  res.setHeader("Access-Control-Max-Age", "600");
  appendVary(res, "Origin", "Access-Control-Request-Headers");
}

/**
 * Whether the server listens only on the loopback interface, where no reverse
 * proxy stands between it and a local browser.
 * @param host - The configured bind host.
 * @returns `true` for `localhost`, `127.0.0.0/8` and `::1`.
 */
export function isLoopbackBindHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  const unbracketed =
    normalized.startsWith("[") && normalized.endsWith("]")
      ? normalized.slice(1, -1)
      : normalized;
  return (
    unbracketed === "localhost" || unbracketed === "::1" || /^127\./.test(unbracketed)
  );
}
