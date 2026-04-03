import { InvalidUrlError } from "./errors";

/**
 * Parse a hostname into a 32-bit integer, handling standard dotted-decimal
 * as well as octal, hex, and decimal single-number representations
 * (e.g. 0x7f000001, 2130706433, 0177.0.0.1).
 *
 * Returns null when the hostname is not an IPv4 address.
 */
function parseIpv4ToInt(hostname: string): number | null {
  // Strip IPv6 brackets if present
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return null; // We handle IPv6 separately
  }

  // Single-number forms (decimal / hex)
  if (/^0x[0-9a-fA-F]+$/.test(hostname)) {
    const n = Number.parseInt(hostname, 16);
    return Number.isFinite(n) && n >= 0 && n <= 0xffffffff ? n : null;
  }
  if (/^\d+$/.test(hostname) && !hostname.includes(".")) {
    const n = Number.parseInt(hostname, 10);
    return Number.isFinite(n) && n >= 0 && n <= 0xffffffff ? n : null;
  }

  // Dotted form: each octet may be octal (0-prefix), hex (0x-prefix), or decimal
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;

  let ip = 0;
  for (const part of parts) {
    let octet: number;
    if (/^0x[0-9a-fA-F]+$/i.test(part)) {
      octet = Number.parseInt(part, 16);
    } else if (/^0[0-7]+$/.test(part)) {
      octet = Number.parseInt(part, 8);
    } else if (/^\d+$/.test(part)) {
      octet = Number.parseInt(part, 10);
    } else {
      return null;
    }
    if (octet < 0 || octet > 255) return null;
    ip = (ip << 8) | octet;
  }
  // Ensure unsigned 32-bit
  return ip >>> 0;
}

/**
 * Returns true when the IPv4 integer belongs to a non-public range:
 * loopback, link-local, private (RFC 1918), 0.0.0.0/8, broadcast.
 */
function isPrivateIpv4(ip: number): boolean {
  // 0.0.0.0/8
  if (ip >>> 24 === 0) return true;
  // 10.0.0.0/8
  if (ip >>> 24 === 10) return true;
  // 127.0.0.0/8 (loopback)
  if (ip >>> 24 === 127) return true;
  // 169.254.0.0/16 (link-local / metadata)
  if (ip >>> 16 === 0xa9fe) return true;
  // 172.16.0.0/12
  if (ip >>> 16 >= 0xac10 && ip >>> 16 <= 0xac1f) return true;
  // 192.168.0.0/16
  if (ip >>> 16 === 0xc0a8) return true;
  // 255.255.255.255
  if (ip === 0xffffffff) return true;
  return false;
}

/**
 * Returns true when the hostname looks like an IPv6 loopback (::1) or
 * link-local / internal address.
 */
function isPrivateIpv6(hostname: string): boolean {
  // Remove brackets around IPv6 addresses: [::1] -> ::1
  const raw = hostname.replace(/^\[|\]$/g, "");
  // Expand and check simplified patterns
  const lower = raw.toLowerCase();
  // ::1 (loopback)
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  // :: (unspecified)
  if (lower === "::" || lower === "0:0:0:0:0:0:0:0") return true;
  // fe80::/10 (link-local)
  if (lower.startsWith("fe80")) return true;
  // fc00::/7 (unique local)
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  return false;
}

/**
 * Asserts the given URL targets a public HTTP(S) endpoint.
 * Throws `InvalidUrlError` when the URL uses a disallowed scheme,
 * targets a private / loopback / link-local IP address, or otherwise
 * looks like an internal resource.
 *
 * This is the central SSRF guard for user-facing surfaces (web UI, etc.).
 */
export function assertPublicUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidUrlError(url);
  }

  // Only allow http / https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidUrlError(
      `URL scheme "${parsed.protocol}" is not allowed. Only http: and https: URLs are accepted.`,
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost / loopback by name
  if (hostname === "localhost") {
    throw new InvalidUrlError("URLs targeting localhost are not allowed.");
  }

  // IPv6 check
  if (hostname.startsWith("[") || isPrivateIpv6(hostname)) {
    throw new InvalidUrlError(
      "URLs targeting private or loopback IPv6 addresses are not allowed.",
    );
  }

  // IPv4 check (covers dotted-decimal, hex, octal, decimal)
  const ipInt = parseIpv4ToInt(hostname);
  if (ipInt !== null && isPrivateIpv4(ipInt)) {
    throw new InvalidUrlError(
      "URLs targeting private or loopback IP addresses are not allowed.",
    );
  }
}
