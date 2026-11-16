import { type AutoDetectFetcher, FetchStatus, type RawContent } from "../scraper/fetcher";
import { PipelineFactory } from "../scraper/pipelines/PipelineFactory";
import type { ContentPipeline, PipelineResult } from "../scraper/pipelines/types";
import { ScrapeMode } from "../scraper/types";
import { convertToString } from "../scraper/utils/buffer";
import { resolveCharset } from "../scraper/utils/charset";
import type { AppConfig } from "../utils/config";
import { ChallengeError, HttpStatusError, RenderError } from "../utils/errors";
import { logger } from "../utils/logger";
import { EmptyContentError, ToolError, ValidationError } from "./errors";

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
  private activeRequests = 0;
  private cleanup: Promise<void> | undefined;

  constructor(fetcher: AutoDetectFetcher, config: AppConfig) {
    this.fetcher = fetcher;
    // Use the central factory to ensure consistent pipeline configuration across the system
    this.pipelines = PipelineFactory.createStandardPipelines(config);
  }

  /**
   * Fetches content from a URL and converts it to Markdown.
   * Supports both HTTP/HTTPS URLs and local file URLs (file://).
   * Concurrent requests keep shared browser resources open until the last one finishes.
   * @param options - URL and fetch options.
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

    this.activeRequests += 1;
    try {
      if (this.cleanup) {
        await this.cleanup;
      }

      logger.info(`📡 Fetching ${url}...`);

      const fetchOptions = {
        followRedirects: options.followRedirects ?? true,
        maxRetries: 3,
        headers, // propagate custom headers
      };

      // AutoDetectFetcher handles all fallback logic automatically
      const rawContent: RawContent = await this.fetcher.fetch(url, fetchOptions);
      if (rawContent.status === FetchStatus.NOT_FOUND && !url.startsWith("file://")) {
        throw new HttpStatusError("Not Found", false, 404);
      }

      logger.info("🔄 Processing content...");

      let processed: Awaited<PipelineResult> | undefined;
      for (const pipeline of this.pipelines) {
        if (pipeline.canProcess(rawContent.mimeType, rawContent.content)) {
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

      for (const err of processed.errors ?? []) {
        logger.warn(`⚠️  Processing error for ${url}: ${err.message}`);
      }

      if (typeof processed.textContent !== "string" || !processed.textContent.trim()) {
        throw new EmptyContentError(
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

      // The generic advice below would send the user checking a URL that is
      // fine; name the block instead.
      if (error instanceof ChallengeError) {
        throw new ToolError(
          `Unable to fetch the URL "${url}": the site answered with a ${error.challengeType} bot challenge instead of the page, which cannot be passed automatically.`,
          this.constructor.name,
          { cause: error },
        );
      }

      // The page was fetched; only the browser failed, so the URL is not the problem.
      if (error instanceof RenderError) {
        throw new ToolError(
          `${error.message}. Use scrape mode "auto" to read the page as fetched instead.`,
          this.constructor.name,
          { cause: error },
        );
      }

      throw new ToolError(
        error instanceof HttpStatusError
          ? `HTTP ${error.statusCode} while fetching "${url}".`
          : `Unable to fetch or process the URL "${url}". Please verify the URL is correct and accessible.`,
        this.constructor.name,
        { cause: error },
      );
    } finally {
      this.activeRequests -= 1;
      if (this.activeRequests === 0) {
        this.cleanup = Promise.allSettled([
          ...this.pipelines.map((pipeline) => pipeline.close()),
          this.fetcher.close(),
        ]).then(() => {
          this.cleanup = undefined;
        });
        await this.cleanup;
      }
    }
  }
}
