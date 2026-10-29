/**
 * AsyncLocalStorage context holding the authenticated MCP token and caller
 * metadata for the current async execution chain.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { McpTokenRecord } from "../store/types";

export interface McpCallerContext {
  token?: McpTokenRecord | null;
  tokenId?: number | null;
  tokenComment?: string | null;
  protocol?: string;
  ip?: string;
}

export const mcpRequestContextStore = new AsyncLocalStorage<McpCallerContext>();

/**
 * Returns the authenticated MCP caller context for the active request, or
 * `undefined` if called outside an authenticated MCP request (e.g. stdio CLI).
 */
export function getCurrentMcpCaller(): McpCallerContext | undefined {
  return mcpRequestContextStore.getStore();
}
