#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import packageJson from "../package.json";
import { DEFAULT_MAX_CONCURRENCY, DEFAULT_MAX_DEPTH, DEFAULT_MAX_PAGES } from "./config";
import { PipelineManager } from "./pipeline/PipelineManager";
import { FileFetcher, HttpFetcher } from "./scraper/fetcher";
import { ScrapeMode } from "./scraper/types"; // Import ScrapeMode enum
import { DocumentManagementService } from "./store/DocumentManagementService";
import {
  FetchUrlTool,
  FindVersionTool,
  ListLibrariesTool,
  ScrapeTool,
  SearchTool,
} from "./tools";
import { LogLevel, setLogLevel } from "./utils/logger";

const formatOutput = (data: unknown) => JSON.stringify(data, null, 2);

async function main() {
  let docService: DocumentManagementService | undefined;
  let pipelineManager: PipelineManager | undefined;

  try {
    docService = new DocumentManagementService();
    await docService.initialize();

    // Instantiate PipelineManager for CLI use
    pipelineManager = new PipelineManager(docService); // Assign inside try
    // Start the manager for the CLI session
    await pipelineManager.start();

    const tools = {
      listLibraries: new ListLibrariesTool(docService),
      findVersion: new FindVersionTool(docService),
      scrape: new ScrapeTool(docService, pipelineManager), // Pass manager
      search: new SearchTool(docService),
      fetchUrl: new FetchUrlTool(new HttpFetcher(), new FileFetcher()),
    };

    const program = new Command();

    // Handle cleanup on SIGINT
    process.on("SIGINT", async () => {
      if (pipelineManager) await pipelineManager.stop(); // Check before stopping
      if (docService) await docService.shutdown(); // Check before stopping
      process.exit(0);
    });

    program
      .name("docs-mcp")
      .description("CLI for managing documentation vector store")
      .version(packageJson.version)
      // Add global options for logging level
      .option("--verbose", "Enable verbose (debug) logging", false)
      .option("--silent", "Disable all logging except errors", false);

    program
      .command("scrape <library> <url>") // Remove <version> as positional
      .description("Scrape and index documentation from a URL")
      .option("-v, --version <string>", "Version of the library (optional)") // Add optional version flag
      .option(
        "-p, --max-pages <number>",
        "Maximum pages to scrape",
        DEFAULT_MAX_PAGES.toString(),
      )
      .option(
        "-d, --max-depth <number>",
        "Maximum navigation depth",
        DEFAULT_MAX_DEPTH.toString(),
      )
      .option(
        "-c, --max-concurrency <number>",
        "Maximum concurrent page requests",
        DEFAULT_MAX_CONCURRENCY.toString(),
      )
      .option("--ignore-errors", "Ignore errors during scraping", true)
      .option(
        "--scope <scope>",
        "Crawling boundary: 'subpages' (default), 'hostname', or 'domain'",
        (value) => {
          const validScopes = ["subpages", "hostname", "domain"];
          if (!validScopes.includes(value)) {
            console.warn(`Warning: Invalid scope '${value}'. Using default 'subpages'.`);
            return "subpages";
          }
          return value;
        },
        "subpages",
      )
      .option(
        "--no-follow-redirects",
        "Disable following HTTP redirects (default: follow redirects)",
      )
      .option(
        "--scrape-mode <mode>",
        `HTML processing strategy: '${ScrapeMode.Fetch}', '${ScrapeMode.Playwright}', '${ScrapeMode.Auto}' (default)`,
        (value: string): ScrapeMode => {
          const validModes = Object.values(ScrapeMode);
          if (!validModes.includes(value as ScrapeMode)) {
            console.warn(
              `Warning: Invalid scrape mode '${value}'. Using default '${ScrapeMode.Auto}'.`,
            );
            return ScrapeMode.Auto;
          }
          return value as ScrapeMode; // Cast to enum type
        },
        ScrapeMode.Auto, // Use enum default
      )
      .action(async (library, url, options) => {
        // Update action parameters
        const result = await tools.scrape.execute({
          url,
          library,
          version: options.version, // Get version from options
          options: {
            maxPages: Number.parseInt(options.maxPages),
            maxDepth: Number.parseInt(options.maxDepth),
            maxConcurrency: Number.parseInt(options.maxConcurrency),
            ignoreErrors: options.ignoreErrors,
            scope: options.scope,
            followRedirects: options.followRedirects, // This will be `true` by default, or `false` if --no-follow-redirects is used
            scrapeMode: options.scrapeMode, // Pass the new scrapeMode option
          },
          // CLI always waits for completion (default behavior)
        });
        // Type guard to satisfy TypeScript
        if ("pagesScraped" in result) {
          console.log(`✅ Successfully scraped ${result.pagesScraped} pages`);
        } else {
          // This branch should not be hit by the CLI
          console.log(`🚀 Scraping job started with ID: ${result.jobId}`);
        }
      });

    program
      .command("search <library> <query>") // Remove <version> as positional
      .description(
        "Search documents in a library. Version matching examples:\n" +
          "  - search react --version 18.0.0 'hooks' -> matches docs for React 18.0.0 or earlier versions\n" +
          "  - search react --version 18.0.0 'hooks' --exact-match -> only matches React 18.0.0\n" +
          "  - search typescript --version 5.x 'types' -> matches any TypeScript 5.x.x version\n" +
          "  - search typescript --version 5.2.x 'types' -> matches any TypeScript 5.2.x version",
      )
      .option(
        "-v, --version <string>", // Add optional version flag
        "Version of the library (optional, supports ranges)",
      )
      .option("-l, --limit <number>", "Maximum number of results", "5")
      .option(
        "-e, --exact-match",
        "Only use exact version match (e.g., '18.0.0' matches only 18.0.0, not 17.x.x) (default: false)",
        false,
      )
      .action(async (library, query, options) => {
        // Update action parameters
        const result = await tools.search.execute({
          library,
          version: options.version, // Get version from options
          query,
          limit: Number.parseInt(options.limit),
          exactMatch: options.exactMatch,
        });
        console.log(formatOutput(result.results));
      });

    program
      .command("list")
      .description("List all available libraries and their versions")
      .action(async () => {
        const result = await tools.listLibraries.execute();
        console.log(formatOutput(result.libraries));
      });

    program
      .command("find-version <library>") // Remove [targetVersion] positional
      .description("Find the best matching version for a library")
      .option(
        "-v, --version <string>", // Add optional version flag
        "Target version to match (optional, supports ranges)",
      )
      .action(async (library, options) => {
        // Update action parameters
        const versionInfo = await tools.findVersion.execute({
          library,
          targetVersion: options.version, // Get version from options
        });
        // findVersion.execute now returns a string, handle potential error messages within it
        if (!versionInfo) {
          // Should not happen with current tool logic, but good practice
          throw new Error("Failed to get version information");
        }
        console.log(versionInfo); // Log the descriptive string from the tool
      });

    program
      .command("remove <library>") // Library as positional argument
      .description("Remove documents for a specific library and version")
      .option(
        "-v, --version <string>",
        "Version to remove (optional, removes unversioned if omitted)",
      )
      .action(async (library, options) => {
        // library is now the first arg
        if (!docService) {
          throw new Error("Document service not initialized.");
        }
        const { version } = options; // Get version from options
        try {
          await docService.removeAllDocuments(library, version);
          console.log(
            `✅ Successfully removed documents for ${library}${version ? `@${version}` : " (unversioned)"}.`,
          );
        } catch (error) {
          console.error(
            `❌ Failed to remove documents for ${library}${version ? `@${version}` : " (unversioned)"}:`,
            error instanceof Error ? error.message : String(error),
          );
          // Re-throw to trigger the main catch block for shutdown
          throw error;
        }
      });

    program
      .command("fetch-url <url>")
      .description("Fetch a URL and convert its content to Markdown")
      .option(
        "--no-follow-redirects",
        "Disable following HTTP redirects (default: follow redirects)",
      )
      .option(
        "--scrape-mode <mode>",
        `HTML processing strategy: '${ScrapeMode.Fetch}', '${ScrapeMode.Playwright}', '${ScrapeMode.Auto}' (default)`,
        (value: string): ScrapeMode => {
          const validModes = Object.values(ScrapeMode);
          if (!validModes.includes(value as ScrapeMode)) {
            console.warn(
              `Warning: Invalid scrape mode '${value}'. Using default '${ScrapeMode.Auto}'.`,
            );
            return ScrapeMode.Auto;
          }
          return value as ScrapeMode; // Cast to enum type
        },
        ScrapeMode.Auto, // Use enum default
      )
      .action(async (url, options) => {
        const content = await tools.fetchUrl.execute({
          url,
          followRedirects: options.followRedirects,
          scrapeMode: options.scrapeMode, // Pass the scrapeMode option
        });
        console.log(content);
      });

    // Hook to set log level after parsing global options but before executing command action
    program.hook("preAction", (thisCommand) => {
      // Global options are attached to the program (thisCommand)
      const options = thisCommand.opts();
      if (options.silent) {
        // If silent is true, it overrides verbose
        setLogLevel(LogLevel.ERROR);
      } else if (options.verbose) {
        setLogLevel(LogLevel.DEBUG);
      }
      // Otherwise, the default LogLevel.INFO remains set from logger.ts
    });

    await program.parseAsync();
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : String(error));
    if (pipelineManager) await pipelineManager.stop(); // Check before stopping
    if (docService) await docService.shutdown();
    process.exit(1);
  }

  // Clean shutdown after successful execution
  if (pipelineManager) await pipelineManager.stop(); // Check before stopping
  await docService.shutdown();
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
