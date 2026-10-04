/**
 * Browser-origin and host-name policies shared by the MCP endpoint, the HTTP
 * API and its WebSocket upgrade.
 *
 * An `Origin` header is allowed when its host is loopback (any scheme and
 * port), when it is the public URL's origin, or when it exactly matches a
 * configured allowed origin. Requests without an `Origin` header come from
 * non-browser clients and are never refused because of it.
 *
 * The host policy closes the gap the origin check leaves: browsers send no
 * `Origin` on same-origin GET requests, so a page on an attacker's domain that
 * DNS-rebinds to this server is recognized by its `Host` header instead.
 */

import type { ServerResponse } from "node:http";
import { isIP } from "node:net";
import { localhostAllowedOrigins } from "@modelcontextprotocol/server";
import { stripIpv6Brackets } from "../utils/serverOrigin";

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

/** What both policies are built from. */
export interface BrowserPolicyOptions {
  /** Origin (`scheme://host[:port]`) of the configured public URL, when one is configured. */
  publicOrigin?: string;
  /** Canonical origins (`scheme://host[:port]`) of hosted browser clients. */
  allowedOrigins: readonly string[];
}

/**
 * Build the origin policy. Loopback origins, the public URL's origin and each
 * allowed origin (matched exactly) are allowed.
 * @param options - The public origin and the allowed origins.
 * @returns The policy.
 */
export function createOriginPolicy(options: BrowserPolicyOptions): OriginPolicy {
  const loopbackHosts = new Set(
    localhostAllowedOrigins().map((host) => host.toLowerCase()),
  );
  const exactOrigins = new Set(options.allowedOrigins);
  if (options.publicOrigin !== undefined) {
    exactOrigins.add(options.publicOrigin);
  }

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
      return exactOrigins.has(parsed.origin) ? "allowed" : "denied";
    },
  };
}

/** Decides which `Host` header values the server answers. */
export interface HostPolicy {
  /**
   * Whether a request's `Host` header names a host this server answers to.
   * @param host - The raw header value, or `undefined` when the header is missing.
   * @returns `true` when the request may be served.
   */
  isAllowed(host: string | undefined): boolean;
}

/**
 * `host[:port]` or `[ipv6][:port]`, the only shapes a browser sends. Captures
 * the host (with brackets for IPv6) and the port.
 */
const HOST_HEADER =
  /^([a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.?|\[[0-9a-f:.]+\])(?::(\d{1,5}))?$/i;

/**
 * Build the host policy. A host is accepted when it is an IP address literal,
 * `localhost`, a single-label name (no dot, such as a Docker service name),
 * the public URL's host, or the host of an allowed origin. None of these can be
 * pointed at an attacker's page through public DNS, which is what DNS
 * rebinding needs. A request without a `Host` header is served.
 *
 * @param options - The public origin and the allowed origins, whose hosts are accepted.
 * @returns The policy.
 */
export function createHostPolicy(options: BrowserPolicyOptions): HostPolicy {
  const knownOrigins = [
    ...options.allowedOrigins,
    ...(options.publicOrigin === undefined ? [] : [options.publicOrigin]),
  ];
  const knownHosts = new Set(
    knownOrigins.map((origin) => new URL(origin).hostname.toLowerCase()),
  );

  return {
    isAllowed(host) {
      if (!host) {
        return true;
      }
      const match = HOST_HEADER.exec(host);
      if (!match || Number(match[2] ?? 0) > 65535) {
        return false;
      }
      const hostname = match[1].toLowerCase();
      if (hostname.startsWith("[")) {
        return isIP(hostname.slice(1, -1)) === 6;
      }
      // `localhost` is a single-label name, so the dot check accepts it.
      return isIP(hostname) === 4 || !hostname.includes(".") || knownHosts.has(hostname);
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
function sanitizeRequestedHeaders(
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
 * Set the headers of a CORS preflight answer: allow the given methods and echo
 * the request headers the preflight names. The caller sends the `204`.
 * @param res - The response to decorate.
 * @param options.origin - The allowed origin to echo (only for an `"allowed"` verdict), or `*`.
 * @param options.methods - The methods to allow, e.g. `POST`.
 * @param options.requestedHeaders - The preflight's `Access-Control-Request-Headers` value.
 */
export function setCorsPreflightHeaders(
  res: ServerResponse,
  options: { origin: string; methods: string; requestedHeaders: string | undefined },
): void {
  res.setHeader("Access-Control-Allow-Origin", options.origin);
  res.setHeader("Access-Control-Allow-Methods", options.methods);
  const headers = sanitizeRequestedHeaders(options.requestedHeaders);
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
  const unbracketed = stripIpv6Brackets(host.trim().toLowerCase());
  return (
    unbracketed === "localhost" || unbracketed === "::1" || /^127\./.test(unbracketed)
  );
}
