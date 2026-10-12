/**
 * Web command - Starts web interface only.
 */

import type { Argv } from "yargs";
import { startAppServer } from "../../app";
import { openBackend } from "../../services/backend";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { loadConfig } from "../../utils/config";
import { logger } from "../../utils/logger";
import { withPublicUrlOptions } from "../options";
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
      return withPublicUrlOptions(
        yargs
          .option("port", {
            type: "string",
            description: "Port for the web interface",
          })
          .option("host", {
            type: "string",
            description: "Host to bind the web interface to",
          }),
      )
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

        const backend = await openBackend({
          appConfig,
          eventBus,
          serverUrl,
          jobs: { recoverJobs: false }, // Web command doesn't support job recovery
        });
        // Registered first, so shutdown closes it even when a server fails to start
        registerGlobalServices({ backend });

        // Configure web-only server
        const config = createAppServerConfig({
          enableWebInterface: true,
          enableMcpServer: false,
          enableApiServer: true,
          port: appConfig.server.ports.web,
          showLogo: argv.logo as boolean,
          startupContext: {
            cliCommand: "web",
          },
        });

        const appServer = await startAppServer(backend, config, appConfig);

        registerGlobalServices({ appServer });

        await new Promise(() => {}); // Keep running forever
      } catch (error) {
        logger.error(`❌ Failed to start web interface: ${error}`);
        process.exit(1);
      }
    },
  );
}
