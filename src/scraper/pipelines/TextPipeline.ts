import { GreedySplitter } from "../../splitter";
import { TextDocumentSplitter } from "../../splitter/TextDocumentSplitter";
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
 * Fallback pipeline for processing text content with basic splitting and size optimization.
 * Handles text-based content types by using TextDocumentSplitter for simple line-based splitting
 * followed by GreedySplitter for universal size optimization. This pipeline uses MIME type filtering
 * and binary detection to ensure it only processes appropriate text content.
 */
export class TextPipeline extends BasePipeline {
  private readonly middleware: ContentProcessorMiddleware[];
  private readonly splitter: GreedySplitter;

  constructor(chunkSize = SPLITTER_PREFERRED_CHUNK_SIZE) {
    super();
    // Text processing uses minimal middleware for maximum compatibility
    this.middleware = [];

    // Create the two-phase splitting: basic text splitting + size optimization
    const textSplitter = new TextDocumentSplitter({ maxChunkSize: chunkSize });
    this.splitter = new GreedySplitter(textSplitter, SPLITTER_MIN_CHUNK_SIZE, chunkSize);
  }

  canProcess(rawContent: RawContent): boolean {
    // This pipeline serves as a fallback for text content, but should not process binary files

    // First check: MIME type filtering - use utility method for safe types
    if (!MimeTypeUtils.isSafeForTextProcessing(rawContent.mimeType)) {
      return false;
    }

    // Second check: binary detection via null bytes
    if (MimeTypeUtils.isBinary(rawContent.content)) {
      return false;
    }

    // If we get here, it's a safe MIME type and doesn't appear binary
    return true;
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
        contentType: rawContent.mimeType || "text/plain",
        isGenericText: true,
      },
      links: [], // Generic text content typically doesn't contain structured links
      errors: [],
      options,
      fetcher,
    };

    // Execute the middleware stack (minimal for generic text)
    await this.executeMiddlewareStack(this.middleware, context);

    // Split the content using TextDocumentSplitter with size optimization
    const chunks = await this.splitter.splitText(context.content, rawContent.mimeType);

    return {
      textContent: context.content,
      metadata: context.metadata,
      links: context.links,
      errors: context.errors,
      chunks,
    };
  }
}
