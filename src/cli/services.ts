import type { StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import type { AppServer } from "../app";
import type { Backend } from "../services/backend";

// Module-level variables for active services
let activeAppServer: AppServer | null = null;
let activeMcpStdioServer: StdioServerHandle | null = null;
let activeBackend: Backend | null = null;

export interface GlobalServices {
  appServer?: AppServer;
  mcpStdioServer?: StdioServerHandle;
  /** The backend a long-running server serves; closed after the server stops. */
  backend?: Backend;
}

/**
 * Registers global services for shutdown handling
 */
export function registerGlobalServices(services: GlobalServices): void {
  if (services.appServer) activeAppServer = services.appServer;
  if (services.mcpStdioServer) activeMcpStdioServer = services.mcpStdioServer;
  if (services.backend) activeBackend = services.backend;
}

export function getActiveAppServer(): AppServer | null {
  return activeAppServer;
}

export function setActiveAppServer(server: AppServer | null): void {
  activeAppServer = server;
}

export function getActiveMcpStdioServer(): StdioServerHandle | null {
  return activeMcpStdioServer;
}

export function setActiveMcpStdioServer(server: StdioServerHandle | null): void {
  activeMcpStdioServer = server;
}

/**
 * Closes the registered backend, if any, and forgets it. Call it after the
 * servers that use the backend have stopped.
 */
export async function closeActiveBackend(): Promise<void> {
  const backend = activeBackend;
  activeBackend = null;
  await backend?.close();
}
