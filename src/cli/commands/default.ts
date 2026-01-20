/**
 * Default command - Starts unified server when no subcommand is specified.
 */

import type { Argv } from "yargs";
import { startAppServer } from "../../app";
import { startStdioServer } from "../../mcp/startStdioServer";
import { initializeTools } from "../../mcp/tools";
import { PipelineFactory, type PipelineOptions } from "../../pipeline";
import { createLocalDocumentManagement } from "../../store";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { loadConfig } from "../../utils/config";
import { LogLevel, logger, setLogLevel } from "../../utils/logger";
import { registerGlobalServices } from "../services";
import {
  type CliContext,
  createAppServerConfig,
  ensurePlaywrightBrowsersInstalled,
  getEventBus,
  parseAuthConfig,
  resolveProtocol,
  validateAuthConfig,
  warnHttpUsage,
} from "../utils";

export function createDefaultAction(cli: Argv) {
  cli.command(
    ["$0", "server"],
    "Starts the Docs MCP server (Unified Mode)",
    (yargs) => {
      return (
        yargs
          .option("protocol", {
            type: "string",
            description: "Protocol for MCP server",
            choices: ["auto", "stdio", "http"],
            default: "auto",
          })
          .option("port", {
            type: "string", // Keep as string to match old behavior/validation, or number? Using string allows environment variable mapping via loadConfig if strict number parsing isn't desired immediately. Actually validation logic expects string often. But Yargs can parse number.
            description: "Port for the server",
          })
          .option("host", {
            type: "string",
            description: "Host to bind the server to",
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
            default: false,
          })
          .option("read-only", {
            type: "boolean",
            description:
              "Run in read-only mode (only expose read tools, disable write/job tools)",
            default: false,
            alias: "readOnly",
          })
          // Auth options
          .option("auth-enabled", {
            type: "boolean",
            description: "Enable OAuth2/OIDC authentication for MCP endpoints",
            default: false,
            alias: "authEnabled",
          })
          .option("auth-issuer-url", {
            type: "string",
            description: "Issuer/discovery URL for OAuth2/OIDC provider",
            alias: "authIssuerUrl",
          })
          .option("auth-audience", {
            type: "string",
            description: "JWT audience claim (identifies this protected resource)",
            alias: "authAudience",
          })
      );
    },
    async (argv) => {
      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "default",
        protocol: argv.protocol,
        port: argv.port,
        host: argv.host,
        resume: argv.resume,
        readOnly: argv.readOnly,
        authEnabled: !!argv.authEnabled,
      });

      const resolvedProtocol = resolveProtocol(argv.protocol as string);
      if (resolvedProtocol === "stdio") {
        setLogLevel(LogLevel.ERROR);
      }

      logger.debug("No subcommand specified, starting unified server by default...");

      // Validate inputs if provided, otherwise validation happens after config load?
      // Old logic validated options.port etc. but yargs parsing might be loose?
      // Since we don't have defaults in Yargs, argv.port might be undefined.
      // logic below uses loadConfig which fills defaults.
      // So validation should happen AFTER loadConfig on the RESULTING config?
      // OR we validate argv if present?
      // The old logic validated valid integers.
      // We will rely on Zod schema validation inside loadConfig.

      const appConfig = loadConfig(argv, {
        configPath: argv.config as string,
        searchDir: argv.storePath as string,
      });

      // Propagate resolved store path? loadConfig logic handled it?
      // loadConfig takes argv, so it mapped `storePath` to `app.storePath`.
      // But `argv.storePath` was resolved by middleware in index.ts?
      // Yes. So appConfig has resolved path.

      // Parse and validate auth config
      const authConfig = parseAuthConfig({
        authEnabled: appConfig.auth.enabled,
        authIssuerUrl: appConfig.auth.issuerUrl,
        authAudience: appConfig.auth.audience,
      });

      if (authConfig) {
        validateAuthConfig(authConfig);
        warnHttpUsage(authConfig, appConfig.server.ports.default);
      }

      ensurePlaywrightBrowsersInstalled();

      const eventBus = getEventBus(argv as CliContext);

      const docService = await createLocalDocumentManagement(eventBus, appConfig);
      const pipelineOptions: PipelineOptions = {
        recoverJobs: (argv.resume as boolean) || false,
        appConfig: appConfig,
      };
      const pipeline = await PipelineFactory.createPipeline(
        docService,
        eventBus,
        pipelineOptions,
      );

      if (resolvedProtocol === "stdio") {
        logger.debug(`Auto-detected stdio protocol (no TTY)`);
        await pipeline.start();
        const mcpTools = await initializeTools(docService, pipeline, appConfig);
        const mcpServer = await startStdioServer(mcpTools, appConfig);

        registerGlobalServices({
          mcpStdioServer: mcpServer,
          docService,
          pipeline,
        });

        await new Promise(() => {});
      } else {
        logger.debug(`Auto-detected http protocol (TTY available)`);
        const config = createAppServerConfig({
          enableWebInterface: true,
          enableMcpServer: true,
          enableApiServer: true,
          enableWorker: true,
          port: appConfig.server.ports.default,
          showLogo: argv.logo as boolean,
          startupContext: {
            cliCommand: "default",
            mcpProtocol: "http",
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

        await new Promise(() => {}); // Keep running
      }
    },
  );
}
