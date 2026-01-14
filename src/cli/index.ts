/**
 * Main CLI setup and command registration using Yargs.
 */

import yargs, { type Argv } from "yargs";
import { hideBin } from "yargs/helpers";
import { EventBusService } from "../events";
import {
  initTelemetry,
  shouldEnableTelemetry,
  TelemetryService,
  telemetry,
} from "../telemetry";
import { loadConfig } from "../utils/config";
import { resolveStorePath } from "../utils/paths";
// Commands
import { createConfigCommand } from "./commands/config";
import { createDefaultAction } from "./commands/default";
import { createFetchUrlCommand } from "./commands/fetchUrl";
import { createFindVersionCommand } from "./commands/findVersion";
import { createListCommand } from "./commands/list";
import { createMcpCommand } from "./commands/mcp";
import { createRefreshCommand } from "./commands/refresh";
import { createRemoveCommand } from "./commands/remove";
import { createScrapeCommand } from "./commands/scrape";
import { createSearchCommand } from "./commands/search";
import { createWebCommand } from "./commands/web";
import { createWorkerCommand } from "./commands/worker";
import { registerGlobalServices } from "./services";
import { setupLogging } from "./utils";

/**
 * Creates and configures the main CLI program with all commands.
 */

/**
 * Creates and configures the main CLI program with all commands.
 */
export function createCli(argv: string[]): Argv {
  // Global service instances
  let globalEventBus: EventBusService | null = null;
  let globalTelemetryService: TelemetryService | null = null;
  const commandStartTimes = new Map<string, number>();

  const cli = yargs(hideBin(argv))
    .scriptName("docs-mcp-server")
    .strict()
    .usage("Usage: $0 <command> [options]")
    .version(__APP_VERSION__)
    // Global Options
    .option("verbose", {
      type: "boolean",
      description: "Enable verbose (debug) logging",
      default: false,
    })
    .option("silent", {
      type: "boolean",
      description: "Disable all logging except errors",
      default: false,
    })
    .option("telemetry", {
      type: "boolean",
      description: "Enable/disable telemetry collection",
      // yargs handles boolean logic for --no-telemetry automatically if strictly typed
      // but we want tri-state or env var handling.
      // Yargs doesn't naturally do "default: true, but respecting env var DOCS_MCP_TELEMETRY"
      // without middleware overriding.
      default: undefined, // Let config loader handle defaults
    })
    .option("store-path", {
      type: "string",
      description: "Custom path for data storage directory",
      alias: "storePath",
    })
    .option("config", {
      type: "string",
      description: "Path to configuration file",
    })
    .option("logo", {
      type: "boolean",
      description: "Show ASCII art logo on startup",
      default: true,
    })
    // Middleware for Global Setup (similar to preAction)
    .middleware(async (argv) => {
      // 0. Validate Options
      if (argv.verbose && argv.silent) {
        throw new Error("Arguments verbose and silent are mutually exclusive");
      }

      // 1. Load Config & Resolve Paths
      const rawStorePath = (argv.storePath as string) || process.env.DOCS_MCP_STORE_PATH;
      const resolvedStorePath = resolveStorePath(rawStorePath);

      // Mutate argv to use resolved path
      argv.storePath = resolvedStorePath;

      const appConfig = loadConfig(argv, {
        configPath: argv.config as string,
        searchDir: resolvedStorePath,
      });

      // Update options with config values if not set by CLI
      if (argv.telemetry === undefined) {
        argv.telemetry = appConfig.app.telemetryEnabled;
      }

      // 2. Setup Logging
      setupLogging({
        verbose: argv.verbose as boolean,
        silent: argv.silent as boolean,
      });

      // 3. Init Telemetry
      initTelemetry({
        enabled: !!argv.telemetry,
        storePath: resolvedStorePath,
      });

      // 4. Init Services
      if (!globalEventBus) {
        globalEventBus = new EventBusService();
      }
      if (!globalTelemetryService) {
        globalTelemetryService = new TelemetryService(globalEventBus);
        registerGlobalServices({ telemetryService: globalTelemetryService });
      }

      // 5. Attach to argv context
      // This makes global services available to all commands
      argv._eventBus = globalEventBus;

      // 6. Telemetry Context
      if (shouldEnableTelemetry() && telemetry.isEnabled()) {
        const commandName = argv._[0]?.toString() || "default";
        telemetry.setGlobalContext({
          appVersion: __APP_VERSION__,
          appPlatform: process.platform,
          appNodeVersion: process.version,
          appInterface: "cli",
          cliCommand: commandName,
        });

        const commandKey = `${commandName}-${Date.now()}`;
        commandStartTimes.set(commandKey, Date.now());
        argv._trackingKey = commandKey;
      }
    })
    // Post-command tracking is handled by yargs 'onFinishCommand' or similar?
    // Yargs doesn't have a direct 'postAction' hook for all commands easily.
    // We can handle it in the handler wrapper or use 'onFinishCommand' if available (it isn't).
    // An alternative is using middleware that runs after? No.
    // We will rely on explicit telemetry calls in command handlers or wrap usage.
    // However, existing `main.ts` handles cleanup.
    // We can add a global `finish` logic if needed.
    // For now, we'll keep the start time tracking here, but actual completion tracking might need to be in handlers.
    // BUT legacy code had `postAction` hook for `CLI_COMMAND` event.
    // We can simulate this by wrapping commands or using `cli.on('finish', ...)`?
    // Yargs doesn't emit finish events.
    // We might need to move the `CLI_COMMAND` tracking into `main.ts` or inside `createDefaultAction`.

    .alias("help", "h")
    .showHelpOnFail(true);

  // Register Commands
  createConfigCommand(cli);
  createDefaultAction(cli);
  createFetchUrlCommand(cli);
  createFindVersionCommand(cli);
  createListCommand(cli);
  createMcpCommand(cli);
  createRefreshCommand(cli);
  createRemoveCommand(cli);
  createScrapeCommand(cli);
  createSearchCommand(cli);
  createWebCommand(cli);
  createWorkerCommand(cli);

  return cli;
}
