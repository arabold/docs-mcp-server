import type { CallToolResult } from "@modelcontextprotocol/server";
import { TRPCClientError } from "@trpc/client";
import {
  AmbiguousPageInStoreError,
  InvalidLibraryNameError,
  LibraryNotFoundInStoreError,
  PageNotFoundInStoreError,
  VersionNotFoundInStoreError,
} from "../store/errors";
import { compactMcpFailureReason, mcpFailureReasons } from "../store/mcpStats";
import { EmptyContentError, ToolError, ValidationError } from "../tools/errors";
import {
  AccessPolicyError,
  ChallengeError,
  HttpStatusError,
  InvalidUrlError,
  RedirectError,
  RenderError,
  ScraperError,
  TlsCertificateError,
} from "../utils/errors";

const failureReasonsByResult = new WeakMap<CallToolResult, string>();

/**
 * Describes known tool failures using only typed errors and fixed labels.
 * @param error - The thrown value, possibly received from a remote worker.
 * @returns A safe description if the error's cause is known.
 */
export function describeMcpFailure(error: unknown): string | null {
  const cause = error instanceof ToolError ? (error.cause ?? error) : error;
  if (cause instanceof TRPCClientError) {
    return compactMcpFailureReason(cause.data?.mcpFailureReason);
  }
  if (cause instanceof LibraryNotFoundInStoreError) {
    return mcpFailureReasons.libraryMissing;
  }
  if (cause instanceof VersionNotFoundInStoreError) {
    return mcpFailureReasons.versionMissing;
  }
  if (cause instanceof PageNotFoundInStoreError) return mcpFailureReasons.pageMissing;
  if (cause instanceof AmbiguousPageInStoreError) return mcpFailureReasons.pageAmbiguous;
  if (
    cause instanceof ValidationError ||
    cause instanceof InvalidLibraryNameError ||
    cause instanceof InvalidUrlError
  ) {
    return mcpFailureReasons.invalidInput;
  }
  if (cause instanceof EmptyContentError) return mcpFailureReasons.emptyContent;
  if (cause instanceof AccessPolicyError) return mcpFailureReasons.accessDenied;
  if (cause instanceof ChallengeError) return mcpFailureReasons.botChallenge;
  if (cause instanceof TlsCertificateError) return mcpFailureReasons.tlsFailure;
  if (cause instanceof RenderError) return mcpFailureReasons.renderFailure;
  if (cause instanceof HttpStatusError || cause instanceof RedirectError) {
    return compactMcpFailureReason(`HTTP ${cause.statusCode}`);
  }
  if (cause instanceof ScraperError) return mcpFailureReasons.fetchFailure;
  return null;
}

/**
 * Reads the server-only failure description for a completed tool response.
 * @param result - The result about to be returned to the MCP client.
 * @returns A safe description for failed calls, or null on success.
 */
export function getToolFailureReason(result: CallToolResult): string | null {
  if (result.isError !== true) return null;
  return failureReasonsByResult.get(result) ?? mcpFailureReasons.unknown;
}

/**
 * Creates a success response object in the format expected by the MCP server.
 * @param text The text content of the response.
 * @returns The response object.
 */
export function createResponse(text: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    isError: false,
  };
}

/**
 * Creates an error response object in the format expected by the MCP server.
 * @param errorOrText The failure or error message.
 * @returns The response object.
 */
export function createError(errorOrText: unknown): CallToolResult {
  const text = errorOrText instanceof Error ? errorOrText.message : String(errorOrText);
  const result: CallToolResult = {
    content: [
      {
        type: "text",
        text,
      },
    ],
    isError: true,
  };
  const failureReason = describeMcpFailure(errorOrText);
  if (failureReason) failureReasonsByResult.set(result, failureReason);
  return result;
}
