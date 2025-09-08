/**
 * Web command - Starts web interface only.
 */

import type { Command } from "commander";
import { Option } from "commander";
import { startAppServer } from "../../app";
import type { PipelineOptions } from "../../pipeline";
import { createDocumentManagement } from "../../store";
import type { IDocumentManagement } from "../../store/trpc/interfaces";
import { logger } from "../../utils/logger";
import { registerGlobalServices } from "../main";
import {
  CLI_DEFAULTS,
  createAppServerConfig,
  createPipelineWithCallbacks,
  resolveEmbeddingContext,
  validateHost,
  validatePort,
} from "../utils";

export function createWebCommand(program: Command): Command {
  return program
    .command("web")
    .description("Start web interface only")
    .addOption(
      new Option("--port <number>", "Port for the web interface")
        .argParser((v) => {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1 || n > 65535) {
            throw new Error("Port must be an integer between 1 and 65535");
          }
          return String(n);
        })
        .default(CLI_DEFAULTS.WEB_PORT.toString()),
    )
    .addOption(
      new Option("--host <host>", "Host to bind the web interface to")
        .argParser(validateHost)
        .default(CLI_DEFAULTS.HOST),
    )
    .option(
      "--server-url <url>",
      "URL of external pipeline worker RPC (e.g., http://localhost:6280/api)",
    )
    .action(async (cmdOptions: { port: string; host: string; serverUrl?: string }) => {
      const port = validatePort(cmdOptions.port);
      const host = validateHost(cmdOptions.host);
      const serverUrl = cmdOptions.serverUrl;

      try {
        // Resolve embedding configuration for local execution
        const embeddingConfig = resolveEmbeddingContext();
        if (!serverUrl && !embeddingConfig) {
          logger.error(
            "❌ Embedding configuration is required for local mode. Configure an embedding provider with CLI options or environment variables.",
          );
          process.exit(1);
        }

        const docService: IDocumentManagement = await createDocumentManagement({
          serverUrl,
          embeddingConfig,
        });
        const pipelineOptions: PipelineOptions = {
          recoverJobs: false, // Web command doesn't support job recovery
          serverUrl,
          concurrency: 3,
        };
        const pipeline = await createPipelineWithCallbacks(
          serverUrl ? undefined : (docService as unknown as never),
          pipelineOptions,
        );

        // Configure web-only server
        const config = createAppServerConfig({
          enableWebInterface: true,
          enableMcpServer: false,
          enableApiServer: false,
          enableWorker: !serverUrl,
          port,
          host,
          externalWorkerUrl: serverUrl,
          startupContext: {
            cliCommand: "web",
          },
        });

        logger.info(
          `🚀 Starting web interface${serverUrl ? ` connecting to worker at ${serverUrl}` : ""}`,
        );
        const appServer = await startAppServer(docService, pipeline, config);

        // Register for graceful shutdown
        // Note: pipeline is managed by AppServer, so don't register it globally
        registerGlobalServices({
          appServer,
          docService,
          // pipeline is owned by AppServer - don't register globally to avoid double shutdown
        });

        await new Promise(() => {}); // Keep running forever
      } catch (error) {
        logger.error(`❌ Failed to start web interface: ${error}`);
        process.exit(1);
      }
    });
}
