/**
 * Search command - Searches documents in a library.
 */

import type { Command } from "commander";
import { createDocumentManagement } from "../../store";
import { SearchTool } from "../../tools";
import { createOptionWithEnv, formatOutput, resolveEmbeddingContext } from "../utils";

export async function searchAction(
  library: string,
  query: string,
  options: {
    version?: string;
    limit: string;
    exactMatch: boolean;
    embeddingModel?: string;
    serverUrl?: string;
  },
) {
  const serverUrl = options.serverUrl;

  // Resolve embedding configuration for local execution (search needs embeddings)
  const embeddingConfig = resolveEmbeddingContext(options.embeddingModel);
  if (!serverUrl && !embeddingConfig) {
    throw new Error(
      "Embedding configuration is required for local search. " +
        "Please set DOCS_MCP_EMBEDDING_MODEL environment variable or use --server-url for remote execution.",
    );
  }

  const docService = await createDocumentManagement({
    serverUrl,
    embeddingConfig,
  });

  try {
    const searchTool = new SearchTool(docService);

    // Call the tool directly - tracking is now handled inside the tool
    const result = await searchTool.execute({
      library,
      version: options.version,
      query,
      limit: Number.parseInt(options.limit, 10),
      exactMatch: options.exactMatch,
    });

    console.log(formatOutput(result.results));
  } finally {
    await docService.shutdown();
  }
}

export function createSearchCommand(program: Command): Command {
  return program
    .command("search <library> <query>")
    .description(
      "Search documents in a library. Version matching examples:\n" +
        "  - search react --version 18.0.0 'hooks' -> matches docs for React 18.0.0 or earlier versions\n" +
        "  - search react --version 18.0.0 'hooks' --exact-match -> only matches React 18.0.0\n" +
        "  - search typescript --version 5.x 'types' -> matches any TypeScript 5.x.x version\n" +
        "  - search typescript --version 5.2.x 'types' -> matches any TypeScript 5.2.x version",
    )
    .option(
      "-v, --version <string>",
      "Version of the library (optional, supports ranges)",
    )
    .option("-l, --limit <number>", "Maximum number of results", "5")
    .option("-e, --exact-match", "Only use exact version match (default: false)", false)
    .addOption(
      createOptionWithEnv(
        "--embedding-model <model>",
        "Embedding model configuration (e.g., 'openai:text-embedding-3-small')",
        ["DOCS_MCP_EMBEDDING_MODEL"],
      ),
    )
    .option(
      "--server-url <url>",
      "URL of external pipeline worker RPC (e.g., http://localhost:6280/api)",
    )
    .action(searchAction);
}
