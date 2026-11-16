import { createHash } from "node:crypto";
import type { McpToolCallInput } from "./types";

export const mcpFailureReasons = {
  libraryMissing: "Library not indexed",
  versionMissing: "Version not indexed",
  pageMissing: "Page not indexed",
  pageAmbiguous: "Page address is ambiguous",
  invalidInput: "Invalid tool arguments",
  accessDenied: "Blocked by scraper access policy",
  botChallenge: "Blocked by a bot challenge",
  tlsFailure: "TLS certificate validation failed",
  renderFailure: "Browser rendering failed",
  fetchFailure: "Page fetch failed",
  emptyContent: "Page has no readable content",
  unknown: "Tool execution failed",
} as const;

const allowedFailureReasons = new Set<string>(Object.values(mcpFailureReasons));

/**
 * Accepts only predefined failure descriptions and numeric HTTP statuses.
 * @param value - The proposed reason for a failed invocation.
 * @returns A safe description, or null for arbitrary error text.
 */
export function compactMcpFailureReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (allowedFailureReasons.has(value)) return value;
  return value.length === 8 && /^HTTP [1-5]\d{2}$/.test(value) ? value : null;
}

function label(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  return (
    value
      .slice(0, limit)
      .replace(/\p{Cc}/gu, "")
      .trim() || null
  );
}

/**
 * Keeps a document address without credentials, query parameters or fragments.
 * @param value - A document URL or relative page path.
 * @returns A bounded address, or null when the input is not an address.
 */
export function compactMcpTarget(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8192 || /[\s\p{Cc}]/u.test(value)) {
    return null;
  }
  let address: string;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    address = `${url.origin}${url.pathname}`;
  } catch {
    if (value.includes(":") || value.startsWith("//")) return null;
    address = value.split(/[?#]/, 1)[0];
  }
  if (!address) return null;
  return address.length <= 256
    ? address
    : `${address.slice(0, 231)}~${createHash("sha256").update(address).digest("hex").slice(0, 24)}`;
}

/**
 * Projects a tool call onto the metadata permitted in the statistics database.
 * @param call - The invocation metadata; extra runtime properties are discarded.
 * @returns Bounded labels and numeric counters without request or response bodies.
 */
export function compactMcpCall(call: McpToolCallInput): McpToolCallInput {
  return {
    tokenId:
      Number.isSafeInteger(call.tokenId) && Number(call.tokenId) > 0
        ? call.tokenId
        : null,
    tokenComment: label(call.tokenComment, 100),
    tool: label(call.tool, 64) ?? "unknown",
    library: label(call.library, 256),
    version: label(call.version, 64),
    target: compactMcpTarget(call.target),
    protocol:
      call.protocol === "stdio" || call.protocol === "sse" ? call.protocol : "http",
    success: call.success === true,
    failureReason:
      call.success === true ? null : compactMcpFailureReason(call.failureReason),
    durationMs: Number.isFinite(call.durationMs)
      ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(call.durationMs)))
      : 0,
  };
}
