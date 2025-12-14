/**
 * App module exports for the central application server architecture.
 */

/**
 * Application server module exports.
 * Provides AppServer and configuration types, plus convenience functions for CLI integration.
 */

export { AppServer } from "./AppServer";
export type { AppServerConfig } from "./AppServerConfig";

import type { EventBusService } from "../events";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import type { AppConfig } from "../utils/config";
import { AppServer } from "./AppServer";
import type { AppServerConfig } from "./AppServerConfig";

/**
 * Start an AppServer with the given configuration.
 * Convenience function for CLI integration.
 */
export async function startAppServer(
  docService: IDocumentManagement,
  pipeline: IPipeline,
  eventBus: EventBusService,
  serverConfig: AppServerConfig,
  appConfig: AppConfig,
): Promise<AppServer> {
  const appServer = new AppServer(
    docService,
    pipeline,
    eventBus,
    serverConfig,
    appConfig,
  );
  await appServer.start();
  return appServer;
}
