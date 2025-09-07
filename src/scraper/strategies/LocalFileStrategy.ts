import fs from "node:fs/promises";
import path from "node:path";
import type { Document, ProgressCallback } from "../../types";
import { logger } from "../../utils/logger";
import { FileFetcher } from "../fetcher";
import type { RawContent } from "../fetcher/types";
import { PipelineFactory } from "../pipelines/PipelineFactory";
import type { ContentPipeline } from "../pipelines/types";
import type { ScraperOptions, ScraperProgress } from "../types";
import { BaseScraperStrategy, type QueueItem } from "./BaseScraperStrategy";

/**
 * LocalFileStrategy handles crawling and scraping of local files and folders using file:// URLs.
 *
 * All files with a MIME type of `text/*` are processed. This includes HTML, Markdown, plain text, and source code files such as `.js`, `.ts`, `.tsx`, `.css`, etc. Binary files, PDFs, images, and other non-text formats are ignored.
 *
 * Supports include/exclude filters and percent-encoded paths.
 */
export class LocalFileStrategy extends BaseScraperStrategy {
  private readonly fileFetcher = new FileFetcher();
  private readonly pipelines: ContentPipeline[];

  constructor() {
    super();
    this.pipelines = PipelineFactory.createStandardPipelines();
  }

  canHandle(url: string): boolean {
    return url.startsWith("file://");
  }

  protected async processItem(
    item: QueueItem,
    options: ScraperOptions,
    _progressCallback?: ProgressCallback<ScraperProgress>,
    _signal?: AbortSignal,
  ): Promise<{ document?: Document; links?: string[] }> {
    // Parse the file URL properly to handle both file:// and file:/// formats
    let filePath = item.url.replace(/^file:\/\/\/?/, "");
    filePath = decodeURIComponent(filePath);

    // Ensure absolute path on Unix-like systems (if not already absolute)
    if (!filePath.startsWith("/") && process.platform !== "win32") {
      filePath = `/${filePath}`;
    }

    const stats = await fs.stat(filePath);

    if (stats.isDirectory()) {
      const contents = await fs.readdir(filePath);
      // Only return links that pass shouldProcessUrl
      const links = contents
        .map((name) => `file://${path.join(filePath, name)}`)
        .filter((url) => this.shouldProcessUrl(url, options));
      return { links };
    }

    logger.info(`🗂️  Processing file ${this.pageCount}/${options.maxPages}: ${filePath}`);

    const rawContent: RawContent = await this.fileFetcher.fetch(item.url);

    let processed: Awaited<ReturnType<ContentPipeline["process"]>> | undefined;

    for (const pipeline of this.pipelines) {
      if (pipeline.canProcess(rawContent)) {
        logger.debug(
          `Selected ${pipeline.constructor.name} for content type "${rawContent.mimeType}" (${filePath})`,
        );
        processed = await pipeline.process(rawContent, options, this.fileFetcher);
        break;
      }
    }

    if (!processed) {
      logger.warn(
        `⚠️  Unsupported content type "${rawContent.mimeType}" for file ${filePath}. Skipping processing.`,
      );
      return { document: undefined, links: [] };
    }

    for (const err of processed.errors) {
      logger.warn(`⚠️  Processing error for ${filePath}: ${err.message}`);
    }

    return {
      document: {
        content: typeof processed.textContent === "string" ? processed.textContent : "",
        contentType: rawContent.mimeType,
        metadata: {
          url: rawContent.source,
          title:
            typeof processed.metadata.title === "string"
              ? processed.metadata.title
              : "Untitled",
          library: options.library,
          version: options.version,
        },
      } satisfies Document,
    };
  }
}
