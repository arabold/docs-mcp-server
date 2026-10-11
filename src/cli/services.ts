import type { StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import type { AppServer } from "../app";
import type { Backend } from "../services/backend";
import type { TelemetryService } from "../telemetry";

// Module-level variables for active services
let activeAppServer: AppServer | null = null;
let activeMcpStdioServer: StdioServerHandle | null = null;
let activeBackend: Backend | null = null;
let activeTelemetryService: TelemetryService | null = null;

export interface GlobalServices {
  appServer?: AppServer;
  mcpStdioServer?: StdioServerHandle;
  /** The backend a long-running server serves; closed after the server stops. */
  backend?: Backend;
  telemetryService?: TelemetryService;
}

/**
 * Registers global services for shutdown handling
 */
export function registerGlobalServices(services: GlobalServices): void {
  if (services.appServer) activeAppServer = services.appServer;
  if (services.mcpStdioServer) activeMcpStdioServer = services.mcpStdioServer;
  if (services.backend) activeBackend = services.backend;
  if (services.telemetryService) activeTelemetryService = services.telemetryService;
  if (activeBackend && activeTelemetryService) {
    // Report job events only where jobs run; a worker reports its own
    activeTelemetryService.setJobTracking(
      activeBackend.mode === "local" && activeBackend.pipeline !== undefined,
    );
  }
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

export function getActiveBackend(): Backend | null {
  return activeBackend;
}

export function setActiveBackend(backend: Backend | null): void {
  activeBackend = backend;
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

export function getActiveTelemetryService(): TelemetryService | null {
  return activeTelemetryService;
}

export function setActiveTelemetryService(service: TelemetryService | null): void {
  activeTelemetryService = service;
}
