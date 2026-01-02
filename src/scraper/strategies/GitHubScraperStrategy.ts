import mime from "mime";
import type { ProgressCallback } from "../../types";
import type { AppConfig } from "../../utils/config";
import { logger } from "../../utils/logger";
import { HttpFetcher } from "../fetcher";
import { FetchStatus } from "../fetcher/types";
import type { QueueItem, ScraperOptions, ScraperProgressEvent } from "../types";
import { shouldIncludeUrl } from "../utils/patternMatcher";
import { BaseScraperStrategy, type ProcessItemResult } from "./BaseScraperStrategy";
import type {
  GitHubRepoInfo,
  GitHubTreeItem,
  GitHubTreeResponse,
} from "./GitHubRepoProcessor";
import { GitHubRepoProcessor } from "./GitHubRepoProcessor";
import { GitHubWikiProcessor } from "./GitHubWikiProcessor";

/**
 * GitHubScraperStrategy is a discovery strategy that orchestrates the scraping of both
 * GitHub repository code and wiki pages. When given a GitHub repository URL, it will:
 *
 * 1. Attempt to scrape the repository's wiki pages using GitHubWikiProcessor (prioritized)
 * 2. Discover all repository files using the GitHub Tree API
 * 3. Create HTTPS blob URLs for each file, which are stored in the database
 * 4. Process blob URLs directly with GitHubRepoProcessor
 *
 * This provides comprehensive documentation coverage by including both wiki documentation
 * and source code in a single scraping job, with wikis prioritized as they typically
 * contain higher-quality curated documentation.
 *
 * Features:
 * - Handles base GitHub repository URLs (e.g., https://github.com/owner/repo)
 * - Handles branch-specific URLs (e.g., https://github.com/owner/repo/tree/branch)
 * - Handles single file URLs (e.g., https://github.com/owner/repo/blob/branch/path)
 * - Discovers all files efficiently using GitHub's Tree API
 * - Generates and processes user-friendly HTTPS blob URLs throughout
 * - Prioritizes wiki content over repository files for better documentation quality
 * - Respects maxPages limit across both scraping phases to prevent exceeding quotas
 * - Automatically discovers and scrapes both wiki and code content
 * - Graceful handling when wikis don't exist or are inaccessible
 */
export class GitHubScraperStrategy extends BaseScraperStrategy {
  private readonly httpFetcher: HttpFetcher;
  private readonly wikiProcessor: GitHubWikiProcessor;
  private readonly repoProcessor: GitHubRepoProcessor;

  constructor(config: AppConfig) {
    super(config);
    this.httpFetcher = new HttpFetcher(config.scraper);
    this.wikiProcessor = new GitHubWikiProcessor(config);
    this.repoProcessor = new GitHubRepoProcessor(config);
  }

  canHandle(url: string): boolean {
    // Handle legacy github-file:// protocol URLs (no longer supported)
    // These will be processed and marked as NOT_FOUND to trigger cleanup
    if (url.startsWith("github-file://")) {
      return true;
    }

    try {
      const parsedUrl = new URL(url);
      const { hostname, pathname } = parsedUrl;

      // Handle GitHub repository URLs
      if (!["github.com", "www.github.com"].includes(hostname)) {
        return false;
      }

      // Handle base repository URLs (owner/repo)
      const baseMatch = pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
      if (baseMatch) {
        return true;
      }

      // Handle tree URLs (owner/repo/tree/branch/...)
      const treeMatch = pathname.match(/^\/([^/]+)\/([^/]+)\/tree\//);
      if (treeMatch) {
        return true;
      }

      // Handle blob URLs (owner/repo/blob/branch/...)
      const blobMatch = pathname.match(/^\/([^/]+)\/([^/]+)\/blob\//);
      if (blobMatch) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Parses a GitHub URL to extract repository information.
   */
  private parseGitHubUrl(
    url: string,
  ): GitHubRepoInfo & { isBlob?: boolean; filePath?: string } {
    const parsedUrl = new URL(url);
    // Extract /<org>/<repo> from github.com/<org>/<repo>/...
    const match = parsedUrl.pathname.match(/^\/([^/]+)\/([^/]+)/);
    if (!match) {
      throw new Error(`Invalid GitHub repository URL: ${url}`);
    }

    const [, owner, repo] = match;

    // Extract branch and optional subpath from URLs like /tree/<branch>/<subPath>
    const segments = parsedUrl.pathname.split("/").filter(Boolean);

    // Handle /blob/ URLs for single file indexing
    if (segments.length >= 4 && segments[2] === "blob") {
      const branch = segments[3];
      const filePath = segments.length > 4 ? segments.slice(4).join("/") : undefined;
      return { owner, repo, branch, filePath, isBlob: true };
    }

    // Handle /tree/ URLs with branch and optional subpath
    if (segments.length >= 4 && segments[2] === "tree") {
      const branch = segments[3];
      const subPath = segments.length > 4 ? segments.slice(4).join("/") : undefined;
      return { owner, repo, branch, subPath };
    }

    // Base repository URL
    return { owner, repo };
  }

  /**
   * Fetches the repository tree structure from GitHub API.
   */
  private async fetchRepositoryTree(
    repoInfo: GitHubRepoInfo,
    signal?: AbortSignal,
  ): Promise<{ tree: GitHubTreeResponse; resolvedBranch: string }> {
    const { owner, repo, branch } = repoInfo;

    // If no branch specified, fetch the default branch first
    let targetBranch = branch;
    if (!targetBranch) {
      try {
        const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
        logger.debug(`Fetching repository info: ${repoUrl}`);

        const repoContent = await this.httpFetcher.fetch(repoUrl, { signal });
        const content =
          typeof repoContent.content === "string"
            ? repoContent.content
            : repoContent.content.toString("utf-8");
        const repoData = JSON.parse(content) as { default_branch: string };
        targetBranch = repoData.default_branch;

        logger.debug(`Using default branch: ${targetBranch}`);
      } catch (error) {
        logger.warn(`⚠️  Could not fetch default branch, using 'main': ${error}`);
        targetBranch = "main";
      }
    }

    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${targetBranch}?recursive=1`;
    logger.debug(`Fetching repository tree: ${treeUrl}`);

    const rawContent = await this.httpFetcher.fetch(treeUrl, { signal });
    const content =
      typeof rawContent.content === "string"
        ? rawContent.content
        : rawContent.content.toString("utf-8");
    const treeData = JSON.parse(content) as GitHubTreeResponse;

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
    if (item.type !== "blob") {
      return false;
    }

    const path = item.path;

    // Whitelist of text-based file extensions
    const textExtensions = [
      ".md",
      ".mdx",
      ".txt",
      ".rst",
      ".adoc",
      ".asciidoc",
      ".html",
      ".htm",
      ".xml",
      ".css",
      ".scss",
      ".sass",
      ".less",
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
      ".py",
      ".java",
      ".c",
      ".cpp",
      ".cc",
      ".cxx",
      ".h",
      ".hpp",
      ".cs",
      ".go",
      ".rs",
      ".rb",
      ".php",
      ".swift",
      ".kt",
      ".scala",
      ".clj",
      ".cljs",
      ".hs",
      ".elm",
      ".dart",
      ".r",
      ".m",
      ".mm",
      ".sh",
      ".bash",
      ".zsh",
      ".fish",
      ".ps1",
      ".bat",
      ".cmd",
      ".json",
      ".yaml",
      ".yml",
      ".toml",
      ".ini",
      ".cfg",
      ".conf",
      ".properties",
      ".env",
      ".gitignore",
      ".dockerignore",
      ".gitattributes",
      ".editorconfig",
      ".gradle",
      ".pom",
      ".sbt",
      ".maven",
      ".cmake",
      ".make",
      ".dockerfile",
      ".mod",
      ".sum",
      ".sql",
      ".graphql",
      ".gql",
      ".proto",
      ".thrift",
      ".avro",
      ".csv",
      ".tsv",
      ".log",
    ];

    const pathLower = path.toLowerCase();
    const hasTextExtension = textExtensions.some((ext) => pathLower.endsWith(ext));
    const hasCompoundExtension =
      pathLower.includes(".env.") ||
      pathLower.endsWith(".env") ||
      pathLower.includes(".config.") ||
      pathLower.includes(".lock");

    const fileName = path.split("/").pop() || "";
    const fileNameLower = fileName.toLowerCase();
    const commonTextFiles = [
      "readme",
      "license",
      "changelog",
      "contributing",
      "authors",
      "maintainers",
      "dockerfile",
      "makefile",
      "rakefile",
      "gemfile",
      "podfile",
      "cartfile",
      "brewfile",
      "procfile",
      "vagrantfile",
      "gulpfile",
      "gruntfile",
      ".prettierrc",
      ".eslintrc",
      ".babelrc",
      ".nvmrc",
      ".npmrc",
    ];

    const isCommonTextFile = commonTextFiles.some((name) => {
      if (name.startsWith(".")) {
        return fileNameLower === name || fileNameLower.startsWith(`${name}.`);
      }
      return fileNameLower === name || fileNameLower.startsWith(`${name}.`);
    });

    // If file passes known checks, include it
    if (hasTextExtension || hasCompoundExtension || isCommonTextFile) {
      return shouldIncludeUrl(path, options.includePatterns, options.excludePatterns);
    }

    // Fallback: check if unknown extension has text/* MIME type
    const mimeType = mime.getType(path);
    if (mimeType?.startsWith("text/")) {
      logger.debug(`Including file with text MIME type: ${path} (${mimeType})`);
      return shouldIncludeUrl(path, options.includePatterns, options.excludePatterns);
    }

    // Not a text file
    return false;
  }

  /**
   * Checks if a path is within the specified subpath.
   */
  private isWithinSubPath(path: string, subPath?: string): boolean {
    if (!subPath) {
      return true;
    }

    const trimmedSubPath = subPath.replace(/^\/+/, "").replace(/\/+$/, "");
    if (trimmedSubPath.length === 0) {
      return true;
    }

    const normalizedPath = path.replace(/^\/+/, "").replace(/\/+$/, "");
    if (normalizedPath === trimmedSubPath) {
      return true;
    }

    return normalizedPath.startsWith(`${trimmedSubPath}/`);
  }

  async processItem(
    item: QueueItem,
    options: ScraperOptions,
    signal?: AbortSignal,
  ): Promise<ProcessItemResult> {
    // Handle legacy github-file:// URLs - treat as deleted/not found
    if (item.url.startsWith("github-file://")) {
      logger.info(
        `🗑️  Legacy github-file:// URL detected, marking as deleted: ${item.url}`,
      );
      return {
        url: item.url,
        links: [],
        status: FetchStatus.NOT_FOUND,
      };
    }

    // Delegate to wiki processor for wiki URLs
    // Use precise pattern matching: /owner/repo/wiki or /owner/repo/wiki/
    try {
      const parsedUrl = new URL(item.url);
      if (/^\/[^/]+\/[^/]+\/wiki($|\/)/.test(parsedUrl.pathname)) {
        return await this.wikiProcessor.process(item, options, signal);
      }
    } catch {
      // If URL parsing fails, fall through to other handlers
    }

    // For the main repository URL (depth 0), perform discovery
    // This includes blob URLs at depth 0, which should return themselves as discovered links
    if (item.depth === 0) {
      const repoInfo = this.parseGitHubUrl(options.url);
      const { owner, repo } = repoInfo;

      logger.debug(`Discovering GitHub repository ${owner}/${repo}`);

      const discoveredLinks: string[] = [];

      // Handle single file (blob) URLs - strict scoping: index ONLY the file
      if ("isBlob" in repoInfo && repoInfo.isBlob && repoInfo.filePath) {
        const { branch = "main", filePath } = repoInfo;
        logger.debug(
          `Single file URL detected: ${owner}/${repo}/${filePath} - indexing file only`,
        );

        // Generate HTTPS blob URL for storage
        discoveredLinks.push(
          `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`,
        );

        return {
          url: item.url,
          links: discoveredLinks,
          status: FetchStatus.SUCCESS,
        };
      }

      // Discover wiki URL for full repo scrapes (will be processed by GitHubWikiScraperStrategy)
      const wikiUrl = `${options.url.replace(/\/$/, "")}/wiki`;
      discoveredLinks.push(wikiUrl);
      logger.debug(`Discovered wiki URL: ${wikiUrl}`);

      // 3. Discover all files in the repository
      const { tree, resolvedBranch } = await this.fetchRepositoryTree(repoInfo, signal);

      const fileItems = tree.tree
        .filter((treeItem) => this.isWithinSubPath(treeItem.path, repoInfo.subPath))
        .filter((treeItem) => this.shouldProcessFile(treeItem, options));

      logger.debug(
        `Discovered ${fileItems.length} processable files in repository (branch: ${resolvedBranch})`,
      );

      // Create HTTPS blob URLs for storage in database
      // These are user-friendly, clickable URLs that work outside the system
      const fileUrls = fileItems.map(
        (treeItem) =>
          `https://github.com/${owner}/${repo}/blob/${resolvedBranch}/${treeItem.path}`,
      );

      discoveredLinks.push(...fileUrls);

      logger.debug(
        `Discovery complete: ${fileUrls.length} repo file(s) + 1 wiki URL = ${discoveredLinks.length} total URLs`,
      );

      return { url: item.url, links: discoveredLinks, status: FetchStatus.SUCCESS };
    }

    // Handle HTTPS blob URLs at depth > 0 (from database during refresh or discovered files)
    // Process blob URLs directly - fetch content and return empty links
    // Use precise pattern matching: /owner/repo/blob/branch/path
    try {
      const parsedUrl = new URL(item.url);
      if (/^\/[^/]+\/[^/]+\/blob\//.test(parsedUrl.pathname)) {
        logger.debug(`Processing HTTPS blob URL at depth ${item.depth}: ${item.url}`);
        return await this.repoProcessor.process(item, options, signal);
      }
    } catch (error) {
      logger.warn(`⚠️  Failed to parse blob URL ${item.url}: ${error}`);
      return { url: item.url, links: [], status: FetchStatus.SUCCESS };
    }

    // For any other URLs at non-zero depth, return empty (shouldn't happen in practice)
    logger.debug(`No further processing for URL at depth ${item.depth}: ${item.url}`);
    return { url: item.url, links: [], status: FetchStatus.SUCCESS };
  }

  async scrape(
    options: ScraperOptions,
    progressCallback: ProgressCallback<ScraperProgressEvent>,
    signal?: AbortSignal,
  ): Promise<void> {
    const url = new URL(options.url);
    if (!url.hostname.includes("github.com")) {
      throw new Error("URL must be a GitHub URL");
    }

    // Use the base class implementation which handles initialQueue properly
    // The processItem method will discover all wiki and repo file URLs
    // The base scraper will automatically deduplicate URLs from initialQueue
    await super.scrape(options, progressCallback, signal);
  }

  async cleanup(): Promise<void> {
    await Promise.all([this.wikiProcessor.cleanup(), this.repoProcessor.cleanup()]);
  }
}
