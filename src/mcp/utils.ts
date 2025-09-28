import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

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
 * @param text The error message.
 * @returns The response object.
 */
export function createError(errorOrText: unknown): CallToolResult {
  const text = errorOrText instanceof Error ? errorOrText.message : String(errorOrText);
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    isError: true,
  };
}
