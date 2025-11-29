/**
 * Worker command - Starts external pipeline worker (HTTP API).
 */

import type { Command } from "commander";
import { Option } from "commander";
import { startAppServer } from "../../app";
import { PipelineFactory, type PipelineOptions } from "../../pipeline";
import { createLocalDocumentManagement } from "../../store";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { DEFAULT_HOST, DEFAULT_MAX_CONCURRENCY } from "../../utils/config";
import { logger } from "../../utils/logger";
import { registerGlobalServices } from "../main";
import {
  createAppServerConfig,
  ensurePlaywrightBrowsersInstalled,
  getEventBus,
  resolveEmbeddingContext,
  validateHost,
  validatePort,
} from "../utils";

export function createWorkerCommand(program: Command): Command {
  return program
    .command("worker")
    .description("Start external pipeline worker (HTTP API)")
    .addOption(
      new Option("--port <number>", "Port for worker API")
        .env("DOCS_MCP_PORT")
        .env("PORT")
        .default("8080")
        .argParser((v: string) => {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1 || n > 65535) {
            throw new Error("Port must be an integer between 1 and 65535");
          }
          return String(n);
        }),
    )
    .addOption(
      new Option("--host <host>", "Host to bind the worker API to")
        .env("DOCS_MCP_HOST")
        .env("HOST")
        .default(DEFAULT_HOST)
        .argParser(validateHost),
    )
    .addOption(
      new Option(
        "--embedding-model <model>",
        "Embedding model configuration (e.g., 'openai:text-embedding-3-small')",
      ).env("DOCS_MCP_EMBEDDING_MODEL"),
    )
    .option("--resume", "Resume interrupted jobs on startup", true)
    .option("--no-resume", "Do not resume jobs on startup")
    .action(
      async (
        cmdOptions: {
          port: string;
          host: string;
          embeddingModel?: string;
          resume: boolean;
        },
        command?: Command,
      ) => {
        await telemetry.track(TelemetryEvent.CLI_COMMAND, {
          command: "worker",
          port: cmdOptions.port,
          host: cmdOptions.host,
          resume: cmdOptions.resume,
        });

        const port = validatePort(cmdOptions.port);
        const host = validateHost(cmdOptions.host);

        try {
          // Ensure browsers are installed for scraping
          ensurePlaywrightBrowsersInstalled();

          // Resolve embedding configuration for worker (worker needs embeddings for indexing)
          const embeddingConfig = resolveEmbeddingContext(cmdOptions.embeddingModel);

          // Get global options from root command (which has resolved storePath in preAction hook)
          const globalOptions = program.opts();

          // Get the global EventBusService
          const eventBus = getEventBus(command);

          const docService = await createLocalDocumentManagement(
            globalOptions.storePath,
            eventBus,
            embeddingConfig,
          );
          const pipelineOptions: PipelineOptions = {
            recoverJobs: cmdOptions.resume, // Use the resume option
            concurrency: DEFAULT_MAX_CONCURRENCY,
          };
          const pipeline = await PipelineFactory.createPipeline(
            docService,
            eventBus,
            pipelineOptions,
          );

          // Configure worker-only server
          const config = createAppServerConfig({
            enableWebInterface: false,
            enableMcpServer: false,
            enableApiServer: true,
            enableWorker: true,
            port,
            host,
            startupContext: {
              cliCommand: "worker",
            },
          });

          const appServer = await startAppServer(docService, pipeline, eventBus, config);

          // Register for graceful shutdown
          // Note: pipeline is managed by AppServer, so don't register it globally
          registerGlobalServices({
            appServer,
            docService,
            // pipeline is owned by AppServer - don't register globally to avoid double shutdown
          });

          await new Promise(() => {}); // Keep running forever
        } catch (error) {
          logger.error(`❌ Failed to start external pipeline worker: ${error}`);
          process.exit(1);
        }
      },
    );
}
