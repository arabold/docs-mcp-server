import type { ProgressCallback } from "../../types";
import { logger } from "../../utils/logger";
import type { ScraperOptions, ScraperProgress, ScraperStrategy } from "../types";
import { GitHubRepoScraperStrategy } from "./GitHubRepoScraperStrategy";
import { GitHubWikiScraperStrategy } from "./GitHubWikiScraperStrategy";

/**
 * GitHubScraperStrategy is a composite strategy that orchestrates the scraping of both
 * GitHub repository code and wiki pages. When given a GitHub repository URL, it will:
 *
 * 1. Attempt to scrape the repository's wiki pages using GitHubWikiScraperStrategy (prioritized)
 * 2. Scrape the repository's code files using GitHubRepoScraperStrategy (with remaining page budget)
 *
 * This provides comprehensive documentation coverage by including both wiki documentation
 * and source code in a single scraping job, with wikis prioritized as they typically
 * contain higher-quality curated documentation.
 *
 * Features:
 * - Handles base GitHub repository URLs (e.g., https://github.com/owner/repo)
 * - Prioritizes wiki content over repository files for better documentation quality
 * - Respects maxPages limit across both scraping phases to prevent exceeding quotas
 * - Automatically discovers and scrapes both wiki and code content
 * - Merges progress reporting from both sub-strategies
 * - Graceful handling when wikis don't exist or are inaccessible
 * - Maintains all the capabilities of both underlying strategies
 */
export class GitHubScraperStrategy implements ScraperStrategy {
  private readonly repoStrategy = new GitHubRepoScraperStrategy();
  private readonly wikiStrategy = new GitHubWikiScraperStrategy();

  canHandle(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      const { hostname, pathname } = parsedUrl;

      // Only handle base GitHub repository URLs, not specific paths like /wiki/, /blob/, /tree/
      if (!["github.com", "www.github.com"].includes(hostname)) {
        return false;
      }

      // Check if it's a base repository URL (owner/repo format)
      const pathMatch = pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
      return pathMatch !== null;
    } catch {
      return false;
    }
  }

  async scrape(
    options: ScraperOptions,
    progressCallback: ProgressCallback<ScraperProgress>,
    signal?: AbortSignal,
  ): Promise<void> {
    // Validate it's a GitHub URL
    const url = new URL(options.url);
    if (!url.hostname.includes("github.com")) {
      throw new Error("URL must be a GitHub URL");
    }

    // Parse the repository information
    const pathMatch = url.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
    if (!pathMatch) {
      throw new Error("URL must be a base GitHub repository URL");
    }

    const [, owner, repo] = pathMatch;
    logger.info(`🚀 Starting comprehensive GitHub scraping for ${owner}/${repo}`);

    // We'll track progress from both strategies and merge them
    let totalPagesDiscovered = 0;
    let wikiPagesScraped = 0;
    let wikiCompleted = false;
    let repoCompleted = false;

    const mergedProgressCallback: ProgressCallback<ScraperProgress> = async (
      progress,
    ) => {
      // For the first strategy (wiki), accumulate discovered pages and scraped count
      if (!wikiCompleted) {
        totalPagesDiscovered = progress.totalDiscovered;
        wikiPagesScraped = progress.pagesScraped;
      } else if (!repoCompleted) {
        // For the second strategy (repo), create cumulative progress
        progress = {
          ...progress,
          pagesScraped: wikiPagesScraped + progress.pagesScraped,
          totalPages: wikiPagesScraped + progress.totalPages,
          totalDiscovered: totalPagesDiscovered + progress.totalDiscovered,
        };
      }

      // Report the progress as-is and await completion
      await progressCallback(progress);
    };

    try {
      // First, attempt to scrape the wiki (prioritized for better documentation)
      const wikiUrl = `${options.url.replace(/\/$/, "")}/wiki`;
      const wikiOptions = { ...options, url: wikiUrl };

      logger.info(`📖 Attempting to scrape wiki for ${owner}/${repo}`);

      try {
        // Check if the wiki exists by trying to access it
        await this.wikiStrategy.scrape(wikiOptions, mergedProgressCallback, signal);
        wikiCompleted = true;
        logger.info(
          `✅ Completed wiki scraping for ${owner}/${repo} (${wikiPagesScraped} pages)`,
        );
      } catch (error) {
        wikiCompleted = true;
        logger.info(`ℹ️  Wiki not available or accessible for ${owner}/${repo}: ${error}`);
        // Don't throw - wiki not existing is not a failure condition
      }

      // Then, scrape the repository code with adjusted page limit
      const maxPages = options.maxPages || 1000;
      const remainingPages = Math.max(0, maxPages - wikiPagesScraped);

      if (remainingPages > 0) {
        logger.info(
          `📂 Scraping repository code for ${owner}/${repo} (${remainingPages} pages remaining)`,
        );
        const repoOptions = { ...options, maxPages: remainingPages };
        await this.repoStrategy.scrape(repoOptions, mergedProgressCallback, signal);
        repoCompleted = true;
        logger.info(`✅ Completed repository code scraping for ${owner}/${repo}`);
      } else {
        logger.info(
          `ℹ️  Skipping repository code scraping - page limit reached with wiki content`,
        );
      }

      logger.info(`🎉 Comprehensive GitHub scraping completed for ${owner}/${repo}`);
    } catch (error) {
      logger.error(`❌ GitHub scraping failed for ${owner}/${repo}: ${error}`);
      throw error;
    }
  }

  /**
   * Cleanup resources used by both underlying strategies.
   */
  async cleanup(): Promise<void> {
    await Promise.allSettled([this.repoStrategy.cleanup(), this.wikiStrategy.cleanup()]);
  }
}
