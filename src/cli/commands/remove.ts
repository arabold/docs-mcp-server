/**
 * Remove command - Removes a library version, and the library with its last version.
 */

import type { Argv } from "yargs";
import { openBackend } from "../../services/backend";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { RemoveTool } from "../../tools/RemoveTool";
import { loadConfig } from "../../utils/config";
import { renderTextOutput } from "../output";
import { type CliContext, getEventBus } from "../utils";

export function createRemoveCommand(cli: Argv) {
  cli.command(
    "remove <library>",
    "Remove a library version from the index, and the library with its last version",
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
          description:
            "Version to remove; omit it to remove the unversioned documentation",
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

      // The same removal as remove_docs. Against a worker, the worker cancels
      // its job for the version first; locally this process runs no jobs.
      const backend = await openBackend({ serverUrl, eventBus, appConfig });
      try {
        // RemoveTool logs its own failure, prefixed once
        const { message } = await new RemoveTool(
          backend.docService,
          backend.pipeline,
        ).execute({ library, version });
        renderTextOutput(message);
      } finally {
        await backend.close();
      }
    },
  );
}
