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

/**
 * Factory for creating scraper strategy instances.
 * Each call to getStrategy() returns a fresh instance to ensure
 * parallel scrape jobs have completely isolated state.
 */
export class ScraperRegistry {
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  /**
   * Creates and returns a fresh strategy instance for the given URL.
   * Each call returns a new instance to ensure state isolation between parallel scrapes.
   */
  getStrategy(url: string): ScraperStrategy {
    if (!url.startsWith("github-file://")) {
      validateUrl(url);
    }

    // Check each strategy type without instantiating heavy objects.
    // Order matters: more specific strategies should come before generic ones.

    if (isLocalFileUrl(url)) {
      logger.debug(`Using strategy "LocalFileStrategy" for URL: ${url}`);
      return new LocalFileStrategy(this.config);
    }

    if (isNpmUrl(url)) {
      logger.debug(`Using strategy "NpmScraperStrategy" for URL: ${url}`);
      return new NpmScraperStrategy(this.config);
    }

    if (isPyPiUrl(url)) {
      logger.debug(`Using strategy "PyPiScraperStrategy" for URL: ${url}`);
      return new PyPiScraperStrategy(this.config);
    }

    if (isGitHubUrl(url)) {
      logger.debug(`Using strategy "GitHubScraperStrategy" for URL: ${url}`);
      return new GitHubScraperStrategy(this.config);
    }

    if (isWebUrl(url)) {
      logger.debug(`Using strategy "WebScraperStrategy" for URL: ${url}`);
      return new WebScraperStrategy(this.config, {});
    }

    throw new ScraperError(`No strategy found for URL: ${url}`);
  }
}

function isLocalFileUrl(url: string): boolean {
  return url.startsWith("file://");
}

function isNpmUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return ["npmjs.org", "npmjs.com", "www.npmjs.com"].includes(hostname);
  } catch {
    return false;
  }
}

function isPyPiUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return ["pypi.org", "www.pypi.org"].includes(hostname);
  } catch {
    return false;
  }
}

function isGitHubUrl(url: string): boolean {
  if (url.startsWith("github-file://")) {
    return true;
  }

  try {
    const parsedUrl = new URL(url);
    const { hostname, pathname } = parsedUrl;

    if (!["github.com", "www.github.com"].includes(hostname)) {
      return false;
    }

    if (pathname.match(/^\/[^/]+\/[^/]+\/?$/)) {
      return true;
    }

    if (pathname.match(/^\/[^/]+\/[^/]+\/tree\//)) {
      return true;
    }

    if (pathname.match(/^\/[^/]+\/[^/]+\/blob\//)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function isWebUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch {
    return false;
  }
}
