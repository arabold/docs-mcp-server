/**
 * Default command - Starts unified server when no subcommand is specified.
 */

import type { Argv } from "yargs";
import { startAppServer } from "../../app";
import { startStdioServer } from "../../mcp/startStdioServer";
import { initializeTools } from "../../mcp/tools";
import { PipelineFactory, type PipelineOptions } from "../../pipeline";
import { DocumentManagementService } from "../../store";
import { EmbeddingModelChangedError } from "../../store/errors";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { loadConfig } from "../../utils/config";
import { LogLevel, logger, setLogLevel } from "../../utils/logger";
import { applyGlobalCliOutputMode } from "../output";
import { registerGlobalServices } from "../services";
import {
  type CliContext,
  createAppServerConfig,
  ensurePlaywrightBrowsersInstalled,
  getEventBus,
  handleEmbeddingModelChange,
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
            defaultDescription: "auto",
          })
          .option("port", {
            type: "string", // Keep as string to match old behavior/validation, or number? Using string allows environment variable mapping via loadConfig if strict number parsing isn't desired immediately. Actually validation logic expects string often. But Yargs can parse number.
            description: "Port for the server",
          })
          .option("host", {
            type: "string",
            description: "Host to bind the server to",
          })
          .option("public-url", {
            type: "string",
            description:
              "Public URL clients use to reach the server, optionally with a path (e.g., https://example.com/docs)",
            alias: "publicUrl",
          })
          .option("public-origin", {
            type: "string",
            description: "Deprecated: use --public-url",
            alias: "publicOrigin",
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
            defaultDescription: "false",
            alias: "readOnly",
          })
          // Auth options
          .option("auth-enabled", {
            type: "boolean",
            description: "Enable OAuth2/OIDC authentication for MCP endpoints",
            defaultDescription: "false",
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

      // Propagate resolved store path? loadConfig logic handled it?
      // loadConfig takes argv, so it mapped `storePath` to `app.storePath`.
      // But `argv.storePath` was resolved by middleware in index.ts?
      // Yes. So appConfig has resolved path.

      // Authentication applies to MCP over HTTP only. Over stdio the host
      // launching the process is the trust boundary, so auth settings are
      // ignored; the warning goes to stderr, which never carries protocol data.
      if (resolvedProtocol === "stdio") {
        if (appConfig.auth.enabled) {
          console.error(
            "⚠️  Authentication does not apply to MCP over stdio; auth settings are ignored.",
          );
        }
      } else {
        const authConfig = parseAuthConfig({
          authEnabled: appConfig.auth.enabled,
          authIssuerUrl: appConfig.auth.issuerUrl,
          authAudience: appConfig.auth.audience,
        });

        if (authConfig) {
          validateAuthConfig(authConfig);
          warnHttpUsage(authConfig, appConfig.server.ports.default);
        }
      }

      ensurePlaywrightBrowsersInstalled();

      const eventBus = getEventBus(argv as CliContext);

      const docService = new DocumentManagementService(eventBus, appConfig);
      try {
        await docService.initialize();
      } catch (error) {
        if (error instanceof EmbeddingModelChangedError) {
          await handleEmbeddingModelChange(error, docService);
        } else {
          throw error;
        }
      }
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
