/**
 * Refresh command - Re-scrapes an existing library version using ETags to skip unchanged pages.
 */

import type { Argv } from "yargs";
import { openBackend } from "../../services/backend";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { RefreshVersionTool } from "../../tools/RefreshVersionTool";
import { loadConfig } from "../../utils/config";
import { logger } from "../../utils/logger";
import { followJobLogs } from "../JobOutputFollower";
import { renderTextOutput } from "../output";
import { registerGlobalServices } from "../services";
import { type CliContext, getEventBus } from "../utils";

export function createRefreshCommand(cli: Argv) {
  cli.command(
    "refresh <library>",
    "Update an existing library version by re-scraping changed pages",
    (yargs) => {
      return yargs
        .version(false)
        .positional("library", {
          type: "string",
          description: "Library name to refresh",
          demandOption: true,
        })
        .option("version", {
          type: "string",
          description: "Version of the library (optional)",
          alias: "v",
        })
        .option("preserve-hashes", {
          type: "boolean",
          description: "Override the stored hash-route setting for this refresh job",
          alias: "preserveHashes",
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
        })
        .usage(
          "$0 refresh <library> [options]\n\n" +
            "Uses HTTP ETags to efficiently skip unchanged pages and only re-process\n" +
            "content that has been modified or deleted since the last scrape.\n\n" +
            "Examples:\n" +
            "  refresh react --version 18.0.0\n" +
            "  refresh mylib\n" +
            "\nNote: The library and version must already be indexed. Use 'scrape' to index a new library/version.",
        );
    },
    async (argv) => {
      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "refresh",
        library: argv.library,
        version: argv.version,
        preserveHashes: argv.preserveHashes,
        useServerUrl: !!argv.serverUrl,
      });

      const library = argv.library as string;
      const version = argv.version as string | undefined;
      const serverUrl = argv.serverUrl as string | undefined;

      const appConfig = loadConfig(argv, {
        configPath: argv.config as string,
        searchDir: argv.storePath as string,
      });

      const eventBus = getEventBus(argv as CliContext);

      const backend = await openBackend({
        serverUrl,
        eventBus,
        appConfig,
        // Runs only its own job; the process hosting the store handles the rest
        jobs: { interruptedJobs: "leave" },
      });

      // Display initial status
      logger.info("⏳ Initializing refresh job...");

      registerGlobalServices({ backend });

      // Report this command's own job; a shared worker also runs other clients' jobs
      const follower = followJobLogs(backend.eventBus, "Refreshing");

      try {
        const refreshTool = new RefreshVersionTool(backend.pipeline);

        // Call the tool directly - tracking is now handled inside the tool
        const result = await refreshTool.execute({
          onJobEnqueued: (jobId) => follower.follow(jobId),
          library,
          version,
          preserveHashes: argv.preserveHashes as boolean | undefined,
          waitForCompletion: true, // Always wait for completion in CLI
        });

        if ("pagesRefreshed" in result) {
          renderTextOutput(`Successfully refreshed ${result.pagesRefreshed} pages`);
        } else {
          renderTextOutput(`Refresh job started with ID: ${result.jobId}`);
        }
      } finally {
        follower.dispose();

        await backend.close();
      }
    },
  );
}
