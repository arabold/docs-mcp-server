/**
 * Remove command - Removes documents for a specific library and version.
 */

import type { Argv } from "yargs";
import { createDocumentManagement } from "../../store";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { loadConfig } from "../../utils/config";
import { type CliContext, getEventBus } from "../utils";

export function createRemoveCommand(cli: Argv) {
  cli.command(
    "remove <library>",
    "Delete a library's documentation from the index",
    (yargs) => {
      return yargs
        .version(false)
        .positional("library", {
          type: "string",
          description: "Library name to remove",
          demandOption: true,
        })
        .option("version", {
          type: "string",
          description: "Version to remove (optional, removes latest if omitted)",
          alias: "v",
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
        command: "remove",
        library: argv.library,
        version: argv.version,
        useServerUrl: !!argv.serverUrl,
      });

      const library = argv.library as string;
      const version = argv.version as string | undefined;
      const serverUrl = argv.serverUrl as string | undefined;

      const appConfig = loadConfig(argv, {
        configPath: argv.config as string,
        searchDir: argv.storePath as string, // resolved globally
      });

      const eventBus = getEventBus(argv as CliContext);

      // Remove command doesn't need embeddings - explicitly disable for local execution
      const docService = await createDocumentManagement({
        serverUrl,
        eventBus,
        appConfig: appConfig,
      });
      try {
        // Call the document service directly - we could convert this to use RemoveTool if needed
        await docService.removeAllDocuments(library, version);

        console.log(`✅ Successfully removed ${library}${version ? `@${version}` : ""}.`);
      } catch (error) {
        console.error(
          `❌ Failed to remove ${library}${version ? `@${version}` : ""}:`,
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      } finally {
        await docService.shutdown();
      }
    },
  );
}
