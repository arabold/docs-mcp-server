import type { ProgressCallback } from "../types";
import { ScraperError } from "../utils/errors";
import { logger } from "../utils/logger";
import type { ScraperRegistry } from "./ScraperRegistry";
import type { ScraperOptions, ScraperProgressEvent } from "./types";

/**
 * Orchestrates document scraping operations using registered scraping strategies.
 * Automatically selects appropriate strategy based on URL patterns.
 * Each scrape operation uses a fresh strategy instance for state isolation.
 */
export class ScraperService {
  private registry: ScraperRegistry;

  constructor(registry: ScraperRegistry) {
    this.registry = registry;
  }

  /**
   * Scrapes content from the provided URL using the appropriate strategy.
   * Reports progress via callback and handles errors.
   * Cleans up strategy resources after scrape completes (success or failure).
   */
  async scrape(
    options: ScraperOptions,
    progressCallback: ProgressCallback<ScraperProgressEvent>,
    signal?: AbortSignal,
  ): Promise<void> {
    // Get a fresh strategy instance for this scrape (factory pattern)
    const strategy = this.registry.getStrategy(options.url);
    if (!strategy) {
      throw new ScraperError(`No scraper strategy found for URL: ${options.url}`, false);
    }

    let scrapeError: Error | null = null;
    let cleanupErrorToThrow: Error | null = null;
    try {
      // Pass the signal down to the strategy
      await strategy.scrape(options, progressCallback, signal);
    } catch (error) {
      scrapeError =
        error instanceof Error
          ? error
          : new ScraperError(`Scrape failed for URL: ${options.url}`, false);
    } finally {
      // Always cleanup strategy resources after scrape completes
      // This releases browser instances, temp files, etc.
      try {
        await strategy.cleanup?.();
      } catch (cleanupError) {
        logger.error(`❌ Strategy cleanup failed for ${options.url}: ${cleanupError}`);
        if (!scrapeError) {
          cleanupErrorToThrow =
            cleanupError instanceof Error
              ? cleanupError
              : new ScraperError(
                  `Strategy cleanup failed for URL: ${options.url}`,
                  false,
                );
        }
      }
    }

    if (scrapeError) {
      throw scrapeError;
    }

    if (cleanupErrorToThrow) {
      throw cleanupErrorToThrow;
    }
  }
}
