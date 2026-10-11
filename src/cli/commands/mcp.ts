/**
 * MCP command - Starts MCP server only.
 */

import type { Argv } from "yargs";
import { startAppServer } from "../../app";
import { startStdioServer } from "../../mcp/startStdioServer";
import { initializeTools } from "../../mcp/tools";
import { openBackend } from "../../services/backend";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { loadConfig } from "../../utils/config";
import { LogLevel, logger, setLogLevel } from "../../utils/logger";
import {
  withAuthOptions,
  withPublicUrlOptions,
  withServerIdentityOptions,
} from "../options";
import { applyGlobalCliOutputMode } from "../output";
import { registerGlobalServices } from "../services";
import {
  type CliContext,
  checkAuthForProtocol,
  createAppServerConfig,
  getEventBus,
  handleEmbeddingModelChange,
  resolveProtocol,
  validatePort,
} from "../utils";

export function createMcpCommand(cli: Argv) {
  cli.command(
    "mcp",
    "Start the MCP server (Standalone Mode)",
    (yargs) =>
      withAuthOptions(
        withServerIdentityOptions(
          withPublicUrlOptions(
            yargs
              .option("protocol", {
                type: "string",
                description: "Protocol for MCP server",
                choices: ["auto", "stdio", "http"],
                defaultDescription: "auto",
              })
              .option("port", {
                type: "string",
                description: "Port for the MCP server",
              })
              .option("host", {
                type: "string",
                description: "Host to bind the MCP server to",
              }),
          ),
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
          })
          .option("read-only", {
            type: "boolean",
            description:
              "Run in read-only mode (only expose read tools, disable write/job tools)",
            defaultDescription: "false",
            alias: "readOnly",
          }),
      ),
    async (argv) => {
      // Reject a malformed --port before anything starts.
      validatePort((argv.port as string) || "6280");
      // Options the user did not pass are absent from argv, so the protocol,
      // read-only mode and auth come from env, config file or defaults here.
      // The logger writes to stderr, so loading before the stdio log level is
      // set cannot corrupt the protocol stream on stdout.
      const appConfig = loadConfig(argv, {
        configPath: argv.config as string,
        searchDir: argv.storePath as string, // resolvedStorePath passed via argv by middleware
      });

      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "mcp",
        protocol: appConfig.server.protocol,
        port: argv.port,
        host: argv.host,
        useServerUrl: !!argv.serverUrl,
        readOnly: appConfig.app.readOnly,
        authEnabled: appConfig.auth.enabled,
      });

      const resolvedProtocol = resolveProtocol(appConfig.server.protocol);
      if (resolvedProtocol === "stdio") {
        setLogLevel(LogLevel.ERROR);
      } else {
        applyGlobalCliOutputMode({
          verbose: argv.verbose as boolean,
          quiet: argv.quiet as boolean,
        });
      }

      checkAuthForProtocol(appConfig.auth, resolvedProtocol, appConfig.server.ports.mcp);

      try {
        const serverUrl = argv.serverUrl as string | undefined;

        const eventBus = getEventBus(argv as CliContext);

        const backend = await openBackend({
          appConfig,
          eventBus,
          serverUrl,
          jobs: { interruptedJobs: "fail" }, // MCP command doesn't support job recovery
          onEmbeddingModelChange: handleEmbeddingModelChange,
        });
        // Registered first, so shutdown closes it even when a server fails to start
        registerGlobalServices({ backend });

        if (resolvedProtocol === "stdio") {
          logger.debug(`Auto-detected stdio protocol (no TTY)`);
          const mcpTools = await initializeTools(
            backend.docService,
            backend.pipeline,
            appConfig,
          );
          const mcpServer = await startStdioServer(mcpTools, appConfig);

          registerGlobalServices({ mcpStdioServer: mcpServer });

          await new Promise(() => {});
        } else {
          logger.debug(`Auto-detected http protocol (TTY available)`);
          const config = createAppServerConfig({
            enableWebInterface: false,
            enableMcpServer: true,
            enableApiServer: false,
            port: appConfig.server.ports.mcp,
            showLogo: argv.logo as boolean,
            startupContext: {
              cliCommand: "mcp",
              mcpProtocol: "http",
            },
          });

          const appServer = await startAppServer(backend, config, appConfig);

          registerGlobalServices({ appServer });

          await new Promise(() => {});
        }
      } catch (error) {
        logger.error(`❌ Failed to start MCP server: ${error}`);
        process.exit(1);
      }
    },
  );
}
