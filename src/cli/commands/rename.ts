/**
 * Rename command - Renames a library in place, keeping its versions and indexed content.
 */

import type { Argv } from "yargs";
import { openBackend } from "../../services/backend";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { RenameTool } from "../../tools/RenameTool";
import { loadConfig } from "../../utils/config";
import { renderTextOutput } from "../output";
import { type CliContext, getEventBus } from "../utils";

export function createRenameCommand(cli: Argv) {
  cli.command(
    "rename <library> <new-name>",
    "Rename a library in place, keeping its versions and indexed content",
    (yargs) => {
      return yargs
        .version(false)
        .positional("library", {
          type: "string",
          description: "Current library name",
          demandOption: true,
        })
        .positional("new-name", {
          type: "string",
          description: "New library name",
          demandOption: true,
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
        command: "rename",
        library: argv.library,
        newName: argv.newName,
        useServerUrl: !!argv.serverUrl,
      });

      const library = argv.library as string;
      const newName = argv.newName as string;
      const serverUrl = argv.serverUrl as string | undefined;

      const appConfig = loadConfig(argv, {
        configPath: argv.config as string,
        searchDir: argv.storePath as string, // resolved globally
      });

      const eventBus = getEventBus(argv as CliContext);

      // The rename applies locally or is forwarded to the worker, where the
      // store refuses it while the library has an indexing job in flight.
      const backend = await openBackend({ serverUrl, eventBus, appConfig });
      try {
        // RenameTool logs its own failure, prefixed once
        const { message } = await new RenameTool(backend.docService).execute({
          library,
          newName,
        });
        renderTextOutput(message);
      } finally {
        await backend.close();
      }
    },
  );
}
