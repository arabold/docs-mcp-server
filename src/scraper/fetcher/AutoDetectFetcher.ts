/**
 * Fetcher that routes URLs to HTTP, browser, or file implementations and
 * retries with a browser when an HTTP challenge is detected. Requires the
 * resolved scraper configuration to align with entrypoint-provided settings.
 */

import type { AppConfig } from "../../utils/config";
import { ChallengeError } from "../../utils/errors";
import { logger } from "../../utils/logger";
import { BrowserFetcher } from "./BrowserFetcher";
import { FileFetcher } from "./FileFetcher";
import { HttpFetcher } from "./HttpFetcher";
import type { ContentFetcher, FetchOptions, RawContent } from "./types";

/**
 * AutoDetectFetcher automatically selects the appropriate fetcher based on URL type
 * and handles fallbacks for challenge detection.
 *
 * This eliminates the need for consumers to manage multiple fetcher instances
 * and implement fallback logic themselves.
 */
export class AutoDetectFetcher implements ContentFetcher {
  private readonly httpFetcher: HttpFetcher;
  private readonly browserFetcher: BrowserFetcher;
  private readonly fileFetcher = new FileFetcher();

  constructor(scraperConfig: AppConfig["scraper"]) {
    this.httpFetcher = new HttpFetcher(scraperConfig);
    this.browserFetcher = new BrowserFetcher(scraperConfig);
  }

  /**
   * Check if this fetcher can handle the given source.
   * Returns true for any URL that any of the underlying fetchers can handle.
   */
  canFetch(source: string): boolean {
    return (
      this.httpFetcher.canFetch(source) ||
      this.browserFetcher.canFetch(source) ||
      this.fileFetcher.canFetch(source)
    );
  }

  /**
   * Fetch content from the source, automatically selecting the appropriate fetcher
   * and handling fallbacks when challenges are detected.
   */
  async fetch(source: string, options?: FetchOptions): Promise<RawContent> {
    // For file:// URLs, use FileFetcher directly
    if (this.fileFetcher.canFetch(source)) {
      logger.debug(`Using FileFetcher for: ${source}`);
      return this.fileFetcher.fetch(source, options);
    }

    // For HTTP(S) URLs, try HttpFetcher first, fallback to BrowserFetcher on challenge
    if (this.httpFetcher.canFetch(source)) {
      try {
        logger.debug(`Using HttpFetcher for: ${source}`);
        return await this.httpFetcher.fetch(source, options);
      } catch (error) {
        if (error instanceof ChallengeError) {
          logger.info(
            `🔄 Challenge detected for ${source}, falling back to browser fetcher...`,
          );
          return this.browserFetcher.fetch(source, options);
        }
        throw error;
      }
    }

    // If we get here, no fetcher can handle this URL
    throw new Error(`No suitable fetcher found for URL: ${source}`);
  }

  /**
   * Close all underlying fetchers to prevent resource leaks.
   */
  async close(): Promise<void> {
    await Promise.allSettled([
      this.browserFetcher.close(),
      // HttpFetcher and FileFetcher don't need explicit cleanup
    ]);
  }
}
