/**
 * Search command - Searches documents in a library.
 */

import type { Argv } from "yargs";
import { createDocumentManagement } from "../../store";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { SearchTool } from "../../tools";
import { loadConfig } from "../../utils/config";
import { type CliContext, formatOutput, getEventBus } from "../utils";

export function createSearchCommand(cli: Argv) {
  cli.command(
    "search <library> <query>",
    "Query the documentation index used by the MCP server",
    (yargs) => {
      return yargs
        .version(false)
        .positional("library", {
          type: "string",
          description: "Library name",
          demandOption: true,
        })
        .positional("query", {
          type: "string",
          description: "Search query",
          demandOption: true,
        })
        .option("version", {
          type: "string",
          description: "Version of the library (optional, supports ranges)",
          alias: "v",
        })
        .option("limit", {
          type: "number",
          description: "Maximum number of results",
          alias: "l",
          default: 5,
        })
        .option("exact-match", {
          type: "boolean",
          description: "Only use exact version match",
          default: false,
          alias: ["e", "exactMatch"],
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
          "$0 search <library> <query> [options]\n\n" +
            "Search documents in a library. Version matching examples:\n" +
            "  - search react --version 18.0.0 'hooks' -> matches docs for React 18.0.0 or earlier versions\n" +
            "  - search react --version 18.0.0 'hooks' --exact-match -> only matches React 18.0.0\n" +
            "  - search typescript --version 5.x 'types' -> matches any TypeScript 5.x.x version\n" +
            "  - search typescript --version 5.2.x 'types' -> matches any TypeScript 5.2.x version",
        );
    },
    async (argv) => {
      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "search",
        library: argv.library,
        version: argv.version,
        query: argv.query,
        limit: argv.limit,
        exactMatch: argv.exactMatch,
        useServerUrl: !!argv.serverUrl,
      });

      const library = argv.library as string;
      const query = argv.query as string;
      const limit = argv.limit as number;
      const serverUrl = argv.serverUrl as string | undefined;

      const appConfig = loadConfig(argv, {
        configPath: argv.config as string,
        searchDir: argv.storePath as string, // resolved globally
      });

      const eventBus = getEventBus(argv as CliContext);

      const docService = await createDocumentManagement({
        serverUrl,
        eventBus,
        appConfig: appConfig,
      });

      try {
        const searchTool = new SearchTool(docService);

        // Call the tool directly - tracking is now handled inside the tool
        const result = await searchTool.execute({
          library,
          version: argv.version as string | undefined,
          query,
          limit,
          exactMatch: argv.exactMatch as boolean,
        });

        console.log(formatOutput(result.results));
      } finally {
        await docService.shutdown();
      }
    },
  );
}
