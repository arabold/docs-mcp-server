/**
 * DocumentPipeline - Processes binary document formats (PDF, Office docs, Jupyter notebooks)
 * using markitdown-ts to convert to Markdown, then splits semantically.
 *
 * Supported formats:
 * - PDF (.pdf)
 * - Word (.docx)
 * - Excel (.xlsx)
 * - PowerPoint (.pptx)
 * - Jupyter Notebook (.ipynb)
 *
 * The pipeline converts documents to Markdown using markitdown-ts, then applies
 * semantic splitting for optimal chunking. Documents exceeding the configured
 * maximum size are skipped with a warning.
 */

import { MarkItDown } from "markitdown-ts";
import mime from "mime";
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
  private readonly markitdown: MarkItDown;
  private readonly splitter: GreedySplitter;
  private readonly maxSize: number;

  constructor(config: AppConfig) {
    super();
    this.markitdown = new MarkItDown();
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

    // Extract file extension from MIME type or source URL/path
    const extension = this.extractExtension(rawContent.source, rawContent.mimeType);
    if (!extension) {
      logger.warn(
        `Could not determine file extension for ${rawContent.source} (MIME type: ${rawContent.mimeType})`,
      );
      return {
        title: null,
        contentType: rawContent.mimeType,
        textContent: null,
        links: [],
        errors: [new Error("Could not determine file extension for document")],
        chunks: [],
      };
    }

    try {
      const result = await this.markitdown.convertBuffer(buffer, {
        file_extension: `.${extension}`,
      });

      if (!result?.markdown) {
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

      // Use title from markitdown, fall back to filename
      const title = result.title || this.extractFilename(rawContent.source);

      // Post-process markdown to fix empty headers in Excel
      let markdown = result.markdown;
      if (extension === "xlsx") {
        markdown = this.promoteTableHeaders(markdown);
      }

      // Split the markdown content
      const chunks = await this.splitter.splitText(markdown, "text/markdown");

      return {
        title,
        contentType: "text/markdown", // Output is always markdown
        textContent: markdown,
        links: [], // Documents don't have extractable links
        errors: [],
        chunks,
      };
    } catch (error) {
      // Log a safe error message to avoid potential binary data in the logs
      // (markitdown-ts sometimes includes file content in error messages)
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
   * Extracts file extension, trying multiple strategies:
   * 1. Use MIME type from rawContent (most reliable, from Content-Type header)
   * 2. Parse extension from URL/path
   */
  private extractExtension(source: string, mimeType: string): string | null {
    // Strategy 1: Try to get extension from MIME type (Content-Type header)
    // This is the most reliable method as it comes directly from the server
    const extensionFromMime = this.getExtensionFromMimeType(mimeType);
    if (extensionFromMime) {
      return extensionFromMime;
    }

    // Strategy 2: Fall back to URL parsing
    try {
      const url = new URL(source);
      return this.getExtensionFromPath(url.pathname);
    } catch {
      // Not a URL, try as file path
      return this.getExtensionFromPath(source);
    }
  }

  /**
   * Gets file extension from MIME type using the mime package.
   */
  private getExtensionFromMimeType(mimeType: string): string | null {
    if (!mimeType || mimeType === "application/octet-stream") {
      return null;
    }

    return mime.getExtension(mimeType);
  }

  /**
   * Parses file extension from URL path or file path.
   * Strips query parameters and hash fragments, then extracts extension from the last path segment (filename).
   */
  private getExtensionFromPath(pathStr: string): string | null {
    // Remove query parameters and hash fragments
    const cleanPath = pathStr.split("?")[0].split("#")[0];

    // Extract the filename (last segment after final slash)
    const lastSlash = cleanPath.lastIndexOf("/");
    const filename = lastSlash >= 0 ? cleanPath.substring(lastSlash + 1) : cleanPath;

    // Find extension in filename
    const lastDot = filename.lastIndexOf(".");

    // Ensure dot is not the first char (hidden file) and exists
    if (lastDot > 0) {
      return filename.substring(lastDot + 1).toLowerCase();
    }

    return null;
  }

  /**
   * Post-processes Markdown to fix empty table headers generated by sheet-to-html conversions.
   * Detects tables where the header row is empty and promotes the first data row to be the header.
   */
  private promoteTableHeaders(markdown: string): string {
    // Pattern matches:
    // 1. Empty header row: | | |
    // 2. Separator row: |---|---|
    // 3. First data row: | Header | Header |
    const emptyHeaderPattern =
      /^\|(?:\s*\|)+\s*$\r?\n^(\|(?:\s*:?-+:?\s*\|)+)\s*$\r?\n^(\|.*\|)\s*$/gm;

    return markdown.replace(emptyHeaderPattern, "$2\n$1");
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
