import envPaths from "env-paths";
import { EventBusService } from "../events/EventBusService";
import { createDocumentManagement } from "../store";
import { SearchTool } from "../tools";
import { loadConfig } from "../utils/config";
import { LogLevel, setLogLevel } from "../utils/logger";

// Phase tracing: writes a timestamped line to stderr at each phase boundary.
// Opt-in via DOCS_EVAL_TRACE=1; off by default so promptfoo's exec-provider
// stderr stays clean.
const TRACE = process.env.DOCS_EVAL_TRACE === "1";
const T0 = Date.now();
const trace = (phase: string) => {
  if (TRACE) console.error(`[trace +${Date.now() - T0}ms] ${phase}`);
};
trace("module-load");

async function main() {
  trace("main:start");
  // Silence logs to prevent pollution of stdout (JSON output)
  setLogLevel(LogLevel.ERROR);

  // DEBUG: Print args
  // console.error("ARGV:", JSON.stringify(process.argv));

  // Parse arguments to handle Promptfoo's exec-provider format.
  //
  // Promptfoo invokes us like:
  //   ./run-provider.sh <prompt-tokens...> <provider-config-json> <test-context-json>
  //
  // The two trailing JSON blobs are promptfoo bookkeeping (provider id/config/env;
  // test vars/qrels/assertions/options/etc.) and must NOT be folded into the search
  // query. We pop every trailing arg that parses as a JSON object, capturing `vars`
  // from whichever blob carries it (the test context). What remains is the prompt.
  //
  // The previous version only popped JSON blobs that had `vars` or `options`,
  // which left the provider-config blob (with neither) tacked onto the query
  // string — turning "pathlib read text file" into
  // `pathlib read text file {"id":"exec:./run-provider.sh","config":{...},"env":{}}`
  // and hiding the actual query in noise. That regressed retrieval enough to
  // return zero hits on some libraries.

  const args = process.argv.slice(2);
  interface Context {
    vars?: Record<string, string>;
  }
  let context: Context = {};

  while (args.length > 0) {
    const lastArg = args[args.length - 1];
    const trimmed = lastArg.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) break;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Looks like JSON but isn't — assume it's a literal query fragment.
      break;
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as { vars?: Record<string, string> };
      if (obj.vars && !context.vars) context = obj;
      args.pop();
      continue;
    }
    break;
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
  trace("loadConfig:start");
  const appConfig = loadConfig();
  trace("loadConfig:done");

  // Fallback to default system path if storePath is not set
  if (!appConfig.app.storePath) {
    const paths = envPaths("docs-mcp-server", { suffix: "" });
    appConfig.app.storePath = paths.data;
    // console.error(`DEBUG: Using default store path: ${appConfig.app.storePath}`);
  }

  const eventBus = new EventBusService();

  // Create service (headless)
  trace("createDocumentManagement:start");
  const docService = await createDocumentManagement({
    appConfig,
    eventBus,
  });
  trace("createDocumentManagement:done");

  try {
    // 5. Verify Library Exists (Fast Fail)
    try {
      trace("validateLibraryExists:start");
      await docService.validateLibraryExists(library);
      trace("validateLibraryExists:done");
    } catch (_e) {
      console.error(`Error: Library '${library}' not found. Please index it first.`);
      process.exit(1);
    }

    // 6. Run Search. `top_k` is configurable via DOCS_EVAL_TOP_K so the
    // benchmark can measure deeper-recall configurations without editing
    // code. Validate aggressively — silently coercing junk would let bad
    // configs masquerade as a clean run.
    const topKRaw = process.env.DOCS_EVAL_TOP_K?.trim();
    let topK = 5;
    if (topKRaw) {
      const parsed = Number(topKRaw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        console.error(
          `Invalid DOCS_EVAL_TOP_K="${topKRaw}": must be an integer in [1, 100].`,
        );
        process.exit(1);
      }
      topK = parsed;
    }
    trace("searchTool.execute:start");
    const searchTool = new SearchTool(docService);
    const result = await searchTool.execute({
      library,
      query,
      limit: topK,
    });
    trace("searchTool.execute:done");

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

    // Metadata consumed by promptfoo JS assertions (IR metrics, structural
    // checks) and by the aggregator. Carries everything those consumers need
    // so they never have to re-parse `outputText`.
    const metadata = {
      library,
      query,
      results: results.map((r, i) => ({
        url: r.url,
        score: r.score ?? 0,
        position: i,
        content: r.content,
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
    trace("stdout-flushed");
  } catch (error) {
    console.error("Search failed:", error);
    process.exit(1);
  } finally {
    // 9. Cleanup
    trace("shutdown:start");
    await docService.shutdown();
    trace("shutdown:done");
  }
}

main().then(
  () => {
    trace("main:returned");
    // Force exit so anything that holds the event loop open (file watchers,
    // unclosed handles) cannot stall the process. When promptfoo spawns this
    // script the parent waits for the child to exit before reading stdout —
    // a dangling watcher = a 60-minute hang.
    trace("process.exit(0)");
    process.exit(0);
  },
  (err) => {
    console.error("Unhandled provider error:", err);
    process.exit(1);
  },
);
