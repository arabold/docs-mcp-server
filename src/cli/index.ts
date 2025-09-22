/**
 * Main CLI setup and command registration.
 */

import { Command, Option } from "commander";
import packageJson from "../../package.json";
import {
  analytics,
  initTelemetry,
  shouldEnableTelemetry,
  TelemetryEvent,
} from "../telemetry";
import { createDefaultAction } from "./commands/default";
import { createFetchUrlCommand } from "./commands/fetchUrl";
import { createFindVersionCommand } from "./commands/findVersion";
import { createListCommand } from "./commands/list";
import { createMcpCommand } from "./commands/mcp";
import { createRemoveCommand } from "./commands/remove";
import { createScrapeCommand } from "./commands/scrape";
import { createSearchCommand } from "./commands/search";
import { createWebCommand } from "./commands/web";
import { createWorkerCommand } from "./commands/worker";
import type { GlobalOptions } from "./types";
import { setupLogging } from "./utils";

/**
 * Creates and configures the main CLI program with all commands.
 */
export function createCliProgram(): Command {
  const program = new Command();

  // Store command start times for duration tracking
  const commandStartTimes = new Map<string, number>();

  // Configure main program
  program
    .name("docs-mcp-server")
    .description("Unified CLI, MCP Server, and Web Interface for Docs MCP Server.")
    .version(packageJson.version)
    // Mutually exclusive logging flags
    .addOption(
      new Option("--verbose", "Enable verbose (debug) logging").conflicts("silent"),
    )
    .addOption(new Option("--silent", "Disable all logging except errors"))
    .addOption(
      new Option("--telemetry", "Enable telemetry collection")
        .env("DOCS_MCP_TELEMETRY")
        .argParser((value) => {
          if (value === undefined) {
            return (
              process.env.DOCS_MCP_TELEMETRY !== "false" &&
              process.env.DOCS_MCP_TELEMETRY !== "0"
            );
          }
          return value;
        })
        .default(true),
    )
    .addOption(new Option("--no-telemetry", "Disable telemetry collection"))
    .addOption(
      new Option("--store-path <path>", "Custom path for data storage directory").env(
        "DOCS_MCP_STORE_PATH",
      ),
    )
    .enablePositionalOptions()
    .allowExcessArguments(false)
    .showHelpAfterError(true);

  // Set up global options handling
  program.hook("preAction", async (thisCommand, actionCommand) => {
    const globalOptions: GlobalOptions = thisCommand.opts();

    // Setup logging
    setupLogging(globalOptions);

    // Initialize telemetry system with proper configuration
    initTelemetry({
      enabled: globalOptions.telemetry ?? true,
      storePath: globalOptions.storePath,
    });

    // Initialize telemetry if enabled
    if (shouldEnableTelemetry()) {
      // Set global context for CLI commands
      if (analytics.isEnabled()) {
        analytics.setGlobalContext({
          appVersion: packageJson.version,
          appPlatform: process.platform,
          appNodeVersion: process.version,
          appInterface: "cli",
          cliCommand: actionCommand.name(),
        });

        // Store command start time for duration tracking
        const commandKey = `${actionCommand.name()}-${Date.now()}`;
        commandStartTimes.set(commandKey, Date.now());
        // Store the key for retrieval in postAction
        (actionCommand as { _trackingKey?: string })._trackingKey = commandKey;
      }
    }
  });

  // Track CLI command completion
  program.hook("postAction", async (_thisCommand, actionCommand) => {
    if (analytics.isEnabled()) {
      // Track CLI_COMMAND event for all CLI commands (standalone and server)
      const trackingKey = (actionCommand as { _trackingKey?: string })._trackingKey;
      const startTime = trackingKey ? commandStartTimes.get(trackingKey) : Date.now();
      const durationMs = startTime ? Date.now() - startTime : 0;

      // Clean up the tracking data
      if (trackingKey) {
        commandStartTimes.delete(trackingKey);
      }

      analytics.track(TelemetryEvent.CLI_COMMAND, {
        cliCommand: actionCommand.name(),
        success: true, // If we reach postAction, command succeeded
        durationMs,
      });

      await analytics.shutdown();
    }
  });

  // Register all commands
  createMcpCommand(program);
  createWebCommand(program);
  createWorkerCommand(program);
  createScrapeCommand(program);
  createSearchCommand(program);
  createListCommand(program);
  createFindVersionCommand(program);
  createRemoveCommand(program);
  createFetchUrlCommand(program);

  // Set default action for when no subcommand is specified
  createDefaultAction(program);

  return program;
}
