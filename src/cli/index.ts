/**
 * Main CLI setup and command registration.
 */

import { Command, Option } from "commander";
import packageJson from "../../package.json";
import {
  analytics,
  createCliSession,
  shouldEnableTelemetry,
  TelemetryConfig,
} from "../telemetry";
import { LogLevel, setLogLevel } from "../utils/logger";
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

/**
 * Creates and configures the main CLI program with all commands.
 */
export function createCliProgram(): Command {
  const program = new Command();

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
    .addOption(new Option("--no-telemetry", "Disable telemetry collection"))
    .enablePositionalOptions()
    .allowExcessArguments(false)
    .showHelpAfterError(true);

  // Set up global options handling
  program.hook("preAction", async (thisCommand, actionCommand) => {
    const globalOptions: GlobalOptions = thisCommand.opts();

    // Setup logging
    if (globalOptions.silent) setLogLevel(LogLevel.ERROR);
    else if (globalOptions.verbose) setLogLevel(LogLevel.DEBUG);

    // Initialize telemetry if enabled
    if (shouldEnableTelemetry()) {
      const commandName = actionCommand.name();

      // Create session without embedding context - commands will provide this themselves
      const session = createCliSession(commandName);
      analytics.startSession(session);
    } else {
      TelemetryConfig.getInstance().disable();
    }
  });

  // Cleanup telemetry on command completion
  program.hook("postAction", async () => {
    if (analytics.isEnabled()) {
      analytics.endSession();
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
