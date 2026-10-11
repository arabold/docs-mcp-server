/**
 * Starts the full application in the test process, for E2E suites that need
 * control over its configuration (public URL, authentication) without
 * spawning the CLI.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAppServer } from "../src/app";
import { createAppServerConfig } from "../src/cli/utils";
import { EventBusService } from "../src/events";
import { openBackend } from "../src/services/backend";
import { loadConfig } from "../src/utils/config";
import { getFreePort } from "./test-helpers";

/**
 * Start the application on `port` with `server.publicUrl` set and a fresh
 * store, with authentication against `issuerUrl` when one is given.
 * @param options.port - The port to listen on (127.0.0.1); a free one by default.
 * @param options.publicUrl - The public URL, possibly with a base path; the listening address by default.
 * @param options.issuerUrl - The issuer to authenticate against; omit to disable auth.
 * @param options.enableWebInterface - Whether to serve the web UI (default `true`).
 * @param options.serverTitle - The server's title; omit for none.
 * @returns The server's event bus, its API URL on the listening port, and
 *   `stop`, which shuts everything down and removes the store.
 */
export async function startInProcessServer(
  options: {
    port?: number;
    publicUrl?: string;
    issuerUrl?: string;
    enableWebInterface?: boolean;
    serverTitle?: string;
  } = {},
): Promise<{ eventBus: EventBusService; apiUrl: string; stop: () => Promise<void> }> {
  const port = options.port ?? (await getFreePort());
  const tempDir = mkdtempSync(join(tmpdir(), "docs-mcp-e2e-"));
  const appConfig = loadConfig();
  appConfig.app.storePath = tempDir;
  appConfig.app.embeddingModel = "";
  appConfig.server.host = "127.0.0.1";
  appConfig.server.publicUrl = options.publicUrl ?? `http://127.0.0.1:${port}`;
  appConfig.server.title = options.serverTitle;
  appConfig.auth.enabled = options.issuerUrl !== undefined;
  appConfig.auth.issuerUrl = options.issuerUrl ?? "";
  appConfig.auth.audience = "";

  const eventBus = new EventBusService();
  const backend = await openBackend({ appConfig, eventBus, jobs: { interruptedJobs: "fail" } });
  const appServer = await startAppServer(
    backend,
    createAppServerConfig({
      enableWebInterface: options.enableWebInterface ?? true,
      enableMcpServer: true,
      enableApiServer: true,
      port,
      showLogo: false,
      startupContext: { cliCommand: "test", mcpProtocol: "http" },
    }),
    appConfig,
  );

  return {
    eventBus,
    apiUrl: `http://127.0.0.1:${port}/api`,
    async stop() {
      await appServer.stop();
      await backend.close();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}
