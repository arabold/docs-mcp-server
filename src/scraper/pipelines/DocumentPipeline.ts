/**
 * DocumentPipeline - Processes binary document formats using Kreuzberg for text extraction,
 * then splits semantically.
 *
 * Supported formats:
 * - PDF (.pdf)
 * - Modern Office: Word (.docx), Excel (.xlsx), PowerPoint (.pptx)
 * - Legacy Office: Word (.doc), Excel (.xls), PowerPoint (.ppt)
 * - OpenDocument: Text (.odt), Spreadsheet (.ods), Presentation (.odp)
 * - Rich Text Format (.rtf)
 * - eBooks: EPUB (.epub), FictionBook (.fb2)
 * - Jupyter Notebook (.ipynb)
 *
 * The pipeline requests Markdown output from Kreuzberg (`@kreuzberg/node`) via
 * `outputFormat: "markdown"`, aligning with the project's Markdown-first processing
 * pipeline. For spreadsheet-type documents where `result.content` is flat text,
 * the pipeline prefers pre-rendered Markdown from `tables[].markdown` which includes
 * sheet names as headings and properly formatted Markdown tables.
 *
 * Documents exceeding the configured maximum size are skipped with a warning.
 */

import { extractBytes } from "@kreuzberg/node";
import { GreedySplitter } from "../../splitter/GreedySplitter";
import { SemanticMarkdownSplitter } from "../../splitter/SemanticMarkdownSplitter";
import type { AppConfig } from "../../utils/config";
import { logger } from "../../utils/logger";
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import type { RawContent } from "../fetcher/types";
import type { ScraperOptions } from "../types";
import { BasePipeline } from "./BasePipeline";
import type { PipelineResult } from "./types";

export class DocumentPipeline extends BasePipeline {
  private readonly splitter: GreedySplitter;
  private readonly maxSize: number;

  constructor(config: AppConfig) {
    super();
    this.maxSize = config.scraper.document.maxSize;

    const semanticSplitter = new SemanticMarkdownSplitter(
      config.splitter.preferredChunkSize,
      config.splitter.maxChunkSize,
    );
    this.splitter = new GreedySplitter(
      semanticSplitter,
      config.splitter.minChunkSize,
      config.splitter.preferredChunkSize,
      config.splitter.maxChunkSize,
    );
  }

  canProcess(mimeType: string): boolean {
    return MimeTypeUtils.isSupportedDocument(mimeType);
  }

  async process(
    rawContent: RawContent,
    _options: ScraperOptions,
  ): Promise<PipelineResult> {
    const buffer = Buffer.isBuffer(rawContent.content)
      ? rawContent.content
      : Buffer.from(rawContent.content);

    // Check size limit
    if (buffer.length > this.maxSize) {
      logger.warn(
        `Document exceeds size limit (${buffer.length} > ${this.maxSize}): ${rawContent.source}`,
      );
      return {
        title: null,
        contentType: rawContent.mimeType,
        textContent: null,
        links: [],
        errors: [new Error(`Document exceeds maximum size of ${this.maxSize} bytes`)],
        chunks: [],
      };
    }

    // Resolve the actual MIME type when the server sends a generic type.
    // This is common with S3, CDNs, and other file storage services that
    // serve documents as application/octet-stream.
    const mimeType = this.resolveMimeType(rawContent.mimeType, rawContent.source);
    if (!mimeType) {
      logger.warn(
        `Could not determine document type for ${rawContent.source} (MIME type: ${rawContent.mimeType})`,
      );
      return {
        title: null,
        contentType: rawContent.mimeType,
        textContent: null,
        links: [],
        errors: [new Error("Could not determine document type")],
        chunks: [],
      };
    }

    try {
      const result = await extractBytes(buffer, mimeType, {
        outputFormat: "markdown",
      });

      const content = this.extractContent(result, mimeType);

      if (!content) {
        logger.warn(`No content extracted from document: ${rawContent.source}`);
        return {
          title: null,
          contentType: rawContent.mimeType,
          textContent: null,
          links: [],
          errors: [],
          chunks: [],
        };
      }

      // Use title from Kreuzberg metadata, fall back to filename
      const title = result.metadata?.title || this.extractFilename(rawContent.source);

      // Split the content (Kreuzberg output is Markdown)
      const chunks = await this.splitter.splitText(content, "text/markdown");

      return {
        title,
        contentType: "text/markdown", // Output is always markdown
        textContent: content,
        links: [], // Documents don't have extractable links
        errors: [],
        chunks,
      };
    } catch (error) {
      // Log a safe error message to avoid potential binary data in the logs
      const errorName = error instanceof Error ? error.name : "UnknownError";
      const safeMessage = `Failed to convert document: ${errorName}`;

      logger.warn(`${safeMessage} for ${rawContent.source}`);

      return {
        title: null,
        contentType: rawContent.mimeType,
        textContent: null,
        links: [],
        errors: [new Error(safeMessage)],
        chunks: [],
      };
    }
  }

  /**
   * Selects the best content representation from a Kreuzberg extraction result.
   * For spreadsheet-type documents, prefer pre-rendered Markdown from `tables[].markdown`.
   * For other documents, prefer `result.content` and only fall back to tables when needed.
   */
  private extractContent(
    result: Awaited<ReturnType<typeof extractBytes>>,
    mimeType: string,
  ): string | null {
    const tableContent = result.tables.map((t) => t.markdown).join("\n\n");
    const hasTableContent = tableContent.trim().length > 0;
    const content = result.content ?? "";
    const hasContent = content.trim().length > 0;

    if (this.isSpreadsheetMimeType(mimeType)) {
      if (hasTableContent) {
        return tableContent;
      }
      return hasContent ? content : null;
    }

    if (hasContent) {
      return content;
    }

    if (hasTableContent) {
      return tableContent;
    }

    return null;
  }

  private isSpreadsheetMimeType(mimeType: string): boolean {
    return (
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimeType === "application/vnd.ms-excel" ||
      mimeType === "application/vnd.oasis.opendocument.spreadsheet"
    );
  }

  /**
   * Resolves the effective MIME type for document processing.
   * When the provided MIME type is generic (`application/octet-stream`), attempts to
   * detect the actual type from the source URL's file extension. Returns `null` if
   * the resolved type is not a supported document format.
   */
  private resolveMimeType(mimeType: string, source: string): string | null {
    if (mimeType !== "application/octet-stream") {
      return mimeType;
    }

    // detectMimeTypeFromPath handles query params and hash fragments internally
    const detected = MimeTypeUtils.detectMimeTypeFromPath(source);
    if (detected && MimeTypeUtils.isSupportedDocument(detected)) {
      return detected;
    }

    return null;
  }

  private extractFilename(source: string): string | null {
    try {
      const url = new URL(source);
      const pathname = url.pathname;
      const lastSlash = pathname.lastIndexOf("/");
      return pathname.substring(lastSlash + 1) || null;
    } catch {
      const lastSlash = source.lastIndexOf("/");
      return source.substring(lastSlash + 1) || null;
    }
  }
}
