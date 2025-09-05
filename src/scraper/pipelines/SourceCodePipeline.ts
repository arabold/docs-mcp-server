import { GreedySplitter } from "../../splitter";
import { TextDocumentSplitter } from "../../splitter/TextDocumentSplitter";
import { TreeSitterDocumentSplitter } from "../../splitter/treesitter/TreeSitterDocumentSplitter";
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
 * Pipeline for processing source code content with syntax-aware and semantic splitting.
 * Uses TreeSitter parsers for supported languages (Python, etc.) to provide syntax-aware
 * hierarchical splitting. Falls back to TextDocumentSplitter for unsupported languages.
 * All splitting is followed by GreedySplitter for universal size optimization.
 */
export class SourceCodePipeline extends BasePipeline {
  private readonly middleware: ContentProcessorMiddleware[];
  private readonly treeSitterSplitter: TreeSitterDocumentSplitter;
  private readonly fallbackSplitter: GreedySplitter;

  constructor(chunkSize = SPLITTER_PREFERRED_CHUNK_SIZE) {
    super();
    // Source code processing uses minimal middleware since we preserve raw structure
    this.middleware = [];

    // Create TreeSitter splitter for syntax-aware splitting
    this.treeSitterSplitter = new TreeSitterDocumentSplitter({ 
      maxChunkSize: chunkSize,
      preserveStructure: true,
      includeDocumentation: true,
      includeModifiers: true,
    });

    // Create fallback splitter for unsupported languages: semantic + size optimization
    const textSplitter = new TextDocumentSplitter({ maxChunkSize: chunkSize });
    this.fallbackSplitter = new GreedySplitter(textSplitter, SPLITTER_MIN_CHUNK_SIZE, chunkSize);
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

    // Choose appropriate splitter based on TreeSitter support
    let chunks;
    if (rawContent.mimeType && this.treeSitterSplitter.canParseWithTreeSitter(rawContent.mimeType)) {
      // Use TreeSitter for syntax-aware splitting
      chunks = await this.treeSitterSplitter.splitText(context.content, rawContent.mimeType);
    } else {
      // Fall back to text-based splitting with size optimization
      chunks = await this.fallbackSplitter.splitText(context.content, rawContent.mimeType);
    }

    return {
      textContent: context.content,
      metadata: context.metadata,
      links: context.links,
      errors: context.errors,
      chunks,
    };
  }

  async close(): Promise<void> {}
}
