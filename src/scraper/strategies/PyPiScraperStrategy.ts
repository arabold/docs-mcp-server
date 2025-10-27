import type { ProgressCallback } from "../../types";
import type { ScraperOptions, ScraperProgressEvent, ScraperStrategy } from "../types";
import { WebScraperStrategy } from "./WebScraperStrategy";

export class PyPiScraperStrategy implements ScraperStrategy {
  private defaultStrategy: WebScraperStrategy;

  canHandle(url: string): boolean {
    const { hostname } = new URL(url);
    return ["pypi.org", "www.pypi.org"].includes(hostname);
  }

  constructor() {
    this.defaultStrategy = new WebScraperStrategy({
      urlNormalizerOptions: {
        ignoreCase: true,
        removeHash: true,
        removeTrailingSlash: true,
        removeQuery: true, // Enable removeQuery for PyPI packages
      },
    });
  }

  async scrape(
    options: ScraperOptions,
    progressCallback: ProgressCallback<ScraperProgressEvent>,
    signal?: AbortSignal,
  ): Promise<void> {
    // Use default strategy with our configuration, passing the signal
    await this.defaultStrategy.scrape(options, progressCallback, signal);
  }

  /**
   * Cleanup resources used by this strategy.
   */
  async cleanup(): Promise<void> {
    await this.defaultStrategy.cleanup();
  }
}
