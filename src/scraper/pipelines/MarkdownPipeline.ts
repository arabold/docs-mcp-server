import { GreedySplitter, SemanticMarkdownSplitter } from "../../splitter";
import {
  SPLITTER_MAX_CHUNK_SIZE,
  SPLITTER_MIN_CHUNK_SIZE,
  SPLITTER_PREFERRED_CHUNK_SIZE,
} from "../../utils/config";
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import type { ContentFetcher, RawContent } from "../fetcher/types";
import { MarkdownLinkExtractorMiddleware } from "../middleware/MarkdownLinkExtractorMiddleware";
import { MarkdownMetadataExtractorMiddleware } from "../middleware/MarkdownMetadataExtractorMiddleware";
import type { ContentProcessorMiddleware, MiddlewareContext } from "../middleware/types";
import type { ScraperOptions } from "../types";
import { convertToString } from "../utils/buffer";
import { BasePipeline } from "./BasePipeline";
import type { ProcessedContent } from "./types";

/**
 * Pipeline for processing Markdown content using middleware and semantic splitting with size optimization.
 * Uses SemanticMarkdownSplitter for content-type-aware semantic chunking,
 * followed by GreedySplitter for universal size optimization.
 */
export class MarkdownPipeline extends BasePipeline {
  private readonly middleware: ContentProcessorMiddleware[];
  private readonly greedySplitter: GreedySplitter;

  constructor(
    preferredChunkSize = SPLITTER_PREFERRED_CHUNK_SIZE,
    maxChunkSize = SPLITTER_MAX_CHUNK_SIZE,
  ) {
    super();
    this.middleware = [
      new MarkdownMetadataExtractorMiddleware(),
      new MarkdownLinkExtractorMiddleware(),
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
    if (!rawContent.mimeType) return false;
    return MimeTypeUtils.isMarkdown(rawContent.mimeType);
  }

  async process(
    rawContent: RawContent,
    options: ScraperOptions,
    fetcher?: ContentFetcher,
  ): Promise<ProcessedContent> {
    const contentString = convertToString(rawContent.content, rawContent.charset);

    const context: MiddlewareContext = {
      content: contentString,
      source: rawContent.source,
      metadata: {},
      links: [],
      errors: [],
      options,
      fetcher,
    };

    // Execute the middleware stack using the base class method
    await this.executeMiddlewareStack(this.middleware, context);

    // Split the content using SemanticMarkdownSplitter
    const chunks = await this.greedySplitter.splitText(
      typeof context.content === "string" ? context.content : "",
      rawContent.mimeType,
    );

    return {
      textContent: typeof context.content === "string" ? context.content : "",
      metadata: context.metadata,
      links: context.links,
      errors: context.errors,
      chunks,
    };
  }

  async close(): Promise<void> {}
}
