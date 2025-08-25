/**
 * Worker command - Starts external pipeline worker (HTTP API).
 */

import type { Command } from "commander";
import { Option } from "commander";
import { startAppServer } from "../../app";
import type { PipelineOptions } from "../../pipeline";
import { createLocalDocumentManagement } from "../../store";
import { logger } from "../../utils/logger";
import {
  CLI_DEFAULTS,
  createAppServerConfig,
  createPipelineWithCallbacks,
  ensurePlaywrightBrowsersInstalled,
  resolveEmbeddingContext,
  setupLogging,
  validatePort,
} from "../utils";

export function createWorkerCommand(program: Command): Command {
  return program
    .command("worker")
    .description("Start external pipeline worker (HTTP API)")
    .addOption(
      new Option("--port <number>", "Port for worker API")
        .argParser((v) => {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1 || n > 65535) {
            throw new Error("Port must be an integer between 1 and 65535");
          }
          return String(n);
        })
        .default("8080"),
    )
    .option("--resume", "Resume interrupted jobs on startup", true)
    .option("--no-resume", "Do not resume jobs on startup")
    .action(async (cmdOptions: { port: string; resume: boolean }, command) => {
      const globalOptions = command.parent?.opts() || {};
      const port = validatePort(cmdOptions.port);

      setupLogging(globalOptions);

      try {
        logger.info(`🚀 Starting external pipeline worker on port ${port}`);

        // Ensure browsers are installed for scraping
        ensurePlaywrightBrowsersInstalled();

        // Resolve embedding configuration for worker (worker needs embeddings for indexing)
        const embeddingConfig = resolveEmbeddingContext();

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
          startupContext: {
            cliCommand: "worker",
          },
        });

        await startAppServer(docService, pipeline, config);

        await new Promise(() => {}); // Keep running forever
      } catch (error) {
        logger.error(`❌ Failed to start external pipeline worker: ${error}`);
        process.exit(1);
      }
    });
}
