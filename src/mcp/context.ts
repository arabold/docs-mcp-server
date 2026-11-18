/**
 * AsyncLocalStorage context holding the MCP caller
 * metadata for the current async execution chain.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** The bounded caller identity attached to the current tool execution. */
export interface McpCallerContext {
  tokenId?: number;
  caller: string;
  protocol: "http" | "sse";
}

export const mcpRequestContextStore = new AsyncLocalStorage<McpCallerContext>();

/**
 * Returns the MCP caller context for the active HTTP or SSE request.
 * @returns The current caller's identity and transport.
 */
export function getCurrentMcpCaller(): McpCallerContext | undefined {
  return mcpRequestContextStore.getStore();
}
