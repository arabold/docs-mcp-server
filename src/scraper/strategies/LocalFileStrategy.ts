import fs from "node:fs/promises";
import path from "node:path";
import type { Document, ProgressCallback } from "../../types";
import { logger } from "../../utils/logger";
import { FileFetcher } from "../fetcher";
import type { RawContent } from "../fetcher/types";
import { ContentProcessingPipeline } from "../middleware/ContentProcessorPipeline";
// Import new and updated middleware from index
import {
  HtmlDomParserMiddleware,
  HtmlMetadataExtractorMiddleware,
  HtmlSanitizerMiddleware,
  HtmlToMarkdownMiddleware,
  MarkdownMetadataExtractorMiddleware,
} from "../middleware/components";
// Note: Link extractors are not used for local file content
import type { ContentProcessingContext } from "../middleware/types";
import type { ScraperOptions, ScraperProgress } from "../types";
import { BaseScraperStrategy, type QueueItem } from "./BaseScraperStrategy";

export class LocalFileStrategy extends BaseScraperStrategy {
  private readonly fileFetcher = new FileFetcher();

  canHandle(url: string): boolean {
    return url.startsWith("file://");
  }

  protected async processItem(
    item: QueueItem,
    options: ScraperOptions,
    _progressCallback?: ProgressCallback<ScraperProgress>, // Add unused param to match base
    _signal?: AbortSignal, // Add unused signal to match base
  ): Promise<{ document?: Document; links?: string[] }> {
    // Note: Cancellation signal is not actively checked here as file operations are typically fast.
    const filePath = item.url.replace(/^file:\/\//, "");
    const stats = await fs.stat(filePath);

    // If this is a directory, return contained files and subdirectories as new paths
    if (stats.isDirectory()) {
      const contents = await fs.readdir(filePath);
      return {
        links: contents.map((name) => `file://${path.join(filePath, name)}`),
      };
    }

    // Process the file
    logger.info(`📄 Processing file ${this.pageCount}/${options.maxPages}: ${filePath}`);

    const rawContent: RawContent = await this.fileFetcher.fetch(item.url);

    // --- Start Middleware Pipeline ---
    const initialContext: ContentProcessingContext = {
      content: rawContent.content,
      contentType: rawContent.mimeType,
      source: rawContent.source, // file:// URL
      metadata: {},
      links: [], // LocalFileStrategy doesn't extract links from file content itself
      errors: [],
      options: options, // Pass the full options object
    };

    let pipeline: ContentProcessingPipeline;
    if (initialContext.contentType.startsWith("text/html")) {
      // Updated HTML pipeline for local files (no link extraction from content)
      pipeline = new ContentProcessingPipeline([
        new HtmlDomParserMiddleware(),
        new HtmlMetadataExtractorMiddleware(),
        // No HtmlLinkExtractorMiddleware needed for local files
        new HtmlSanitizerMiddleware(),
        new HtmlToMarkdownMiddleware(),
      ]);
    } else if (
      initialContext.contentType === "text/markdown" ||
      initialContext.contentType === "text/plain" || // Treat plain text as markdown
      initialContext.contentType.startsWith("text/") // Added for compatibility
    ) {
      // Markdown pipeline remains simple
      pipeline = new ContentProcessingPipeline([
        new MarkdownMetadataExtractorMiddleware(),
        // No MarkdownLinkExtractorMiddleware needed for local files
      ]);
    } else {
      logger.warn(
        `Unsupported content type "${initialContext.contentType}" for file ${filePath}. Skipping processing.`,
      );
      return { document: undefined, links: [] }; // Return empty
    }

    const finalContext = await pipeline.run(initialContext);
    // --- End Middleware Pipeline ---

    // Log errors from pipeline
    for (const err of finalContext.errors) {
      logger.warn(`Processing error for ${filePath}: ${err.message}`);
    }

    // If pipeline ran successfully, always create a document, even if content is empty/whitespace.
    // Downstream consumers (e.g., indexing) can filter if needed.
    // Ensure content is a string before creating the document.
    const finalContentString =
      typeof finalContext.content === "string"
        ? finalContext.content
        : Buffer.from(finalContext.content).toString("utf-8");

    return {
      document: {
        // Use the potentially empty string content
        content: finalContentString,
        metadata: {
          url: finalContext.source, // Use context source (file:// URL)
          // Ensure title is a string, default to "Untitled"
          title:
            typeof finalContext.metadata.title === "string"
              ? finalContext.metadata.title
              : "Untitled",
          library: options.library,
          version: options.version,
        },
      } satisfies Document,
      // No links returned from file content processing
    };
  }

  async scrape(
    options: ScraperOptions,
    progressCallback: ProgressCallback<ScraperProgress>,
    signal?: AbortSignal,
  ): Promise<void> {
    // Pass signal down to base class scrape method
    await super.scrape(options, progressCallback, signal); // Pass the received signal
  }
}
