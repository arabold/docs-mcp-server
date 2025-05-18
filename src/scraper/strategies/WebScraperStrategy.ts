import type { Document, ProgressCallback } from "../../types";
import { logger } from "../../utils/logger";
import type { UrlNormalizerOptions } from "../../utils/url";
import { hasSameDomain, hasSameHostname, isSubpath } from "../../utils/url";
import { HttpFetcher } from "../fetcher";
import type { RawContent } from "../fetcher/types";
import { HtmlPipeline } from "../pipelines/HtmlPipeline";
import { JsonPipeline } from "../pipelines/JsonPipeline";
import { MarkdownPipeline } from "../pipelines/MarkdownPipeline";
import type { ContentPipeline, ProcessedContent } from "../pipelines/types";
import type { ScraperOptions, ScraperProgress } from "../types";
import { BaseScraperStrategy, type QueueItem } from "./BaseScraperStrategy";

export interface WebScraperStrategyOptions {
  urlNormalizerOptions?: UrlNormalizerOptions;
  shouldFollowLink?: (baseUrl: URL, targetUrl: URL) => boolean;
}

export class WebScraperStrategy extends BaseScraperStrategy {
  private readonly httpFetcher = new HttpFetcher();
  private readonly shouldFollowLinkFn?: (baseUrl: URL, targetUrl: URL) => boolean;
  private readonly htmlPipeline: HtmlPipeline;
  private readonly markdownPipeline: MarkdownPipeline;
  private readonly jsonPipeline: JsonPipeline;
  private readonly pipelines: ContentPipeline[];

  constructor(options: WebScraperStrategyOptions = {}) {
    super({ urlNormalizerOptions: options.urlNormalizerOptions });
    this.shouldFollowLinkFn = options.shouldFollowLink;
    this.htmlPipeline = new HtmlPipeline();
    this.markdownPipeline = new MarkdownPipeline();
    this.jsonPipeline = new JsonPipeline();
    this.pipelines = [this.htmlPipeline, this.markdownPipeline, this.jsonPipeline];
  }

  canHandle(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
    } catch {
      return false;
    }
  }

  /**
   * Determines if a target URL should be followed based on the scope setting.
   */
  private isInScope(
    baseUrl: URL,
    targetUrl: URL,
    scope: "subpages" | "hostname" | "domain",
  ): boolean {
    try {
      // First check if the URLs are on the same domain or hostname
      if (scope === "domain") {
        return hasSameDomain(baseUrl, targetUrl);
      }
      if (scope === "hostname") {
        return hasSameHostname(baseUrl, targetUrl);
      }
      // 'subpages' (default)
      return hasSameHostname(baseUrl, targetUrl) && isSubpath(baseUrl, targetUrl);
    } catch {
      return false;
    }
  }

  protected override async processItem(
    item: QueueItem,
    options: ScraperOptions,
    _progressCallback?: ProgressCallback<ScraperProgress>, // Base class passes it, but not used here
    signal?: AbortSignal, // Add signal
  ): Promise<{ document?: Document; links?: string[] }> {
    const { url } = item;

    try {
      // Define fetch options, passing both signal and followRedirects
      const fetchOptions = {
        signal,
        followRedirects: options.followRedirects,
      };

      // Pass options to fetcher
      const rawContent: RawContent = await this.httpFetcher.fetch(url, fetchOptions);

      // --- Start Pipeline Processing ---
      let processed: ProcessedContent | undefined;
      for (const pipeline of this.pipelines) {
        if (pipeline.canProcess(rawContent)) {
          processed = await pipeline.process(rawContent, options, this.httpFetcher);
          break;
        }
      }

      if (!processed) {
        logger.warn(
          `⚠️ Unsupported content type "${rawContent.mimeType}" for URL ${url}. Skipping processing.`,
        );
        return { document: undefined, links: [] };
      }

      // Log errors from pipeline
      for (const err of processed.errors) {
        logger.warn(`⚠️ Processing error for ${url}: ${err.message}`);
      }

      // Check if content processing resulted in usable content
      if (!processed.textContent || !processed.textContent.trim()) {
        logger.warn(
          `⚠️ No processable content found for ${url} after pipeline execution.`,
        );
        return { document: undefined, links: processed.links };
      }

      // Filter extracted links based on scope and custom filter
      const baseUrl = new URL(options.url);
      const filteredLinks = processed.links.filter((link) => {
        try {
          const targetUrl = new URL(link);
          const scope = options.scope || "subpages";
          return (
            this.isInScope(baseUrl, targetUrl, scope) &&
            (!this.shouldFollowLinkFn || this.shouldFollowLinkFn(baseUrl, targetUrl))
          );
        } catch {
          return false;
        }
      });

      return {
        document: {
          content: processed.textContent,
          metadata: {
            url,
            title:
              typeof processed.metadata.title === "string"
                ? processed.metadata.title
                : "Untitled",
            library: options.library,
            version: options.version,
            ...processed.metadata,
          },
        } satisfies Document,
        links: filteredLinks,
      };
    } catch (error) {
      // Log fetch errors or pipeline execution errors (if run throws)
      logger.error(`❌ Failed processing page ${url}: ${error}`);
      throw error;
    }
  }

  /**
   * Overrides the base scrape method to ensure the Playwright browser is closed
   * after the scraping process completes or errors out.
   */
  override async scrape(
    options: ScraperOptions,
    progressCallback: ProgressCallback<ScraperProgress>,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      // Call the base class scrape method
      await super.scrape(options, progressCallback, signal);
    } finally {
      // Ensure the browser instance is closed
      await this.htmlPipeline.close();
      await this.markdownPipeline.close();
    }
  }
}
