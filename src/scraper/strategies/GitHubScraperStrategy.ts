import type { Document, ProgressCallback } from "../../types";
import { logger } from "../../utils/logger";
import { HttpFetcher } from "../fetcher";
import type { RawContent } from "../fetcher/types";
import { HtmlPipeline } from "../pipelines/HtmlPipeline";
import { MarkdownPipeline } from "../pipelines/MarkdownPipeline";
import type { ScraperOptions, ScraperProgress } from "../types";
import { BaseScraperStrategy, type QueueItem } from "./BaseScraperStrategy";

interface GitHubRepoInfo {
  owner: string;
  repo: string;
  branch?: string;
}

interface GitHubTreeItem {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
}

interface GitHubTreeResponse {
  sha: string;
  url: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

/**
 * GitHubScraperStrategy handles native repository crawling by accessing GitHub's tree API
 * to discover repository structure and fetching raw file contents. This treats repositories
 * more like file systems rather than web pages.
 *
 * Features:
 * - Uses GitHub tree API for efficient repository structure discovery
 * - Fetches raw file contents from raw.githubusercontent.com
 * - Processes all text files (source code, markdown, documentation, etc.)
 * - Supports branch-specific crawling (defaults to main/default branch)
 * - Automatically detects repository default branch when no branch specified
 * - Filters out binary files and processes only text-based content
 *
 * Note: Wiki pages are not currently supported in this native mode. For wiki access,
 * consider using the web scraping approach or a separate scraping job.
 */
export class GitHubScraperStrategy extends BaseScraperStrategy {
  private readonly httpFetcher = new HttpFetcher();
  private readonly htmlPipeline: HtmlPipeline;
  private readonly markdownPipeline: MarkdownPipeline;
  private readonly pipelines: [HtmlPipeline, MarkdownPipeline];
  private resolvedBranch?: string; // Cache the resolved default branch

  constructor() {
    super();
    this.htmlPipeline = new HtmlPipeline();
    this.markdownPipeline = new MarkdownPipeline();
    this.pipelines = [this.htmlPipeline, this.markdownPipeline];
  }

  canHandle(url: string): boolean {
    const { hostname } = new URL(url);
    return ["github.com", "www.github.com"].includes(hostname);
  }

  /**
   * Parses a GitHub URL to extract repository information.
   */
  parseGitHubUrl(url: string): GitHubRepoInfo {
    const parsedUrl = new URL(url);
    // Extract /<org>/<repo> from github.com/<org>/<repo>/...
    const match = parsedUrl.pathname.match(/^\/([^/]+)\/([^/]+)/);
    if (!match) {
      throw new Error(`Invalid GitHub repository URL: ${url}`);
    }

    const [, owner, repo] = match;

    // Extract branch from URL if present (e.g., /tree/branch-name/)
    const branchMatch = parsedUrl.pathname.match(/\/tree\/([^/]+)/);
    const branch = branchMatch?.[1];

    return { owner, repo, branch };
  }

  /**
   * Fetches the repository tree structure from GitHub API.
   * Uses 'HEAD' to get the default branch if no branch is specified.
   */
  async fetchRepositoryTree(
    repoInfo: GitHubRepoInfo,
    signal?: AbortSignal,
  ): Promise<{ tree: GitHubTreeResponse; resolvedBranch: string }> {
    const { owner, repo, branch } = repoInfo;

    // If no branch specified, fetch the default branch first
    let targetBranch = branch;
    if (!targetBranch) {
      try {
        // Get repository information to find the default branch
        const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
        logger.debug(`🔍 Fetching repository info: ${repoUrl}`);

        const repoContent = await this.httpFetcher.fetch(repoUrl, { signal });
        const repoData = JSON.parse(repoContent.content) as { default_branch: string };
        targetBranch = repoData.default_branch;

        logger.debug(`📋 Using default branch: ${targetBranch}`);
      } catch (error) {
        logger.warn(`⚠️  Could not fetch default branch, using 'main': ${error}`);
        targetBranch = "main";
      }
    }

    // Cache the resolved branch for file fetching
    this.resolvedBranch = targetBranch;

    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${targetBranch}?recursive=1`;

    logger.debug(`🌳 Fetching repository tree: ${treeUrl}`);

    const rawContent = await this.httpFetcher.fetch(treeUrl, { signal });
    const treeData = JSON.parse(rawContent.content) as GitHubTreeResponse;

    if (treeData.truncated) {
      logger.warn(
        `⚠️  Repository tree was truncated for ${owner}/${repo}. Some files may be missing.`,
      );
    }

    return { tree: treeData, resolvedBranch: targetBranch };
  }

  /**
   * Determines if a file should be processed based on its path and type.
   */
  private shouldProcessFile(item: GitHubTreeItem, options: ScraperOptions): boolean {
    // Only process blob (file) items, not trees (directories)
    if (item.type !== "blob") {
      return false;
    }

    const path = item.path;

    // Skip common binary and non-text files
    const binaryExtensions = [
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".svg",
      ".ico",
      ".webp",
      ".pdf",
      ".zip",
      ".tar",
      ".gz",
      ".bz2",
      ".xz",
      ".exe",
      ".dll",
      ".so",
      ".dylib",
      ".bin",
      ".dat",
      ".db",
      ".sqlite",
      ".woff",
      ".woff2",
      ".ttf",
      ".eot",
      ".mp3",
      ".mp4",
      ".avi",
      ".mov",
      ".wmv",
      ".jar",
      ".war",
      ".ear",
      ".class",
    ];

    const hasKnownBinaryExtension = binaryExtensions.some((ext) =>
      path.toLowerCase().endsWith(ext),
    );

    if (hasKnownBinaryExtension) {
      return false;
    }

    // Apply user-defined include/exclude patterns
    return this.shouldProcessUrl(`file://${path}`, options);
  }

  /**
   * Fetches the raw content of a file from GitHub.
   */
  async fetchFileContent(
    repoInfo: GitHubRepoInfo,
    filePath: string,
    signal?: AbortSignal,
  ): Promise<RawContent> {
    const { owner, repo } = repoInfo;
    // Use resolved branch if available, otherwise use provided branch or default to main
    const branch = this.resolvedBranch || repoInfo.branch || "main";
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;

    return await this.httpFetcher.fetch(rawUrl, { signal });
  }

  protected async processItem(
    item: QueueItem,
    options: ScraperOptions,
    _progressCallback?: ProgressCallback<ScraperProgress>,
    signal?: AbortSignal,
  ): Promise<{ document?: Document; links?: string[] }> {
    // Parse the URL to get repository information
    const repoInfo = this.parseGitHubUrl(options.url);

    // For the initial item, fetch the repository tree
    if (item.depth === 0) {
      logger.info(
        `🗂️  Discovering repository structure for ${repoInfo.owner}/${repoInfo.repo}`,
      );

      const { tree, resolvedBranch } = await this.fetchRepositoryTree(repoInfo, signal);
      const fileItems = tree.tree.filter((treeItem) =>
        this.shouldProcessFile(treeItem, options),
      );

      logger.info(
        `📁 Found ${fileItems.length} processable files in repository (branch: ${resolvedBranch})`,
      );

      // Convert tree items to URLs for the queue
      const links = fileItems.map((treeItem) => `github-file://${treeItem.path}`);

      return { links };
    }

    // Process individual files
    if (item.url.startsWith("github-file://")) {
      const filePath = item.url.replace("github-file://", "");

      logger.info(
        `🗂️  Processing file ${this.pageCount}/${options.maxPages}: ${filePath}`,
      );

      const rawContent = await this.fetchFileContent(repoInfo, filePath, signal);

      // Process content through appropriate pipeline
      let processed: Awaited<ReturnType<HtmlPipeline["process"]>> | undefined;

      for (const pipeline of this.pipelines) {
        if (pipeline.canProcess(rawContent)) {
          processed = await pipeline.process(rawContent, options, this.httpFetcher);
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

      // Create document with GitHub-specific metadata
      const githubUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/blob/${this.resolvedBranch || repoInfo.branch || "main"}/${filePath}`;

      return {
        document: {
          content: typeof processed.textContent === "string" ? processed.textContent : "",
          metadata: {
            url: githubUrl,
            title:
              typeof processed.metadata.title === "string"
                ? processed.metadata.title
                : filePath.split("/").pop() || "Untitled",
            library: options.library,
            version: options.version,
            filePath,
            repository: `${repoInfo.owner}/${repoInfo.repo}`,
            branch: this.resolvedBranch || repoInfo.branch || "main",
          },
        } satisfies Document,
      };
    }

    return { document: undefined, links: [] };
  }

  async scrape(
    options: ScraperOptions,
    progressCallback: ProgressCallback<ScraperProgress>,
    signal?: AbortSignal,
  ): Promise<void> {
    // Validate it's a GitHub URL
    const url = new URL(options.url);
    if (!url.hostname.includes("github.com")) {
      throw new Error("URL must be a GitHub URL");
    }

    try {
      await super.scrape(options, progressCallback, signal);
    } finally {
      await this.htmlPipeline.close();
      await this.markdownPipeline.close();
    }
  }
}
