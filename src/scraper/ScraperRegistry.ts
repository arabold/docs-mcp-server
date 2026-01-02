import type { AppConfig } from "../utils/config";
import { ScraperError } from "../utils/errors";
import { logger } from "../utils/logger";
import { validateUrl } from "../utils/url";
import { GitHubScraperStrategy } from "./strategies/GitHubScraperStrategy";
import { LocalFileStrategy } from "./strategies/LocalFileStrategy";
import { NpmScraperStrategy } from "./strategies/NpmScraperStrategy";
import { PyPiScraperStrategy } from "./strategies/PyPiScraperStrategy";
import { WebScraperStrategy } from "./strategies/WebScraperStrategy";
import type { ScraperStrategy } from "./types";

export class ScraperRegistry {
  private strategies: ScraperStrategy[];

  constructor(config: AppConfig) {
    this.strategies = [
      new NpmScraperStrategy(config),
      new PyPiScraperStrategy(config),
      new GitHubScraperStrategy(config),
      new WebScraperStrategy(config, {}),
      new LocalFileStrategy(config),
    ];
  }

  getStrategy(url: string): ScraperStrategy {
    validateUrl(url);
    const strategy = this.strategies.find((s) => s.canHandle(url));
    if (!strategy) {
      throw new ScraperError(`No strategy found for URL: ${url}`);
    }
    logger.debug(`Using strategy "${strategy.constructor.name}" for URL: ${url}`);
    return strategy;
  }

  /**
   * Cleanup all registered strategies to prevent resource leaks.
   * Should be called when the registry is no longer needed.
   */
  async cleanup(): Promise<void> {
    await Promise.allSettled(this.strategies.map((strategy) => strategy.cleanup?.()));
  }
}
