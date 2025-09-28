import type { AutoDetectFetcher, RawContent } from "../scraper/fetcher";
import { HtmlPipeline } from "../scraper/pipelines/HtmlPipeline";
import { MarkdownPipeline } from "../scraper/pipelines/MarkdownPipeline";
import { TextPipeline } from "../scraper/pipelines/TextPipeline";
import type { ContentPipeline, ProcessedContent } from "../scraper/pipelines/types";
import { ScrapeMode } from "../scraper/types";
import { convertToString } from "../scraper/utils/buffer";
import { resolveCharset } from "../scraper/utils/charset";
import { logger } from "../utils/logger";
import { ToolError, ValidationError } from "./errors";

export interface FetchUrlToolOptions {
  /**
   * The URL to fetch and convert to markdown.
   * Must be a valid HTTP/HTTPS URL or file:// URL.
   */
  url: string;

  /**
   * Whether to follow HTTP redirects.
   * @default true
   */
  followRedirects?: boolean;

  /**
   * Determines the HTML processing strategy.
   * - 'fetch': Use a simple DOM parser (faster, less JS support).
   * - 'playwright': Use a headless browser (slower, full JS support).
   * - 'auto': Automatically select the best strategy (currently defaults to 'playwright').
   * @default ScrapeMode.Auto
   */
  scrapeMode?: ScrapeMode;

  /**
   * Custom HTTP headers to send with the request (e.g., for authentication).
   * Keys are header names, values are header values.
   */
  headers?: Record<string, string>;
}

/**
 * Tool for fetching a single URL and converting its content to Markdown.
 * Unlike scrape_docs, this tool only processes one page without crawling
 * or storing the content.
 *
 * Supports both HTTP/HTTPS URLs and local file URLs (file://).
 */
export class FetchUrlTool {
  /**
   * AutoDetectFetcher handles all URL types and fallback logic automatically.
   */
  private readonly fetcher: AutoDetectFetcher;
  /**
   * Collection of pipelines that will be tried in order for processing content.
   * The first pipeline that can process the content type will be used.
   * Currently includes HtmlPipeline, MarkdownPipeline, and TextPipeline (as fallback).
   */
  private readonly pipelines: ContentPipeline[];

  constructor(fetcher: AutoDetectFetcher) {
    this.fetcher = fetcher;
    const htmlPipeline = new HtmlPipeline();
    const markdownPipeline = new MarkdownPipeline();
    const textPipeline = new TextPipeline();
    // Order matters: more specific pipelines first, fallback (text) pipeline last
    this.pipelines = [htmlPipeline, markdownPipeline, textPipeline];
  }

  /**
   * Fetches content from a URL and converts it to Markdown.
   * Supports both HTTP/HTTPS URLs and local file URLs (file://).
   * @returns The processed Markdown content
   * @throws {ToolError} If fetching or processing fails
   */
  async execute(options: FetchUrlToolOptions): Promise<string> {
    const { url, scrapeMode = ScrapeMode.Auto, headers } = options;

    if (!this.fetcher.canFetch(url)) {
      throw new ValidationError(
        `Invalid URL: ${url}. Must be an HTTP/HTTPS URL or a file:// URL.`,
        this.constructor.name,
      );
    }

    try {
      logger.info(`📡 Fetching ${url}...`);

      const fetchOptions = {
        followRedirects: options.followRedirects ?? true,
        maxRetries: 3,
        headers, // propagate custom headers
      };

      // AutoDetectFetcher handles all fallback logic automatically
      const rawContent: RawContent = await this.fetcher.fetch(url, fetchOptions);

      logger.info("🔄 Processing content...");

      let processed: Awaited<ProcessedContent> | undefined;
      for (const pipeline of this.pipelines) {
        if (pipeline.canProcess(rawContent)) {
          processed = await pipeline.process(
            rawContent,
            {
              url,
              library: "",
              version: "",
              maxDepth: 0,
              maxPages: 1,
              maxConcurrency: 1,
              scope: "subpages",
              followRedirects: options.followRedirects ?? true,
              excludeSelectors: undefined,
              ignoreErrors: false,
              scrapeMode,
              headers, // propagate custom headers
            },
            this.fetcher,
          );
          break;
        }
      }

      if (!processed) {
        logger.warn(
          `⚠️  Unsupported content type "${rawContent.mimeType}" for ${url}. Returning raw content.`,
        );
        // Use proper charset detection for unsupported content types
        const resolvedCharset = resolveCharset(
          rawContent.charset,
          rawContent.content,
          rawContent.mimeType,
        );
        const contentString = convertToString(rawContent.content, resolvedCharset);
        return contentString;
      }

      for (const err of processed.errors) {
        logger.warn(`⚠️  Processing error for ${url}: ${err.message}`);
      }

      if (typeof processed.textContent !== "string" || !processed.textContent.trim()) {
        throw new ToolError(
          `Processing resulted in empty content for ${url}`,
          this.constructor.name,
        );
      }

      logger.info(`✅ Successfully processed ${url}`);
      return processed.textContent;
    } catch (error) {
      // Preserve ToolError as it already has user-friendly messages, wrap others
      if (error instanceof ToolError) {
        throw error;
      }

      throw new ToolError(
        `Unable to fetch or process the URL "${url}". Please verify the URL is correct and accessible.`,
        this.constructor.name,
      );
    } finally {
      // Cleanup all pipelines and fetcher to prevent resource leaks (e.g., browser instances)
      await Promise.allSettled([
        ...this.pipelines.map((pipeline) => pipeline.close()),
        this.fetcher.close(),
      ]);
    }
  }
}
