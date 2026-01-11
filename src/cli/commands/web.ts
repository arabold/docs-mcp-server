/**
 * Web command - Starts web interface only.
 */

import type { Argv } from "yargs";
import { startAppServer } from "../../app";
import { PipelineFactory, type PipelineOptions } from "../../pipeline";
import { createDocumentManagement, type DocumentManagementService } from "../../store";
import type { IDocumentManagement } from "../../store/trpc/interfaces";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { loadConfig } from "../../utils/config";
import { logger } from "../../utils/logger";
import { registerGlobalServices } from "../services";
import {
  type CliContext,
  createAppServerConfig,
  getEventBus,
  validateHost,
  validatePort,
} from "../utils";

export function createWebCommand(cli: Argv) {
  cli.command(
    "web",
    "Start the web dashboard (Standalone Mode)",
    (yargs) => {
      return yargs
        .option("port", {
          type: "string",
          description: "Port for the web interface",
        })
        .option("host", {
          type: "string",
          description: "Host to bind the web interface to",
        })
        .option("embedding-model", {
          type: "string",
          description:
            "Embedding model configuration (e.g., 'openai:text-embedding-3-small')",
          alias: "embeddingModel",
        })
        .option("server-url", {
          type: "string",
          description:
            "URL of external pipeline worker RPC (e.g., http://localhost:8080/api)",
          alias: "serverUrl",
        });
    },
    async (argv) => {
      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "web",
        port: argv.port,
        host: argv.host,
        useServerUrl: !!argv.serverUrl,
      });

      const _port = validatePort((argv.port as string) || "6281"); // Fallback for validation, defaults via loadConfig
      const _host = validateHost((argv.host as string) || "127.0.0.1");
      const serverUrl = argv.serverUrl as string | undefined;

      const appConfig = loadConfig(argv, {
        configPath: argv.config as string,
        // searchDir resolved via globalStorePath in index.ts -> available in appConfig?
        // loadConfig needs options to find file.
        searchDir: argv.storePath as string,
      });

      try {
        const eventBus = getEventBus(argv as CliContext);

        const docService: IDocumentManagement = await createDocumentManagement({
          serverUrl,
          eventBus,
          appConfig: appConfig,
        });
        const pipelineOptions: PipelineOptions = {
          recoverJobs: false, // Web command doesn't support job recovery
          serverUrl,
          appConfig: appConfig,
        };
        const pipeline = serverUrl
          ? await PipelineFactory.createPipeline(undefined, eventBus, {
              serverUrl,
              ...pipelineOptions,
            })
          : await PipelineFactory.createPipeline(
              docService as DocumentManagementService,
              eventBus,
              pipelineOptions,
            );

        // Configure web-only server
        const config = createAppServerConfig({
          enableWebInterface: true,
          enableMcpServer: false,
          enableApiServer: false,
          enableWorker: !serverUrl,
          port: appConfig.server.ports.web,
          externalWorkerUrl: serverUrl,
          startupContext: {
            cliCommand: "web",
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
        logger.error(`❌ Failed to start web interface: ${error}`);
        process.exit(1);
      }
    },
  );
}
