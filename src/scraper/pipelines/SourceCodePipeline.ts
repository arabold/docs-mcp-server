import { GreedySplitter } from "../../splitter";
import { TextDocumentSplitter } from "../../splitter/TextDocumentSplitter";
import type { ContentChunk } from "../../splitter/types";
import {
  SPLITTER_MIN_CHUNK_SIZE,
  SPLITTER_PREFERRED_CHUNK_SIZE,
} from "../../utils/config";
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import type { ContentFetcher, RawContent } from "../fetcher/types";
import type { ContentProcessorMiddleware, MiddlewareContext } from "../middleware/types";
import type { ScraperOptions } from "../types";
import { convertToString } from "../utils/buffer";
import { BasePipeline } from "./BasePipeline";
import type { ProcessedContent } from "./types";

/**
 * Pipeline for processing source code content with semantic splitting and size optimization.
 * Handles programming language files by using TextDocumentSplitter for line-based splitting
 * with proper language detection, followed by GreedySplitter for universal size optimization.
 */
export class SourceCodePipeline extends BasePipeline {
  private readonly middleware: ContentProcessorMiddleware[];
  private readonly splitter: GreedySplitter;

  constructor(chunkSize = SPLITTER_PREFERRED_CHUNK_SIZE) {
    super();
    // Source code processing uses minimal middleware since we preserve raw structure
    this.middleware = [];

    // Create the two-phase splitting: semantic + size optimization
    const textSplitter = new TextDocumentSplitter({ maxChunkSize: chunkSize });
    this.splitter = new GreedySplitter(textSplitter, SPLITTER_MIN_CHUNK_SIZE, chunkSize);
  }

  canProcess(rawContent: RawContent): boolean {
    if (!rawContent.mimeType) return false;
    return MimeTypeUtils.isSourceCode(rawContent.mimeType);
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
      metadata: {
        language: rawContent.mimeType
          ? MimeTypeUtils.extractLanguageFromMimeType(rawContent.mimeType)
          : "text",
        isSourceCode: true,
      },
      links: [], // Source code files typically don't contain web links
      errors: [],
      options,
      fetcher,
    };

    // Execute the middleware stack (minimal for source code)
    await this.executeMiddlewareStack(this.middleware, context);

    // Split the content using CodeContentSplitter
    const chunks = await this.split(context.content, rawContent.mimeType);

    return {
      textContent: context.content,
      metadata: context.metadata,
      links: context.links,
      errors: context.errors,
      chunks,
    };
  }

  async split(content: string, contentType?: string): Promise<ContentChunk[]> {
    // Use GreedySplitter (which wraps TextDocumentSplitter) for optimized chunking
    return await this.splitter.splitText(content, contentType);
  }

  async close(): Promise<void> {}
}
