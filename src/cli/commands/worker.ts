/**
 * Worker command - Starts external pipeline worker (HTTP API).
 */

import type { Argv } from "yargs";
import { startAppServer } from "../../app";
import { PipelineFactory, type PipelineOptions } from "../../pipeline";
import { createLocalDocumentManagement } from "../../store";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { loadConfig } from "../../utils/config";
import { logger } from "../../utils/logger";
import { registerGlobalServices } from "../services";
import {
  type CliContext,
  createAppServerConfig,
  ensurePlaywrightBrowsersInstalled,
  getEventBus,
  validateHost,
  validatePort,
} from "../utils";

export function createWorkerCommand(cli: Argv) {
  cli.command(
    "worker",
    "Start a background worker for processing scraping jobs",
    (yargs) => {
      return yargs
        .option("port", {
          type: "string",
          description: "Port for worker API",
        })
        .option("host", {
          type: "string",
          description: "Host to bind the worker API to",
        })
        .option("embedding-model", {
          type: "string",
          description:
            "Embedding model configuration (e.g., 'openai:text-embedding-3-small')",
          alias: "embeddingModel",
        })
        .option("resume", {
          type: "boolean",
          description: "Resume interrupted jobs on startup",
          default: true,
        })
        .option("no-resume", {
          type: "boolean",
          // Yargs handles boolean flags specially, --no-resume implies resume=false
          // But strict mode might complain if we don't define 'resume'
          // 'resume' defaulting to true handles --no-resume correctly in Yargs
          hidden: true,
        });
    },
    async (argv) => {
      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "worker",
        port: argv.port,
        host: argv.host,
        resume: argv.resume,
      });

      const _port = validatePort((argv.port as string) || "8080");
      const _host = validateHost((argv.host as string) || "127.0.0.1");

      const appConfig = loadConfig(argv, {
        configPath: argv.config as string,
        searchDir: argv.storePath as string, // resolved globally in index.ts middleware
      });

      try {
        // Ensure browsers are installed for scraping
        ensurePlaywrightBrowsersInstalled();

        const eventBus = getEventBus(argv as CliContext);

        const docService = await createLocalDocumentManagement(eventBus, appConfig);
        const pipelineOptions: PipelineOptions = {
          recoverJobs: (argv.resume as boolean) ?? true,
          appConfig: appConfig,
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
          port: appConfig.server.ports.worker,
          startupContext: {
            cliCommand: "worker",
          },
        });

        const appServer = await startAppServer(
          docService,
          pipeline,
          eventBus,
          config,
          appConfig,
        );

        registerGlobalServices({
          appServer,
          docService,
        });

        await new Promise(() => {}); // Keep running forever
      } catch (error) {
        logger.error(`❌ Failed to start external pipeline worker: ${error}`);
        process.exit(1);
      }
    },
  );
}
