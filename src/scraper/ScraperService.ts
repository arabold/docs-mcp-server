import type { ProgressCallback } from "../types";
import { ScraperError } from "../utils/errors";
import type { ScraperRegistry } from "./ScraperRegistry";
import type { ScraperOptions, ScraperProgress } from "./types";

/**
 * Orchestrates document scraping operations using registered scraping strategies.
 * Automatically selects appropriate strategy based on URL patterns.
 */
export class ScraperService {
  private registry: ScraperRegistry;

  constructor(registry: ScraperRegistry) {
    this.registry = registry;
  }

  /**
   * Scrapes content from the provided URL using the appropriate strategy.
   * Reports progress via callback and handles errors.
   */
  async scrape(
    options: ScraperOptions,
    progressCallback: ProgressCallback<ScraperProgress>,
    signal?: AbortSignal, // Add optional signal parameter
  ): Promise<void> {
    // Find strategy for this URL
    const strategy = this.registry.getStrategy(options.url);
    if (!strategy) {
      throw new ScraperError(`No scraper strategy found for URL: ${options.url}`, false);
    }

    // Pass the signal down to the strategy
    await strategy.scrape(options, progressCallback, signal);
  }

  /**
   * Cleanup the scraper registry and all its strategies.
   * Should be called when the service is no longer needed.
   */
  async cleanup(): Promise<void> {
    await this.registry.cleanup();
  }
}
