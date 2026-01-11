import fs from "node:fs/promises";
import path from "node:path";
import mime from "mime";
import { ArchiveFactory } from "../../utils/archive";
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

    let stats: Awaited<ReturnType<typeof fs.stat>> | null = null;
    let archivePath: string | null = null;
    let innerPath: string | null = null;

    try {
      stats = await fs.stat(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // File not found, check if it's a virtual path inside an archive
        const { archive, inner } = await this.resolveVirtualPath(filePath);
        if (archive && inner) {
          archivePath = archive;
          innerPath = inner;
        } else {
          logger.info(`✓ File deleted or not available: ${filePath}`);
          return {
            url: item.url,
            links: [],
            status: FetchStatus.NOT_FOUND,
          };
        }
      } else {
        throw error;
      }
    }

    // Handle physical directory
    if (stats && stats.isDirectory()) {
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

    // Check if the file itself is an archive (Root Archive)
    if (stats && stats.isFile()) {
      const adapter = await ArchiveFactory.getAdapter(filePath);
      if (adapter) {
        logger.info(`📦 Detected archive file: ${filePath}`);
        try {
          const links: string[] = [];
          for await (const entry of adapter.listEntries()) {
            // Create virtual URL: file:///path/to/archive.zip/entry/path
            // Ensure entry path doesn't start with / to avoid double slash issues
            const entryPath = entry.path.replace(/^\//, "");
            const virtualUrl = new URL(`file://${path.join(filePath, entryPath)}`);
            if (virtualUrl.hostname !== "") {
              virtualUrl.pathname = `/${virtualUrl.hostname}${virtualUrl.pathname}`;
              virtualUrl.hostname = "";
            }

            if (this.shouldProcessUrl(virtualUrl.href, options)) {
              links.push(virtualUrl.href);
            }
          }
          await adapter.close();
          logger.debug(`Found ${links.length} entries in archive ${filePath}`);
          return { url: item.url, links, status: FetchStatus.SUCCESS };
        } catch (err) {
          logger.error(`❌ Failed to list archive ${filePath}: ${err}`);
          await adapter.close();
          // Treat as binary file or fail?
          // If listing fails, maybe just fall through to standard processing (which will likely ignore it)
        }
      }
    }

    // Handle Virtual Archive Path (inner file)
    if (archivePath && innerPath) {
      return this.processArchiveEntry(item, archivePath, innerPath, options);
    }

    const rawContent: RawContent = await this.fileFetcher.fetch(item.url, {
      etag: item.etag,
    });

    // Handle NOT_MODIFIED status (file hasn't changed)
    if (rawContent.status === FetchStatus.NOT_MODIFIED) {
      logger.debug(`✓ File unchanged: ${filePath}`);
      return { url: rawContent.source, links: [], status: FetchStatus.NOT_MODIFIED };
    }

    return this.processContent(item.url, filePath, rawContent, options);
  }

  /**
   * Resolves a path that might be inside an archive.
   * Returns the archive path and the inner path if found.
   */
  private async resolveVirtualPath(
    fullPath: string,
  ): Promise<{ archive: string | null; inner: string | null }> {
    let currentPath = fullPath;
    while (currentPath !== "/" && currentPath !== ".") {
      const dirname = path.dirname(currentPath);
      if (dirname === currentPath) break; // Reached root

      try {
        const stats = await fs.stat(currentPath);
        if (stats.isFile()) {
          // Found a file part of the path. Check if it is an archive.
          const adapter = await ArchiveFactory.getAdapter(currentPath);
          if (adapter) {
            await adapter.close();
            const inner = fullPath.substring(currentPath.length).replace(/^\/+/, "");
            return { archive: currentPath, inner };
          }
        }
        // If it exists and is not an archive (or is a dir), then the path is just wrong/missing
        return { archive: null, inner: null };
      } catch (e) {
        // Path segment doesn't exist, go up
        currentPath = dirname;
      }
    }
    return { archive: null, inner: null };
  }

  private async processArchiveEntry(
    item: QueueItem,
    archivePath: string,
    innerPath: string,
    options: ScraperOptions,
  ): Promise<ProcessItemResult> {
    logger.debug(`Reading archive entry: ${innerPath} inside ${archivePath}`);
    const adapter = await ArchiveFactory.getAdapter(archivePath);
    if (!adapter) {
      throw new Error(`Failed to open archive: ${archivePath}`);
    }

    try {
      const contentBuffer = await adapter.getContent(innerPath);
      // Detect mime type based on inner filename
      const mimeType = mime.getType(innerPath) || "application/octet-stream";

      const rawContent: RawContent = {
        source: item.url,
        content: contentBuffer,
        mimeType,
        status: FetchStatus.SUCCESS,
        lastModified: new Date().toISOString(), // Archive entries don't easily give mod time in generic way, defaulting
        etag: undefined, // Could hash content?
      };

      return this.processContent(
        item.url,
        `${archivePath}/${innerPath}`,
        rawContent,
        options,
      );
    } catch (err) {
      logger.warn(`⚠️  Failed to read archive entry ${innerPath}: ${err}`);
      return {
        url: item.url,
        links: [],
        status: FetchStatus.NOT_FOUND,
      };
    } finally {
      await adapter.close();
    }
  }

  private async processContent(
    url: string,
    displayPath: string,
    rawContent: RawContent,
    options: ScraperOptions,
  ): Promise<ProcessItemResult> {
    let processed: PipelineResult | undefined;

    for (const pipeline of this.pipelines) {
      if (pipeline.canProcess(rawContent.mimeType, rawContent.content)) {
        logger.debug(
          `Selected ${pipeline.constructor.name} for content type "${rawContent.mimeType}" (${displayPath})`,
        );
        processed = await pipeline.process(rawContent, options, this.fileFetcher);
        break;
      }
    }

    if (!processed) {
      logger.warn(
        `⚠️  Unsupported content type "${rawContent.mimeType}" for file ${displayPath}. Skipping processing.`,
      );
      return { url: rawContent.source, links: [], status: FetchStatus.SUCCESS };
    }

    for (const err of processed.errors ?? []) {
      logger.warn(`⚠️  Processing error for ${displayPath}: ${err.message}`);
    }

    // Use filename as fallback if title is empty or not a string
    const filename = path.basename(displayPath);
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
