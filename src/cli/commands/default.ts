/**
 * Default command - Starts unified server when no subcommand is specified.
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
  withModelChangeOptions,
  withPublicUrlOptions,
  withServerIdentityOptions,
} from "../options";
import { applyGlobalCliOutputMode } from "../output";
import { registerGlobalServices } from "../services";
import {
  type CliContext,
  checkAuthForProtocol,
  createAppServerConfig,
  ensurePlaywrightBrowsersInstalled,
  getEventBus,
  handleEmbeddingModelChange,
  resolveProtocol,
} from "../utils";

export function createDefaultAction(cli: Argv) {
  cli.command(
    ["$0", "server"],
    "Starts the Docs MCP server (Unified Mode)",
    (yargs) =>
      withAuthOptions(
        withServerIdentityOptions(
          withPublicUrlOptions(
            withModelChangeOptions(yargs)
              .option("protocol", {
                type: "string",
                description: "Protocol for MCP server",
                choices: ["auto", "stdio", "http"],
                defaultDescription: "auto",
              })
              .option("port", {
                type: "string", // Keep as string to match old behavior/validation, or number? Using string allows environment variable mapping via loadConfig if strict number parsing isn't desired immediately. Actually validation logic expects string often. But Yargs can parse number.
                description: "Port for the server",
              })
              .option("host", {
                type: "string",
                description: "Host to bind the server to",
              }),
          ),
        )
          .option("embedding-model", {
            type: "string",
            description:
              "Embedding model configuration (e.g., 'openai:text-embedding-3-small')",
            alias: "embeddingModel",
          })
          .option("resume", {
            type: "boolean",
            description: "Resume interrupted jobs on startup",
            default: false,
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
      // Options the user did not pass are absent from argv, so the protocol,
      // read-only mode and auth come from env, config file or defaults here.
      // The logger writes to stderr, so loading before the stdio log level is
      // set cannot corrupt the protocol stream on stdout.
      const appConfig = loadConfig(argv, {
        configPath: argv.config as string,
        searchDir: argv.storePath as string,
      });

      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "default",
        protocol: appConfig.server.protocol,
        port: argv.port,
        host: argv.host,
        resume: argv.resume,
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

      logger.debug("No subcommand specified, starting unified server by default...");

      checkAuthForProtocol(
        appConfig.auth,
        resolvedProtocol,
        appConfig.server.ports.default,
      );

      ensurePlaywrightBrowsersInstalled();

      const eventBus = getEventBus(argv as CliContext);

      const backend = await openBackend({
        appConfig,
        eventBus,
        // A read-only server runs no jobs, so it leaves interrupted ones to the
        // process that does
        jobs: {
          interruptedJobs: appConfig.app.readOnly
            ? "leave"
            : argv.resume
              ? "recover"
              : "fail",
        },
        onEmbeddingModelChange: (error, service) =>
          handleEmbeddingModelChange(
            error,
            service,
            argv.acceptModelChange as boolean | undefined,
          ),
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
          enableWebInterface: true,
          enableMcpServer: true,
          enableApiServer: true,
          port: appConfig.server.ports.default,
          showLogo: argv.logo as boolean,
          startupContext: {
            cliCommand: "default",
            mcpProtocol: "http",
          },
        });

        const appServer = await startAppServer(backend, config, appConfig);

        registerGlobalServices({ appServer });

        await new Promise(() => {}); // Keep running
      }
    },
  );
}
