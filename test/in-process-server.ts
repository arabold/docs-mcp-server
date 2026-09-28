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
import { PipelineFactory } from "../src/pipeline/PipelineFactory";
import { createLocalDocumentManagement } from "../src/store";
import { loadConfig } from "../src/utils/config";

/**
 * Start the application on `port` with `server.publicUrl` set and a fresh
 * store, with authentication against `issuerUrl` when one is given.
 * @param options.port - The port to listen on (127.0.0.1).
 * @param options.publicUrl - The public URL, possibly with a base path.
 * @param options.issuerUrl - The issuer to authenticate against; omit to disable auth.
 * @param options.enableWebInterface - Whether to serve the web UI (default `true`).
 * @returns `stop`, which shuts everything down and removes the store.
 */
export async function startInProcessServer(options: {
  port: number;
  publicUrl: string;
  issuerUrl?: string;
  enableWebInterface?: boolean;
}): Promise<{ stop: () => Promise<void> }> {
  const tempDir = mkdtempSync(join(tmpdir(), "docs-mcp-e2e-"));
  const appConfig = loadConfig();
  appConfig.app.storePath = tempDir;
  appConfig.app.embeddingModel = "";
  appConfig.server.host = "127.0.0.1";
  appConfig.server.publicUrl = options.publicUrl;
  appConfig.auth.enabled = options.issuerUrl !== undefined;
  appConfig.auth.issuerUrl = options.issuerUrl ?? "";
  appConfig.auth.audience = "";

  const eventBus = new EventBusService();
  const docService = await createLocalDocumentManagement(eventBus, appConfig);
  const pipeline = await PipelineFactory.createPipeline(docService as never, eventBus, {
    appConfig,
  });
  const appServer = await startAppServer(
    docService,
    pipeline,
    eventBus,
    createAppServerConfig({
      enableWebInterface: options.enableWebInterface ?? true,
      enableMcpServer: true,
      enableApiServer: true,
      enableWorker: true,
      port: options.port,
      showLogo: false,
      startupContext: { cliCommand: "test", mcpProtocol: "http" },
    }),
    appConfig,
  );

  return {
    async stop() {
      await appServer.stop();
      await pipeline.stop();
      await docService.shutdown();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}
