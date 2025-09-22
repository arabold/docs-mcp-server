import * as semver from "semver";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import { ScrapeMode } from "../scraper/types";
import {
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_PAGES,
} from "../utils/config";
import { logger } from "../utils/logger";

export interface ScrapeToolOptions {
  library: string;
  version?: string | null; // Make version optional
  url: string;
  options?: {
    maxPages?: number;
    maxDepth?: number;
    /**
     * Defines the allowed crawling boundary relative to the starting URL
     * - 'subpages': Only crawl URLs on the same hostname and within the same starting path (default)
     * - 'hostname': Crawl any URL on the same hostname, regardless of path
     * - 'domain': Crawl any URL on the same top-level domain, including subdomains
     */
    scope?: "subpages" | "hostname" | "domain";
    /**
     * Controls whether HTTP redirects (3xx responses) should be followed
     * - When true: Redirects are followed automatically (default)
     * - When false: A RedirectError is thrown when a 3xx response is received
     */
    followRedirects?: boolean;
    maxConcurrency?: number; // Note: Concurrency is now set when PipelineManager is created
    ignoreErrors?: boolean;
    /**
     * Determines the HTML processing strategy.
     * - 'fetch': Use a simple DOM parser (faster, less JS support).
     * - 'playwright': Use a headless browser (slower, full JS support).
     * - 'auto': Automatically select the best strategy (currently defaults to 'playwright').
     * @default ScrapeMode.Auto
     */
    scrapeMode?: ScrapeMode;
    /**
     * Patterns for including URLs during scraping. If not set, all are included by default.
     * Regex patterns must be wrapped in slashes, e.g. /pattern/.
     */
    includePatterns?: string[];
    /**
     * Patterns for excluding URLs during scraping. Exclude takes precedence over include.
     * If not specified, default patterns exclude common files (CHANGELOG.md, LICENSE, etc.)
     * and folders (archive, deprecated, i18n locales, etc.).
     * Regex patterns must be wrapped in slashes, e.g. /pattern/.
     */
    excludePatterns?: string[];
    /**
     * Custom HTTP headers to send with each request (e.g., for authentication).
     * Keys are header names, values are header values.
     */
    headers?: Record<string, string>;
  };
  /** If false, returns jobId immediately without waiting. Defaults to true. */
  waitForCompletion?: boolean;
}

export interface ScrapeResult {
  /** Indicates the number of pages scraped if waitForCompletion was true and the job succeeded. May be 0 or inaccurate if job failed or waitForCompletion was false. */
  pagesScraped: number;
}

/** Return type for ScrapeTool.execute */
export type ScrapeExecuteResult = ScrapeResult | { jobId: string };

/**
 * Tool for enqueuing documentation scraping jobs via the pipeline.
 */
export class ScrapeTool {
  private pipeline: IPipeline;

  constructor(pipeline: IPipeline) {
    this.pipeline = pipeline;
  }

  async execute(options: ScrapeToolOptions): Promise<ScrapeExecuteResult> {
    const {
      library,
      version,
      url,
      options: scraperOptions,
      waitForCompletion = true,
    } = options;

    // Store initialization and manager start should happen externally

    let internalVersion: string;
    const partialVersionRegex = /^\d+(\.\d+)?$/; // Matches '1' or '1.2'

    if (version === null || version === undefined) {
      internalVersion = "";
    } else {
      const validFullVersion = semver.valid(version);
      if (validFullVersion) {
        internalVersion = validFullVersion;
      } else if (partialVersionRegex.test(version)) {
        const coercedVersion = semver.coerce(version);
        if (coercedVersion) {
          internalVersion = coercedVersion.version;
        } else {
          throw new Error(
            `Invalid version format for scraping: '${version}'. Use 'X.Y.Z', 'X.Y.Z-prerelease', 'X.Y', 'X', or omit.`,
          );
        }
      } else {
        throw new Error(
          `Invalid version format for scraping: '${version}'. Use 'X.Y.Z', 'X.Y.Z-prerelease', 'X.Y', 'X', or omit.`,
        );
      }
    }

    internalVersion = internalVersion.toLowerCase();

    // Use the injected pipeline instance
    const pipeline = this.pipeline;

    // Remove internal progress tracking and callbacks
    // let pagesScraped = 0;
    // let lastReportedPages = 0;
    // const reportProgress = ...
    // pipeline.setCallbacks(...)

    // Normalize pipeline version argument: use null for unversioned to be explicit cross-platform
    const enqueueVersion: string | null = internalVersion === "" ? null : internalVersion;

    // Enqueue the job using the injected pipeline
    const jobId = await pipeline.enqueueJob(library, enqueueVersion, {
      url: url,
      library: library,
      version: internalVersion,
      scope: scraperOptions?.scope ?? "subpages",
      followRedirects: scraperOptions?.followRedirects ?? true,
      maxPages: scraperOptions?.maxPages ?? DEFAULT_MAX_PAGES,
      maxDepth: scraperOptions?.maxDepth ?? DEFAULT_MAX_DEPTH,
      maxConcurrency: scraperOptions?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
      ignoreErrors: scraperOptions?.ignoreErrors ?? true,
      scrapeMode: scraperOptions?.scrapeMode ?? ScrapeMode.Auto, // Pass scrapeMode enum
      includePatterns: scraperOptions?.includePatterns,
      excludePatterns: scraperOptions?.excludePatterns,
      headers: scraperOptions?.headers, // <-- propagate headers
    });

    // Conditionally wait for completion
    if (waitForCompletion) {
      try {
        await pipeline.waitForJobCompletion(jobId);
        // Fetch final job state to get status and potentially final page count
        const finalJob = await pipeline.getJob(jobId);
        const finalPagesScraped = finalJob?.progress?.pagesScraped ?? 0; // Get count from final job state
        logger.debug(
          `Job ${jobId} finished with status ${finalJob?.status}. Pages scraped: ${finalPagesScraped}`,
        );
        return {
          pagesScraped: finalPagesScraped,
        };
      } catch (error) {
        logger.error(`❌ Job ${jobId} failed or was cancelled: ${error}`);
        throw error; // Re-throw so the caller knows it failed
      }
      // No finally block needed to stop pipeline, as it's managed externally
    }

    // If not waiting, return the job ID immediately
    return { jobId };
  }
}
