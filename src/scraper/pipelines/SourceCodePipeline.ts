import { TreesitterSourceCodeSplitter } from "../../splitter/treesitter/TreesitterSourceCodeSplitter";
import type { DocumentSplitter } from "../../splitter/types";
import { SPLITTER_PREFERRED_CHUNK_SIZE } from "../../utils/config";
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import type { ContentFetcher, RawContent } from "../fetcher/types";
import type { ContentProcessorMiddleware, MiddlewareContext } from "../middleware/types";
import type { ScraperOptions } from "../types";
import { convertToString } from "../utils/buffer";
import { BasePipeline } from "./BasePipeline";
import type { PipelineResult } from "./types";

/**
 * Pipeline for processing source code content with semantic, structure-aware splitting.
 * Uses TreesitterSourceCodeSplitter for language-aware hierarchical chunking that preserves
 * {level, path} integrity for reassembly. No greedy size-based merging is applied because it
 * would blur structural boundaries and degrade hierarchical reconstruction quality.
 */
export class SourceCodePipeline extends BasePipeline {
  private readonly middleware: ContentProcessorMiddleware[];
  private readonly splitter: DocumentSplitter;

  constructor(chunkSize = SPLITTER_PREFERRED_CHUNK_SIZE) {
    super();
    // Source code processing uses minimal middleware since we preserve raw structure
    this.middleware = [];

    // Semantic, structure-preserving splitter only (no greedy size merging to keep hierarchy intact)
    this.splitter = new TreesitterSourceCodeSplitter({ maxChunkSize: chunkSize });
  }

  canProcess(mimeType: string): boolean {
    if (!mimeType) return false;
    return MimeTypeUtils.isSourceCode(mimeType);
  }

  async process(
    rawContent: RawContent,
    options: ScraperOptions,
    fetcher?: ContentFetcher,
  ): Promise<PipelineResult> {
    const contentString = convertToString(rawContent.content, rawContent.charset);

    const context: MiddlewareContext = {
      contentType: rawContent.mimeType || "text/plain",
      content: contentString,
      source: rawContent.source,
      // metadata: {
      //   language: rawContent.mimeType
      //     ? MimeTypeUtils.extractLanguageFromMimeType(rawContent.mimeType)
      //     : "text",
      //   isSourceCode: true,
      // },
      links: [], // Source code files typically don't contain web links
      errors: [],
      options,
      fetcher,
    };

    // Execute the middleware stack (minimal for source code)
    await this.executeMiddlewareStack(this.middleware, context);

    // Split the content using CodeContentSplitter
    const chunks = await this.splitter.splitText(context.content, rawContent.mimeType);

    return {
      title: context.title,
      contentType: context.contentType,
      textContent: context.content,
      // metadata: context.metadata,
      links: context.links,
      errors: context.errors,
      chunks,
    };
  }
}
