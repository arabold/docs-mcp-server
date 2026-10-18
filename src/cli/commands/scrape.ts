/**
 * Scrape command - Scrapes and indexes documentation from a URL or local folder.
 */

import type { Argv } from "yargs";
import { ScrapeMode } from "../../scraper/types";
import { openBackend } from "../../services/backend";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { ScrapeTool } from "../../tools";
import { loadConfig } from "../../utils/config";
import { logger } from "../../utils/logger";
import { followJobLogs } from "../JobOutputFollower";
import { renderTextOutput } from "../output";
import { registerGlobalServices } from "../services";
import { type CliContext, getEventBus, parseHeaders } from "../utils";

export function createScrapeCommand(cli: Argv) {
  cli.command(
    "scrape <library> <url>",
    "Download and index documentation from a URL or local directory",
    (yargs) => {
      return yargs
        .version(false)
        .positional("library", {
          type: "string",
          description: "Library name",
          demandOption: true,
        })
        .positional("url", {
          type: "string",
          description: "URL or file:// path to scrape",
          demandOption: true,
        })
        .option("version", {
          type: "string",
          description: "Version of the library (optional)",
          alias: "v",
        })
        .option("max-pages", {
          type: "number",
          description: "Maximum pages to scrape",
          alias: ["p", "maxPages"],
        })
        .option("max-depth", {
          type: "number",
          description: "Maximum navigation depth",
          alias: ["d", "maxDepth"],
        })
        .option("max-concurrency", {
          type: "number",
          description: "Maximum concurrent page requests",
          alias: ["c", "maxConcurrency"],
        })
        .option("ignore-errors", {
          type: "boolean",
          description: "Ignore errors during scraping",
          default: true,
          alias: "ignoreErrors",
        })
        .option("scope", {
          choices: ["subpages", "hostname", "domain"],
          description: "Crawling boundary",
          default: "subpages",
        })
        .option("follow-redirects", {
          type: "boolean",
          description: "Follow HTTP redirects",
          default: true,
          alias: "followRedirects",
        })
        .option("no-follow-redirects", {
          type: "boolean",
          description: "Disable following HTTP redirects",
          hidden: true,
        })
        .option("scrape-mode", {
          choices: Object.values(ScrapeMode),
          description: "HTML processing strategy",
          default: ScrapeMode.Auto,
          alias: "scrapeMode",
        })
        .option("preserve-hashes", {
          type: "boolean",
          description:
            "Preserve URL hash fragments for hash-routed SPA documentation sites",
          alias: "preserveHashes",
        })
        .option("include-pattern", {
          type: "string",
          array: true,
          description:
            "Glob or regex pattern for URLs to include (can be specified multiple times). Regex patterns must be wrapped in slashes, e.g. /pattern/.",
          alias: "includePattern",
          default: [] as string[],
        })
        .option("exclude-pattern", {
          type: "string",
          array: true,
          description:
            "Glob or regex pattern for URLs to exclude (can be specified multiple times, takes precedence over include). Regex patterns must be wrapped in slashes, e.g. /pattern/.",
          alias: "excludePattern",
          default: [] as string[],
        })
        .option("header", {
          type: "string",
          array: true,
          description:
            "Custom HTTP header to send with each request (can be specified multiple times)",
          default: [] as string[],
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
        .option("clean", {
          type: "boolean",
          description: "Clear existing documents before scraping",
          default: true,
        })
        .option("replace", {
          type: "boolean",
          description:
            "Rebuild the library version if it already exists (without it, an existing version is left untouched and the command fails)",
          default: false,
        })
        .usage(
          "$0 scrape <library> <url> [options]\n\n" +
            "Scrape and index documentation from a URL or local folder.\n\n" +
            "Scraping a library version that already exists fails unless --replace is given;\n" +
            "use `refresh` to update it in place, or --no-clean to add to it.\n\n" +
            "To scrape local files or folders, use a file:// URL.\n" +
            "Examples:\n" +
            "  scrape mylib https://react.dev/reference/react\n" +
            "  scrape mylib file:///Users/me/docs/index.html\n" +
            "  scrape mylib file:///Users/me/docs/my-library\n" +
            "\nNote: For local files/folders, you must use the file:// prefix. If running in Docker, mount the folder and use the container path. See README for details.",
        );
    },
    async (argv) => {
      const library = argv.library as string;
      const url = argv.url as string;
      const serverUrl = argv.serverUrl as string | undefined;

      const appConfig = loadConfig(argv, {
        configPath: argv.config as string,
        searchDir: argv.storePath as string, // resolved globally
      });

      const maxPages = (argv.maxPages as number) ?? appConfig.scraper.maxPages;
      const maxDepth = (argv.maxDepth as number) ?? appConfig.scraper.maxDepth;
      const maxConcurrency =
        (argv.maxConcurrency as number) ?? appConfig.scraper.maxConcurrency;
      const preserveHashes =
        typeof argv.preserveHashes === "boolean"
          ? (argv.preserveHashes as boolean)
          : appConfig.scraper.preserveHashes;

      // Update appConfig with effective values
      appConfig.scraper.maxPages = maxPages;
      appConfig.scraper.maxDepth = maxDepth;
      appConfig.scraper.maxConcurrency = maxConcurrency;

      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "scrape",
        library,
        version: argv.version,
        url,
        maxPages,
        maxDepth,
        maxConcurrency,
        scope: argv.scope,
        scrapeMode: argv.scrapeMode,
        preserveHashes,
        followRedirects: argv.followRedirects,
        hasHeaders: (argv.header as string[]).length > 0,
        hasIncludePatterns: (argv.includePattern as string[]).length > 0,
        hasExcludePatterns: (argv.excludePattern as string[]).length > 0,
        useServerUrl: !!serverUrl,
      });

      const eventBus = getEventBus(argv as CliContext);

      const backend = await openBackend({
        serverUrl,
        eventBus,
        appConfig,
        // Runs only its own job; the process hosting the store handles the rest
        jobs: { interruptedJobs: "leave" },
      });

      // Display initial status
      logger.info("⏳ Initializing scraping job...");

      registerGlobalServices({ backend });

      // Report this command's own job; a shared worker also runs other clients' jobs
      const follower = followJobLogs(backend.eventBus, "Scraping");

      try {
        const scrapeTool = new ScrapeTool(backend.pipeline, appConfig.scraper);

        const headers = parseHeaders((argv.header as string[]) || []);

        const result = await scrapeTool.execute({
          onJobEnqueued: (jobId) => follower.follow(jobId),
          url,
          library,
          version: argv.version as string | undefined,
          replace: argv.replace as boolean,
          options: {
            maxPages,
            maxDepth,
            maxConcurrency,
            ignoreErrors: argv.ignoreErrors as boolean,
            scope: argv.scope as "subpages" | "hostname" | "domain",
            followRedirects: argv.followRedirects as boolean,
            scrapeMode: argv.scrapeMode as ScrapeMode,
            preserveHashes,
            includePatterns:
              (argv.includePattern as string[])?.length > 0
                ? (argv.includePattern as string[])
                : undefined,
            excludePatterns:
              (argv.excludePattern as string[])?.length > 0
                ? (argv.excludePattern as string[])
                : undefined,
            headers: Object.keys(headers).length > 0 ? headers : undefined,
            clean: argv.clean as boolean,
          },
        });

        if ("pagesScraped" in result) {
          renderTextOutput(`Successfully scraped ${result.pagesScraped} pages`);
        } else {
          renderTextOutput(`Scraping job started with ID: ${result.jobId}`);
        }
      } finally {
        follower.dispose();

        await backend.close();
      }
    },
  );
}
