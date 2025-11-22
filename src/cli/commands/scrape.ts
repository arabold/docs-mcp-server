/**
 * Scrape command - Scrapes and indexes documentation from a URL or local folder.
 */

import type { Command } from "commander";
import { Option } from "commander";
import { EventType } from "../../events";
import { PipelineFactory, PipelineJobStatus, type PipelineOptions } from "../../pipeline";
import type { IPipeline } from "../../pipeline/trpc/interfaces";
import { ScrapeMode } from "../../scraper/types";
import { createDocumentManagement } from "../../store";
import type { IDocumentManagement } from "../../store/trpc/interfaces";
import { analytics, TelemetryEvent } from "../../telemetry";
import { ScrapeTool } from "../../tools";
import {
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_PAGES,
} from "../../utils/config";
import {
  getEventBus,
  getGlobalOptions,
  parseHeaders,
  resolveEmbeddingContext,
} from "../utils";

export async function scrapeAction(
  library: string,
  url: string,
  options: {
    version?: string;
    maxPages: string;
    maxDepth: string;
    maxConcurrency: string;
    ignoreErrors: boolean;
    scope: string;
    followRedirects: boolean;
    scrapeMode: ScrapeMode;
    includePattern: string[];
    excludePattern: string[];
    header: string[];
    embeddingModel?: string;
    serverUrl?: string;
  },
  command?: Command,
) {
  await analytics.track(TelemetryEvent.CLI_COMMAND, {
    command: "scrape",
    library,
    version: options.version,
    url,
    maxPages: Number.parseInt(options.maxPages, 10),
    maxDepth: Number.parseInt(options.maxDepth, 10),
    maxConcurrency: Number.parseInt(options.maxConcurrency, 10),
    scope: options.scope,
    scrapeMode: options.scrapeMode,
    followRedirects: options.followRedirects,
    hasHeaders: options.header.length > 0,
    hasIncludePatterns: options.includePattern.length > 0,
    hasExcludePatterns: options.excludePattern.length > 0,
    useServerUrl: !!options.serverUrl,
  });

  const serverUrl = options.serverUrl;
  const globalOptions = getGlobalOptions(command);

  // Resolve embedding configuration for local execution (scrape needs embeddings)
  const embeddingConfig = resolveEmbeddingContext(options.embeddingModel);
  if (!serverUrl && !embeddingConfig) {
    throw new Error(
      "Embedding configuration is required for local scraping. " +
        "Please set DOCS_MCP_EMBEDDING_MODEL environment variable or use --server-url for remote execution.",
    );
  }

  const eventBus = getEventBus(command);

  const docService: IDocumentManagement = await createDocumentManagement({
    serverUrl,
    embeddingConfig,
    storePath: globalOptions.storePath,
    eventBus,
  });
  let pipeline: IPipeline | null = null;

  // Display initial status
  console.log("⏳ Initializing scraping job...");

  // Subscribe to event bus for progress updates (only for local pipelines)
  let unsubscribeProgress: (() => void) | null = null;
  let unsubscribeStatus: (() => void) | null = null;

  if (!serverUrl) {
    unsubscribeProgress = eventBus.on(EventType.JOB_PROGRESS, (event) => {
      const { job, progress } = event;
      console.log(
        `📄 Scraping ${job.library}${job.version ? ` v${job.version}` : ""}: ${progress.pagesScraped}/${progress.totalPages} pages`,
      );
    });

    unsubscribeStatus = eventBus.on(EventType.JOB_STATUS_CHANGE, (event) => {
      if (event.status === PipelineJobStatus.RUNNING) {
        console.log(
          `🚀 Scraping ${event.library}${event.version ? ` v${event.version}` : ""}...`,
        );
      }
    });
  }

  try {
    const pipelineOptions: PipelineOptions = {
      recoverJobs: false,
      concurrency: 1,
      serverUrl,
    };

    pipeline = serverUrl
      ? await PipelineFactory.createPipeline(undefined, undefined, {
          serverUrl,
          ...pipelineOptions,
        })
      : await PipelineFactory.createPipeline(
          docService as unknown as never,
          eventBus,
          pipelineOptions,
        );

    await pipeline.start();
    const scrapeTool = new ScrapeTool(pipeline);

    const headers = parseHeaders(options.header);

    // Call the tool directly - tracking is now handled inside the tool
    const result = await scrapeTool.execute({
      url,
      library,
      version: options.version,
      options: {
        maxPages: Number.parseInt(options.maxPages, 10),
        maxDepth: Number.parseInt(options.maxDepth, 10),
        maxConcurrency: Number.parseInt(options.maxConcurrency, 10),
        ignoreErrors: options.ignoreErrors,
        scope: options.scope as "subpages" | "hostname" | "domain",
        followRedirects: options.followRedirects,
        scrapeMode: options.scrapeMode,
        includePatterns:
          Array.isArray(options.includePattern) && options.includePattern.length > 0
            ? options.includePattern
            : undefined,
        excludePatterns:
          Array.isArray(options.excludePattern) && options.excludePattern.length > 0
            ? options.excludePattern
            : undefined,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      },
    });

    if ("pagesScraped" in result) {
      console.log(`✅ Successfully scraped ${result.pagesScraped} pages`);
    } else {
      console.log(`✅ Scraping job started with ID: ${result.jobId}`);
    }
  } catch (error) {
    console.error(
      `❌ Scraping failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  } finally {
    // Clean up event listeners
    if (unsubscribeProgress) unsubscribeProgress();
    if (unsubscribeStatus) unsubscribeStatus();

    if (pipeline) await pipeline.stop();
    await docService.shutdown();
  }
}

export function createScrapeCommand(program: Command): Command {
  return program
    .command("scrape <library> <url>")
    .description(
      "Scrape and index documentation from a URL or local folder.\n\n" +
        "To scrape local files or folders, use a file:// URL.\n" +
        "Examples:\n" +
        "  scrape mylib https://react.dev/reference/react\n" +
        "  scrape mylib file:///Users/me/docs/index.html\n" +
        "  scrape mylib file:///Users/me/docs/my-library\n" +
        "\nNote: For local files/folders, you must use the file:// prefix. If running in Docker, mount the folder and use the container path. See README for details.",
    )
    .option("-v, --version <string>", "Version of the library (optional)")
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
        return value as ScrapeMode;
      },
      ScrapeMode.Auto,
    )
    .option(
      "--include-pattern <pattern>",
      "Glob or regex pattern for URLs to include (can be specified multiple times). Regex patterns must be wrapped in slashes, e.g. /pattern/.",
      (val: string, prev: string[] = []) => prev.concat([val]),
      [] as string[],
    )
    .option(
      "--exclude-pattern <pattern>",
      "Glob or regex pattern for URLs to exclude (can be specified multiple times, takes precedence over include). Regex patterns must be wrapped in slashes, e.g. /pattern/.",
      (val: string, prev: string[] = []) => prev.concat([val]),
      [] as string[],
    )
    .option(
      "--header <name:value>",
      "Custom HTTP header to send with each request (can be specified multiple times)",
      (val: string, prev: string[] = []) => prev.concat([val]),
      [] as string[],
    )
    .addOption(
      new Option(
        "--embedding-model <model>",
        "Embedding model configuration (e.g., 'openai:text-embedding-3-small')",
      ).env("DOCS_MCP_EMBEDDING_MODEL"),
    )
    .option(
      "--server-url <url>",
      "URL of external pipeline worker RPC (e.g., http://localhost:8080/api)",
    )
    .action(scrapeAction);
}
