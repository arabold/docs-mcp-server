import type {
  ContentFetcher,
  FileFetcher,
  HttpFetcher,
  RawContent,
} from "../scraper/fetcher";
import { HtmlPipeline } from "../scraper/pipelines/HtmlPipeline";
import { MarkdownPipeline } from "../scraper/pipelines/MarkdownPipeline";
import type { ContentPipeline, ProcessedContent } from "../scraper/pipelines/types";
import { ScrapeMode } from "../scraper/types";
import { convertToString } from "../scraper/utils/buffer";
import { resolveCharset } from "../scraper/utils/charset";
import { analytics } from "../telemetry";
import { ScraperError } from "../utils/errors";
import { logger } from "../utils/logger";
import { ToolError } from "./errors";

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
   * Collection of fetchers that will be tried in order for a given URL.
   */
  private readonly fetchers: ContentFetcher[];
  /**
   * Collection of pipelines that will be tried in order for processing content.
   * The first pipeline that can process the content type will be used.
   * Currently includes HtmlPipeline and MarkdownPipeline.
   */
  private readonly pipelines: ContentPipeline[];

  constructor(httpFetcher: HttpFetcher, fileFetcher: FileFetcher) {
    this.fetchers = [httpFetcher, fileFetcher];
    const htmlPipeline = new HtmlPipeline();
    const markdownPipeline = new MarkdownPipeline();
    this.pipelines = [htmlPipeline, markdownPipeline];
  }

  /**
   * Fetches content from a URL and converts it to Markdown.
   * Supports both HTTP/HTTPS URLs and local file URLs (file://).
   * @returns The processed Markdown content
   * @throws {ToolError} If fetching or processing fails
   */
  async execute(options: FetchUrlToolOptions): Promise<string> {
    return analytics.trackTool(
      "fetch_url",
      async () => {
        const { url, scrapeMode = ScrapeMode.Auto, headers } = options;

        const canFetchResults = this.fetchers.map((f) => f.canFetch(url));
        const fetcherIndex = canFetchResults.indexOf(true);
        if (fetcherIndex === -1) {
          throw new ToolError(
            `Invalid URL: ${url}. Must be an HTTP/HTTPS URL or a file:// URL.`,
            this.constructor.name,
          );
        }

        const fetcher = this.fetchers[fetcherIndex];

        try {
          logger.info(`📡 Fetching ${url}...`);
          const rawContent: RawContent = await fetcher.fetch(url, {
            followRedirects: options.followRedirects ?? true,
            maxRetries: 3,
            headers, // propagate custom headers
          });

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
                fetcher,
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

          if (
            typeof processed.textContent !== "string" ||
            !processed.textContent.trim()
          ) {
            throw new ToolError(
              `Processing resulted in empty content for ${url}`,
              this.constructor.name,
            );
          }

          logger.info(`✅ Successfully processed ${url}`);
          return processed.textContent;
        } catch (error) {
          if (error instanceof ScraperError || error instanceof ToolError) {
            throw new ToolError(
              `Failed to fetch or process URL: ${error.message}`,
              this.constructor.name,
            );
          }
          throw new ToolError(
            `Failed to fetch or process URL: ${error instanceof Error ? error.message : String(error)}`,
            this.constructor.name,
          );
        }
      },
      (result) => {
        const { url, scrapeMode, followRedirects, headers } = options;
        return {
          url,
          scrapeMode,
          followRedirects,
          contentLength: result.length,
          hasHeaders: !!headers,
        };
      },
    );
  }
}
