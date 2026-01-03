/**
 * Find version command - Finds the best matching version for a library.
 */

import type { Argv } from "yargs";
import { createDocumentManagement } from "../../store";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { FindVersionTool } from "../../tools";
import { loadConfig } from "../../utils/config";
import { type CliContext, getEventBus } from "../utils";

export function createFindVersionCommand(cli: Argv) {
  cli.command(
    "find-version <library>",
    "Resolve and display the best matching documentation version for a library",
    (yargs) => {
      return yargs
        .version(false)
        .positional("library", {
          type: "string",
          description: "Library name",
          demandOption: true,
        })
        .option("version", {
          type: "string",
          description: "Pattern to match (optional, supports ranges)",
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
        command: "find-version",
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

      // Find version command doesn't need embeddings - explicitly disable for local execution
      const docService = await createDocumentManagement({
        serverUrl,
        eventBus,
        appConfig: appConfig,
      });
      try {
        const findVersionTool = new FindVersionTool(docService);

        // Call the tool directly - tracking is now handled inside the tool
        const versionInfo = await findVersionTool.execute({
          library,
          targetVersion: version,
        });

        if (!versionInfo) throw new Error("Failed to get version information");
        console.log(versionInfo);
      } finally {
        await docService.shutdown();
      }
    },
  );
}
