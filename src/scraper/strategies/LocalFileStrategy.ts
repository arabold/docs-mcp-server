import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../../utils/config";
import { logger } from "../../utils/logger";
import { FileFetcher } from "../fetcher";
import { FetchStatus, type RawContent } from "../fetcher/types";
import { PipelineFactory } from "../pipelines/PipelineFactory";
import type { ContentPipeline, PipelineResult } from "../pipelines/types";
import type { QueueItem, ScraperOptions } from "../types";
import { BaseScraperStrategy, type ProcessItemResult } from "./BaseScraperStrategy";

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

  constructor(config: AppConfig) {
    super(config);
    this.pipelines = PipelineFactory.createStandardPipelines(config);
  }

  canHandle(url: string): boolean {
    return url.startsWith("file://");
  }

  async processItem(
    item: QueueItem,
    options: ScraperOptions,
    _signal?: AbortSignal,
  ): Promise<ProcessItemResult> {
    // Parse the file URL properly to handle both file:// and file:/// formats
    let filePath = item.url.replace(/^file:\/\/\/?/, "");
    filePath = decodeURIComponent(filePath);

    // Ensure absolute path on Unix-like systems (if not already absolute)
    if (!filePath.startsWith("/") && process.platform !== "win32") {
      filePath = `/${filePath}`;
    }

    let stats: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stats = await fs.stat(filePath);
    } catch (error) {
      // File not found
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        logger.info(`✓ File deleted or not available: ${filePath}`);
        return {
          url: item.url,
          links: [],
          status: FetchStatus.NOT_FOUND,
        };
      }
      throw error;
    }

    if (stats.isDirectory()) {
      const contents = await fs.readdir(filePath);
      // Only return links that pass shouldProcessUrl
      const links = contents
        .map((name) => {
          // Construct valid file URL using URL class to ensure proper encoding and structure
          const url = new URL(`file://${path.join(filePath, name)}`);
          // Ensure we always have file:/// format (empty host)
          if (url.hostname !== "") {
            url.pathname = `/${url.hostname}${url.pathname}`;
            url.hostname = "";
          }
          return url.href;
        })
        .filter((url) => {
          const allowed = this.shouldProcessUrl(url, options);
          if (!allowed) {
            logger.debug(`Skipping out-of-scope link: ${url}`);
          }
          return allowed;
        });

      logger.debug(
        `Found ${links.length} files in ${filePath} (from ${contents.length} entries)`,
      );
      return { url: item.url, links, status: FetchStatus.SUCCESS };
    }

    const rawContent: RawContent = await this.fileFetcher.fetch(item.url, {
      etag: item.etag,
    });

    // Handle NOT_MODIFIED status (file hasn't changed)
    if (rawContent.status === FetchStatus.NOT_MODIFIED) {
      logger.debug(`✓ File unchanged: ${filePath}`);
      return { url: rawContent.source, links: [], status: FetchStatus.NOT_MODIFIED };
    }

    let processed: PipelineResult | undefined;

    for (const pipeline of this.pipelines) {
      if (pipeline.canProcess(rawContent.mimeType, rawContent.content)) {
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
      return { url: rawContent.source, links: [], status: FetchStatus.SUCCESS };
    }

    for (const err of processed.errors ?? []) {
      logger.warn(`⚠️  Processing error for ${filePath}: ${err.message}`);
    }

    // Use filename as fallback if title is empty or not a string
    const filename = path.basename(filePath);
    const title = processed.title?.trim() || filename || null;

    // For local files, we don't follow links (no crawling within file content)
    // Return empty links array
    return {
      url: rawContent.source,
      title: title,
      etag: rawContent.etag,
      lastModified: rawContent.lastModified,
      contentType: rawContent.mimeType,
      content: processed,
      links: [],
      status: FetchStatus.SUCCESS,
    };
  }

  /**
   * Cleanup resources used by this strategy, specifically the pipeline browser instances.
   */
  async cleanup(): Promise<void> {
    await Promise.allSettled(this.pipelines.map((pipeline) => pipeline.close()));
  }
}
