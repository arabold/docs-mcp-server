/**
 * AsyncLocalStorage context holding the authenticated MCP caller
 * metadata for the current async execution chain.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** The bounded caller identity attached to the current tool execution. */
export interface McpCallerContext {
  tokenId?: number | null;
  tokenComment?: string | null;
  protocol?: "http" | "sse" | "stdio";
}

export const mcpRequestContextStore = new AsyncLocalStorage<McpCallerContext>();

/**
 * Returns the authenticated MCP caller context for the active request, or
 * `undefined` if called outside an authenticated MCP request (e.g. stdio CLI).
 * @returns The current caller's identity and transport.
 */
export function getCurrentMcpCaller(): McpCallerContext | undefined {
  return mcpRequestContextStore.getStore();
}
