/**
 * App module exports for the central application server architecture.
 */

/**
 * Application server module exports.
 * Provides AppServer and configuration types, plus convenience functions for CLI integration.
 */

export { AppServer } from "./AppServer";
export type { AppServerConfig } from "./AppServerConfig";

import type { JobsBackend } from "../services/backend";
import type { AppConfig } from "../utils/config";
import { AppServer } from "./AppServer";
import type { AppServerConfig } from "./AppServerConfig";

/**
 * Starts an AppServer that serves `backend` with the given configuration.
 * Convenience function for CLI integration.
 *
 * @param backend The services to serve; the caller closes them after stopping the server.
 * @param serverConfig Which services to run and the port to bind.
 * @param appConfig The application configuration.
 * @returns The started server.
 */
export async function startAppServer(
  backend: JobsBackend,
  serverConfig: AppServerConfig,
  appConfig: AppConfig,
): Promise<AppServer> {
  const appServer = new AppServer(backend, serverConfig, appConfig);
  await appServer.start();
  return appServer;
}
