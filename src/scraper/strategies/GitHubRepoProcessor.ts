import type { AppConfig } from "../../utils/config";
import { logger } from "../../utils/logger";
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import { HttpFetcher } from "../fetcher";
import { FetchStatus, type RawContent } from "../fetcher/types";
import { PipelineFactory } from "../pipelines/PipelineFactory";
import type { ContentPipeline, PipelineResult } from "../pipelines/types";
import type { QueueItem } from "../types";
import { ScrapeMode, type ScraperOptions } from "../types";
import type { ProcessItemResult } from "./BaseScraperStrategy";

export interface GitHubRepoInfo {
  owner: string;
  repo: string;
  branch?: string;
  subPath?: string;
}

export interface GitHubTreeItem {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
}

export interface GitHubTreeResponse {
  sha: string;
  url: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

/**
 * GitHubRepoProcessor handles processing individual files from GitHub repositories.
 * It processes HTTPS blob URLs (https://github.com/owner/repo/blob/branch/filepath).
 *
 * This processor is stateless and contains the core logic from GitHubRepoScraperStrategy.
 */
export class GitHubRepoProcessor {
  private readonly httpFetcher: HttpFetcher;
  private readonly pipelines: ContentPipeline[];

  constructor(config: AppConfig) {
    this.httpFetcher = new HttpFetcher(config.scraper);
    this.pipelines = PipelineFactory.createStandardPipelines(config);
  }

  /**
   * Parses an HTTPS blob URL to extract repository information.
   * Format: https://github.com/owner/repo/blob/branch/filepath
   */
  parseHttpsBlobUrl(url: string): GitHubRepoInfo & { filePath: string } {
    const parsedUrl = new URL(url);
    const segments = parsedUrl.pathname.split("/").filter(Boolean);

    // Expected format: /owner/repo/blob/branch/filepath
    if (segments.length < 5 || segments[2] !== "blob") {
      throw new Error(
        `Invalid GitHub blob URL format. Expected: https://github.com/owner/repo/blob/branch/filepath. Got: ${url}`,
      );
    }

    const owner = segments[0];
    const repo = segments[1];
    const branch = segments[3];
    const filePath = segments.slice(4).join("/");

    return { owner, repo, branch, filePath };
  }

  /**
   * Fetches the raw content of a file from GitHub.
   */
  private async fetchFileContent(
    repoInfo: GitHubRepoInfo,
    filePath: string,
    etag?: string | null,
    headers?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<RawContent> {
    const { owner, repo, branch } = repoInfo;
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;

    const rawContent = await this.httpFetcher.fetch(rawUrl, { signal, etag, headers });

    // Override GitHub's generic 'text/plain' or 'application/octet-stream' MIME type with file extension-based detection
    const detectedMimeType = MimeTypeUtils.detectMimeTypeFromPath(filePath);
    if (
      detectedMimeType &&
      (rawContent.mimeType === "text/plain" ||
        rawContent.mimeType === "application/octet-stream")
    ) {
      return {
        ...rawContent,
        mimeType: detectedMimeType,
      };
    }

    return rawContent;
  }

  /**
   * Processes a single GitHub repository file from an HTTPS blob URL.
   */
  async process(
    item: QueueItem,
    options: ScraperOptions,
    headers?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<ProcessItemResult> {
    // Parse the HTTPS blob URL to extract repository info and file path
    const repoInfo = this.parseHttpsBlobUrl(item.url);
    const { owner, repo, branch, filePath } = repoInfo;

    // Fetch the file content from raw.githubusercontent.com
    const rawContent = await this.fetchFileContent(
      { owner, repo, branch },
      filePath,
      item.etag,
      headers,
      signal,
    );

    // Return the status directly - BaseScraperStrategy handles NOT_MODIFIED and NOT_FOUND
    if (rawContent.status !== FetchStatus.SUCCESS) {
      return { url: item.url, links: [], status: rawContent.status };
    }

    // Process content through appropriate pipeline
    let processed: PipelineResult | undefined;

    for (const pipeline of this.pipelines) {
      const contentBuffer = Buffer.isBuffer(rawContent.content)
        ? rawContent.content
        : Buffer.from(rawContent.content);
      if (pipeline.canProcess(rawContent.mimeType || "text/plain", contentBuffer)) {
        logger.debug(
          `Selected ${pipeline.constructor.name} for content type "${rawContent.mimeType}" (${filePath})`,
        );

        // Force 'fetch' mode for GitHub to avoid unnecessary Playwright usage on raw content.
        // GitHub raw files (e.g., HTML files) don't have their dependencies available at the
        // raw.githubusercontent.com domain, so rendering them in a browser would be broken
        // and provide no additional value over direct HTML parsing with Cheerio.
        const gitHubOptions = { ...options, scrapeMode: ScrapeMode.Fetch };

        processed = await pipeline.process(rawContent, gitHubOptions, this.httpFetcher);
        break;
      }
    }

    if (!processed) {
      logger.warn(
        `⚠️  Unsupported content type "${rawContent.mimeType}" for file ${filePath}. Skipping processing.`,
      );
      return { url: item.url, links: [], status: FetchStatus.SUCCESS };
    }

    for (const err of processed.errors ?? []) {
      logger.warn(`⚠️  Processing error for ${filePath}: ${err.message}`);
    }

    // Create document with GitHub-specific metadata
    const githubUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`;

    // Use filename as fallback if title is empty or not a string
    const filename = filePath.split("/").pop() || "Untitled";

    return {
      url: githubUrl,
      title: processed.title?.trim() || filename || "Untitled",
      etag: rawContent.etag,
      lastModified: rawContent.lastModified,
      contentType: rawContent.mimeType,
      content: processed,
      links: [], // Always return empty links array for individual files
      status: FetchStatus.SUCCESS,
    };
  }

  /**
   * Cleanup resources used by this processor.
   */
  async cleanup(): Promise<void> {
    await Promise.allSettled(this.pipelines.map((pipeline) => pipeline.close()));
  }
}
