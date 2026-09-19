/**
 * Compact command - Reclaims unused SQLite pages and truncates the WAL file.
 */

import type { Argv } from "yargs";
import { createDocumentManagement } from "../../store";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { loadConfig } from "../../utils/config";
import { logger } from "../../utils/logger";
import { formatBytes } from "../../utils/string";
import { renderTextOutput } from "../output";
import { type CliContext, getEventBus } from "../utils";

export function createCompactCommand(cli: Argv) {
  cli.command(
    "compact",
    "Reclaim unused space in the document store (exclusive lock; may block searches)",
    (yargs) => {
      return yargs
        .option("force", {
          type: "boolean",
          description: "Run VACUUM even when SQLite reports no free pages",
          default: false,
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
        command: "compact",
        useServerUrl: !!argv.serverUrl,
      });

      const serverUrl = argv.serverUrl as string | undefined;
      const appConfig = loadConfig(argv, {
        configPath: argv.config as string,
        searchDir: argv.storePath as string,
      });

      const eventBus = getEventBus(argv as CliContext);

      const docService = await createDocumentManagement({
        serverUrl,
        eventBus,
        appConfig,
      });
      try {
        const result = await docService.compact({ force: argv.force === true });

        if (result.skipped) {
          renderTextOutput("Skipped compaction for in-memory store.");
        } else if (result.reclaimedBytes > 0) {
          renderTextOutput(
            `Compacted store from ${formatBytes(result.beforeBytes)} to ${formatBytes(result.afterBytes)} (reclaimed ${formatBytes(result.reclaimedBytes)}).`,
          );
        } else {
          renderTextOutput("Store is already compact.");
        }
      } catch (error) {
        logger.error(
          `❌ Failed to compact store: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      } finally {
        await docService.shutdown();
      }
    },
  );
}
