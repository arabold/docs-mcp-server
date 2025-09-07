import { GreedySplitter, SemanticMarkdownSplitter } from "../../splitter";
import {
  SPLITTER_MAX_CHUNK_SIZE,
  SPLITTER_MIN_CHUNK_SIZE,
  SPLITTER_PREFERRED_CHUNK_SIZE,
} from "../../utils/config";
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import type { ContentFetcher, RawContent } from "../fetcher/types";
import { HtmlSanitizerMiddleware } from "../middleware";
import { HtmlCheerioParserMiddleware } from "../middleware/HtmlCheerioParserMiddleware";
import { HtmlLinkExtractorMiddleware } from "../middleware/HtmlLinkExtractorMiddleware";
import { HtmlMetadataExtractorMiddleware } from "../middleware/HtmlMetadataExtractorMiddleware";
import { HtmlPlaywrightMiddleware } from "../middleware/HtmlPlaywrightMiddleware";
import { HtmlToMarkdownMiddleware } from "../middleware/HtmlToMarkdownMiddleware";
import type { ContentProcessorMiddleware, MiddlewareContext } from "../middleware/types";
import type { ScraperOptions } from "../types";
import { convertToString } from "../utils/buffer";
import { resolveCharset } from "../utils/charset";
import { BasePipeline } from "./BasePipeline";
import type { ProcessedContent } from "./types";

/**
 * Pipeline for processing HTML content using middleware and semantic splitting with size optimization.
 * Converts HTML to clean markdown format then uses SemanticMarkdownSplitter for semantic chunking,
 * followed by GreedySplitter for universal size optimization.
 */
export class HtmlPipeline extends BasePipeline {
  private readonly playwrightMiddleware: HtmlPlaywrightMiddleware;
  private readonly standardMiddleware: ContentProcessorMiddleware[];
  private readonly greedySplitter: GreedySplitter;

  constructor(
    preferredChunkSize = SPLITTER_PREFERRED_CHUNK_SIZE,
    maxChunkSize = SPLITTER_MAX_CHUNK_SIZE,
  ) {
    super();
    this.playwrightMiddleware = new HtmlPlaywrightMiddleware();
    this.standardMiddleware = [
      new HtmlCheerioParserMiddleware(),
      new HtmlMetadataExtractorMiddleware(),
      new HtmlLinkExtractorMiddleware(),
      new HtmlSanitizerMiddleware(),
      new HtmlToMarkdownMiddleware(),
    ];

    // Create the two-phase splitting: semantic + size optimization
    const semanticSplitter = new SemanticMarkdownSplitter(
      preferredChunkSize,
      maxChunkSize,
    );
    this.greedySplitter = new GreedySplitter(
      semanticSplitter,
      SPLITTER_MIN_CHUNK_SIZE,
      preferredChunkSize,
    );
  }

  canProcess(rawContent: RawContent): boolean {
    return MimeTypeUtils.isHtml(rawContent.mimeType);
  }

  async process(
    rawContent: RawContent,
    options: ScraperOptions,
    fetcher?: ContentFetcher,
  ): Promise<ProcessedContent> {
    // Use enhanced charset detection that considers HTML meta tags
    const resolvedCharset = resolveCharset(
      rawContent.charset,
      rawContent.content,
      rawContent.mimeType,
    );
    const contentString = convertToString(rawContent.content, resolvedCharset);

    const context: MiddlewareContext = {
      content: contentString,
      source: rawContent.source,
      metadata: {},
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
      textContent: typeof context.content === "string" ? context.content : "",
      metadata: context.metadata,
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
