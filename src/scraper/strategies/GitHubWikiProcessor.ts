import type { AppConfig } from "../../utils/config";
import { logger } from "../../utils/logger";
import { HttpFetcher } from "../fetcher";
import { FetchStatus } from "../fetcher/types";
import { PipelineFactory } from "../pipelines/PipelineFactory";
import type { ContentPipeline, PipelineResult } from "../pipelines/types";
import type { QueueItem } from "../types";
import { ScrapeMode, type ScraperOptions } from "../types";
import { shouldIncludeUrl } from "../utils/patternMatcher";
import type { ProcessItemResult } from "./BaseScraperStrategy";

interface GitHubWikiInfo {
  owner: string;
  repo: string;
}

/**
 * GitHubWikiProcessor handles scraping GitHub wiki pages using standard web scraping techniques.
 * GitHub wikis are separate from the main repository and are hosted at /wiki/ URLs.
 *
 * Features:
 * - Scrapes all wiki pages by following links within the wiki
 * - Uses web scraping approach since wikis are not available via the Git tree API
 * - Processes wiki content as HTML/Markdown pages
 * - Stays within the wiki scope to avoid crawling the entire repository
 *
 * This processor is stateless and contains the core logic from GitHubWikiScraperStrategy.
 */
export class GitHubWikiProcessor {
  private readonly httpFetcher: HttpFetcher;
  private readonly pipelines: ContentPipeline[];

  constructor(config: AppConfig) {
    this.httpFetcher = new HttpFetcher(config.scraper);
    this.pipelines = PipelineFactory.createStandardPipelines(config);
  }

  /**
   * Parses a GitHub wiki URL to extract repository information.
   */
  parseGitHubWikiUrl(url: string): GitHubWikiInfo {
    const parsedUrl = new URL(url);
    // Extract /<org>/<repo> from github.com/<org>/<repo>/wiki/...
    const match = parsedUrl.pathname.match(/^\/([^/]+)\/([^/]+)\/wiki/);
    if (!match) {
      throw new Error(`Invalid GitHub wiki URL: ${url}`);
    }

    const [, owner, repo] = match;
    return { owner, repo };
  }

  /**
   * Determines if a URL should be processed within the wiki scope.
   */
  shouldProcessUrl(url: string, options: ScraperOptions): boolean {
    try {
      const parsedUrl = new URL(url);

      // Get the expected repository info from the base URL
      const baseWikiInfo = this.parseGitHubWikiUrl(options.url);
      const expectedWikiPath = `/${baseWikiInfo.owner}/${baseWikiInfo.repo}/wiki`;

      // Check if the URL is within the same wiki
      if (!parsedUrl.pathname.startsWith(expectedWikiPath)) {
        return false;
      }

      // Apply include/exclude patterns to the wiki page path
      const wikiPagePath = parsedUrl.pathname
        .replace(expectedWikiPath, "")
        .replace(/^\//, "");
      return shouldIncludeUrl(
        wikiPagePath || "Home",
        options.includePatterns,
        options.excludePatterns,
      );
    } catch {
      return false;
    }
  }

  /**
   * Processes a single GitHub wiki page.
   */
  async process(
    item: QueueItem,
    options: ScraperOptions,
    headers?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<ProcessItemResult> {
    const currentUrl = item.url;

    try {
      // Fetch the wiki page content with ETag for conditional requests
      const rawContent = await this.httpFetcher.fetch(currentUrl, {
        signal,
        etag: item.etag,
        headers,
      });

      // Return the status directly - BaseScraperStrategy handles NOT_MODIFIED and NOT_FOUND
      if (rawContent.status !== FetchStatus.SUCCESS) {
        return { url: currentUrl, links: [], status: rawContent.status };
      }

      // Process content through appropriate pipeline
      let processed: PipelineResult | undefined;

      for (const pipeline of this.pipelines) {
        if (pipeline.canProcess(rawContent.mimeType, rawContent.content)) {
          logger.debug(
            `Selected ${pipeline.constructor.name} for content type "${rawContent.mimeType}" (${currentUrl})`,
          );

          // Use fetch mode for consistent behavior
          const wikiOptions = { ...options, scrapeMode: ScrapeMode.Fetch };

          processed = await pipeline.process(rawContent, wikiOptions, this.httpFetcher);
          break;
        }
      }

      if (!processed) {
        logger.warn(
          `⚠️  Unsupported content type "${rawContent.mimeType}" for wiki page ${currentUrl}. Skipping processing.`,
        );
        return { url: currentUrl, links: [], status: FetchStatus.SUCCESS };
      }

      for (const err of processed.errors ?? []) {
        logger.warn(`⚠️  Processing error for ${currentUrl}: ${err.message}`);
      }

      // Extract wiki page title from URL
      const parsedUrl = new URL(currentUrl);
      const wikiInfo = this.parseGitHubWikiUrl(currentUrl);
      const wikiPagePath = parsedUrl.pathname
        .replace(`/${wikiInfo.owner}/${wikiInfo.repo}/wiki`, "")
        .replace(/^\//, "");
      const pageTitle = wikiPagePath || "Home";

      // Extract links from the processed content
      const links = processed.links || [];

      // Filter links to only include other wiki pages and ensure they're absolute URLs
      const wikiLinks = links
        .filter((link) => {
          // Skip obviously invalid links
          if (
            !link ||
            link.trim() === "" ||
            link === "invalid-url" ||
            link === "not-a-url-at-all"
          ) {
            return false;
          }
          return true;
        })
        .map((link) => {
          try {
            // Convert relative links to absolute URLs
            return new URL(link, currentUrl).href;
          } catch {
            return null;
          }
        })
        .filter((link): link is string => link !== null)
        .filter((link) => {
          try {
            const linkUrl = new URL(link);
            // Only include links that are within the same wiki
            return (
              linkUrl.hostname === parsedUrl.hostname &&
              linkUrl.pathname.startsWith(`/${wikiInfo.owner}/${wikiInfo.repo}/wiki`)
            );
          } catch {
            return false;
          }
        });

      return {
        url: currentUrl,
        title: pageTitle,
        etag: rawContent.etag,
        lastModified: rawContent.lastModified,
        contentType: rawContent.mimeType,
        content: processed,
        links: wikiLinks,
        status: FetchStatus.SUCCESS,
      };
    } catch (error) {
      logger.warn(`⚠️  Failed to process wiki page ${currentUrl}: ${error}`);
      return { url: currentUrl, links: [], status: FetchStatus.SUCCESS };
    }
  }

  /**
   * Cleanup resources used by this processor.
   */
  async cleanup(): Promise<void> {
    await Promise.allSettled(this.pipelines.map((pipeline) => pipeline.close()));
  }
}
