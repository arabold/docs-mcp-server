/**
 * List command - Lists all available libraries and their versions.
 */

import type { Argv } from "yargs";
import { createDocumentManagement } from "../../store";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { ListLibrariesTool } from "../../tools";
import { loadConfig } from "../../utils/config";
import { type CliContext, formatOutput, getEventBus } from "../utils";

export function createListCommand(cli: Argv) {
  cli.command(
    "list",
    "List all indexed libraries and their available versions",
    (yargs) => {
      return yargs.option("server-url", {
        type: "string",
        description:
          "URL of external pipeline worker RPC (e.g., http://localhost:8080/api)",
        alias: "serverUrl",
      });
    },
    async (argv) => {
      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "list",
        useServerUrl: !!argv.serverUrl,
      });

      const serverUrl = argv.serverUrl as string | undefined;
      const appConfig = loadConfig(argv, {
        configPath: argv.config as string,
        searchDir: argv.storePath as string, // resolved globally in index.ts middleware
      });

      const eventBus = getEventBus(argv as CliContext);

      // List command doesn't need embeddings - explicitly disable for local execution
      const docService = await createDocumentManagement({
        eventBus,
        serverUrl,
        appConfig: appConfig,
      });
      try {
        const listLibrariesTool = new ListLibrariesTool(docService);

        // Call the tool directly - tracking is now handled inside the tool
        const result = await listLibrariesTool.execute();

        console.log(formatOutput(result.libraries));
      } finally {
        await docService.shutdown();
      }
    },
  );
}
