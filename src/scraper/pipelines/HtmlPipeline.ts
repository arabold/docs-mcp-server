import { GreedySplitter } from "../../splitter/GreedySplitter";
import { SemanticMarkdownSplitter } from "../../splitter/SemanticMarkdownSplitter";
import type { AppConfig } from "../../utils/config";
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import type { ContentFetcher, RawContent } from "../fetcher/types";
import { HtmlCheerioParserMiddleware } from "../middleware/HtmlCheerioParserMiddleware";
import { HtmlLinkExtractorMiddleware } from "../middleware/HtmlLinkExtractorMiddleware";
import { HtmlMetadataExtractorMiddleware } from "../middleware/HtmlMetadataExtractorMiddleware";
import { HtmlNormalizationMiddleware } from "../middleware/HtmlNormalizationMiddleware";
import { HtmlPlaywrightMiddleware } from "../middleware/HtmlPlaywrightMiddleware";
import { HtmlSanitizerMiddleware } from "../middleware/HtmlSanitizerMiddleware";
import { HtmlToMarkdownMiddleware } from "../middleware/HtmlToMarkdownMiddleware";
import type { ContentProcessorMiddleware, MiddlewareContext } from "../middleware/types";
import type { ScraperOptions } from "../types";
import { convertToString } from "../utils/buffer";
import { resolveCharset } from "../utils/charset";
import { BasePipeline } from "./BasePipeline";
import type { PipelineResult } from "./types";

/**
 * HtmlPipeline - Processes HTML content into Markdown chunks.
 * Uses Playwright for rendering if needed and Cheerio for semantic extraction.
 */
export class HtmlPipeline extends BasePipeline {
  private readonly playwrightMiddleware: HtmlPlaywrightMiddleware;
  private readonly standardMiddleware: ContentProcessorMiddleware[];
  private readonly greedySplitter: GreedySplitter;

  constructor(config: AppConfig) {
    super();

    const preferredChunkSize = config.splitter.preferredChunkSize;
    const maxChunkSize = config.splitter.maxChunkSize;
    const minChunkSize = config.splitter.minChunkSize;

    this.playwrightMiddleware = new HtmlPlaywrightMiddleware(config.scraper);
    this.standardMiddleware = [
      new HtmlCheerioParserMiddleware(),
      new HtmlMetadataExtractorMiddleware(),
      new HtmlLinkExtractorMiddleware(),
      new HtmlSanitizerMiddleware(),
      new HtmlNormalizationMiddleware(),
      new HtmlToMarkdownMiddleware(),
    ];

    // Create the two-phase splitting: semantic + size optimization
    const semanticSplitter = new SemanticMarkdownSplitter(
      preferredChunkSize,
      maxChunkSize,
    );
    this.greedySplitter = new GreedySplitter(
      semanticSplitter,
      minChunkSize,
      preferredChunkSize,
      maxChunkSize,
    );
  }

  canProcess(mimeType: string): boolean {
    return MimeTypeUtils.isHtml(mimeType);
  }

  async process(
    rawContent: RawContent,
    options: ScraperOptions,
    fetcher?: ContentFetcher,
  ): Promise<PipelineResult> {
    // Use enhanced charset detection that considers HTML meta tags
    const resolvedCharset = resolveCharset(
      rawContent.charset,
      rawContent.content,
      rawContent.mimeType,
    );
    const contentString = convertToString(rawContent.content, resolvedCharset);

    const context: MiddlewareContext = {
      content: contentString,
      contentType: rawContent.mimeType || "text/html",
      source: rawContent.source,
      // metadata: {},
      links: [],
      errors: [],
      options,
      fetcher,
    };

    // Build middleware stack dynamically based on scrapeMode
    let middleware: ContentProcessorMiddleware[] = [...this.standardMiddleware];
    if (options.scrapeMode === "playwright" || options.scrapeMode === "auto") {
      middleware = [this.playwrightMiddleware, ...middleware];
    }

    // Execute the middleware stack using the base class method
    await this.executeMiddlewareStack(middleware, context);

    // Split the content using SemanticMarkdownSplitter (HTML is converted to markdown by middleware)
    const chunks = await this.greedySplitter.splitText(
      typeof context.content === "string" ? context.content : "",
    );

    return {
      title: context.title,
      contentType: context.contentType,
      textContent: context.content,
      links: context.links,
      errors: context.errors,
      chunks,
    };
  }

  /**
   * Cleanup resources used by this pipeline, specifically the Playwright browser instance.
   */
  public async close(): Promise<void> {
    await super.close(); // Call base class close (no-op by default)
    await this.playwrightMiddleware.closeBrowser();
  }
}
