import envPaths from "env-paths";
import { EventBusService } from "../events/EventBusService";
import { createDocumentManagement } from "../store";
import { SearchTool } from "../tools";
import { loadConfig } from "../utils/config";
import { LogLevel, setLogLevel } from "../utils/logger";

async function main() {
  // Silence logs to prevent pollution of stdout (JSON output)
  setLogLevel(LogLevel.ERROR);

  // DEBUG: Print args
  // console.error("ARGV:", JSON.stringify(process.argv));

  // Parse arguments to handle Promptfoo's format
  // Format: node vite-node [script?] <prompt> <context-json>
  // Note: vite-node might swallow the script path from argv

  const args = process.argv.slice(2);
  interface Context {
    vars?: Record<string, string>;
  }
  let context: Context = {};

  // 1. Identify and remove Context JSONs (last args)
  // Promptfoo might pass multiple JSON objects (options, context)
  while (args.length > 0) {
    const lastArg = args[args.length - 1];
    if (lastArg.trim().startsWith("{") && lastArg.trim().endsWith("}")) {
      try {
        const parsed = JSON.parse(lastArg);
        // Only accept if it looks like the context object (has vars) or options
        if (parsed.vars || parsed.options) {
          if (parsed.vars) context = parsed;
          args.pop(); // Remove context from args
        } else {
          // Might be part of the query if it's a valid JSON but not our context
          break;
        }
      } catch (e) {
        // Not valid JSON, stop removing
        break;
      }
    } else {
      break;
    }
  }

  // 2. The rest is the query
  const query = args.join(" ").trim();
  // console.error(`DEBUG: Executing search for query: "${query}"`);

  // 3. Determine Library (Context -> Env -> Default)
  const library = context.vars?.library || process.env.LIBRARY || "react";

  if (!query) {
    console.error("Error: No query provided");
    console.error("Args received:", process.argv);
    process.exit(1);
  }

  // 4. Initialize System
  // We use default config path logic (system path or env vars)
  // Ensure DOCS_MCP_STORE_PATH is set if running in a specific environment
  const appConfig = loadConfig();

  // Fallback to default system path if storePath is not set
  if (!appConfig.app.storePath) {
    const paths = envPaths("docs-mcp-server", { suffix: "" });
    appConfig.app.storePath = paths.data;
    // console.error(`DEBUG: Using default store path: ${appConfig.app.storePath}`);
  }

  const eventBus = new EventBusService();

  // Create service (headless)
  const docService = await createDocumentManagement({
    appConfig,
    eventBus,
  });

  try {
    // 5. Verify Library Exists (Fast Fail)
    try {
      await docService.validateLibraryExists(library);
    } catch (e) {
      console.error(`Error: Library '${library}' not found. Please index it first.`);
      process.exit(1);
    }

    // 6. Run Search
    const searchTool = new SearchTool(docService);
    const result = await searchTool.execute({
      library,
      query,
      limit: 5, // Return top 5 for ranking evaluation
    });

    // 7. Format Output
    // We want the LLM to judge the content.
    // We concatenate the content of the results.
    const results = result.results || [];
    const outputText =
      results.length === 0
        ? "No search results found."
        : results
            .map(
              (r, i) =>
                `--- Result ${i + 1} (Score: ${(r.score ?? 0).toFixed(3)}) ---\nURL: ${r.url}\n\n${r.content}`,
            )
            .join("\n\n");

    // Extract metadata for deterministic checks (Ranking)
    const metadata = {
      results: results.map((r) => ({
        url: r.url,
        score: r.score ?? 0,
        title: r.content.slice(0, 50) + "...", // simplified title if needed
      })),
    };

    // 8. Print JSON for promptfoo
    console.log(
      JSON.stringify({
        output: outputText,
        // Promptfoo expects 'tokenUsage' etc, but 'metadata' is generic storage
        // We can access this in assertions via `context.vars`? No, `providerOutput.metadata`?
        // Promptfoo's exec provider parses the whole JSON.
        // If the root keys include 'output', it uses that.
        // Other keys are merged into the result object.
        metadata: metadata,
      }),
    );
  } catch (error) {
    console.error("Search failed:", error);
    process.exit(1);
  } finally {
    // 9. Cleanup
    await docService.shutdown();
  }
}

main();
