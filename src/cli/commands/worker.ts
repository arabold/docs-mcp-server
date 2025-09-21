/**
 * Worker command - Starts external pipeline worker (HTTP API).
 */

import type { Command } from "commander";
import { startAppServer } from "../../app";
import type { PipelineOptions } from "../../pipeline";
import { createLocalDocumentManagement } from "../../store";
import { logger } from "../../utils/logger";
import { registerGlobalServices } from "../main";
import {
  CLI_DEFAULTS,
  createAppServerConfig,
  createOptionWithEnv,
  createPipelineWithCallbacks,
  ensurePlaywrightBrowsersInstalled,
  resolveEmbeddingContext,
  validateHost,
  validatePort,
} from "../utils";

export function createWorkerCommand(program: Command): Command {
  return program
    .command("worker")
    .description("Start external pipeline worker (HTTP API)")
    .addOption(
      createOptionWithEnv(
        "--port <number>",
        "Port for worker API",
        ["DOCS_MCP_PORT", "PORT"],
        "8080",
      ).argParser((v) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 65535) {
          throw new Error("Port must be an integer between 1 and 65535");
        }
        return String(n);
      }),
    )
    .addOption(
      createOptionWithEnv(
        "--host <host>",
        "Host to bind the worker API to",
        ["DOCS_MCP_HOST", "HOST"],
        CLI_DEFAULTS.HOST,
      ).argParser(validateHost),
    )
    .addOption(
      createOptionWithEnv(
        "--embedding-model <model>",
        "Embedding model configuration (e.g., 'openai:text-embedding-3-small')",
        ["DOCS_MCP_EMBEDDING_MODEL"],
      ),
    )
    .option("--resume", "Resume interrupted jobs on startup", true)
    .option("--no-resume", "Do not resume jobs on startup")
    .action(
      async (cmdOptions: {
        port: string;
        host: string;
        embeddingModel?: string;
        resume: boolean;
      }) => {
        const port = validatePort(cmdOptions.port);
        const host = validateHost(cmdOptions.host);

        try {
          logger.info(`🚀 Starting external pipeline worker on port ${port}`);

          // Ensure browsers are installed for scraping
          ensurePlaywrightBrowsersInstalled();

          // Resolve embedding configuration for worker (worker needs embeddings for indexing)
          const embeddingConfig = resolveEmbeddingContext(cmdOptions.embeddingModel);

          // Initialize services
          const docService = await createLocalDocumentManagement(embeddingConfig);
          const pipelineOptions: PipelineOptions = {
            recoverJobs: cmdOptions.resume, // Use the resume option
            concurrency: CLI_DEFAULTS.MAX_CONCURRENCY,
          };
          const pipeline = await createPipelineWithCallbacks(docService, pipelineOptions);

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
          logger.error(`❌ Failed to start external pipeline worker: ${error}`);
          process.exit(1);
        }
      },
    );
}
