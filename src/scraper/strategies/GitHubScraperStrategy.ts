import type { Document, ProgressCallback } from "../../types";
import { logger } from "../../utils/logger";
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import { HttpFetcher } from "../fetcher";
import type { RawContent } from "../fetcher/types";
import { PipelineFactory } from "../pipelines/PipelineFactory";
import type { ContentPipeline } from "../pipelines/types";
import type { ScraperOptions, ScraperProgress } from "../types";
import { shouldIncludeUrl } from "../utils/patternMatcher";
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
  private readonly pipelines: ContentPipeline[];
  private resolvedBranch?: string; // Cache the resolved default branch

  constructor() {
    super();
    this.pipelines = PipelineFactory.createStandardPipelines();
  }

  canHandle(url: string): boolean {
    const { hostname } = new URL(url);
    return ["github.com", "www.github.com"].includes(hostname);
  }

  /**
   * Override shouldProcessUrl to handle github-file:// URLs specially.
   * These URLs bypass scope checking since they're internal file references.
   */
  protected shouldProcessUrl(url: string, options: ScraperOptions): boolean {
    // For github-file:// URLs, only apply include/exclude patterns, skip scope checking
    if (url.startsWith("github-file://")) {
      const filePath = url.replace("github-file://", "");
      return shouldIncludeUrl(filePath, options.includePatterns, options.excludePatterns);
    }

    // For regular URLs, use the base implementation
    return super.shouldProcessUrl(url, options);
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

    // Cache the resolved branch for file fetching
    this.resolvedBranch = targetBranch;

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
    // Only process blob (file) items, not trees (directories)
    if (item.type !== "blob") {
      return false;
    }

    const path = item.path;

    // Whitelist of text-based file extensions that we can process
    const textExtensions = [
      // Documentation
      ".md",
      ".mdx",
      ".txt",
      ".rst",
      ".adoc",
      ".asciidoc",

      // Web technologies
      ".html",
      ".htm",
      ".xml",
      ".css",
      ".scss",
      ".sass",
      ".less",

      // Programming languages
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

      // Configuration and data
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

      // Build and package management
      ".gradle",
      ".pom",
      ".sbt",
      ".maven",
      ".cmake",
      ".make",
      ".dockerfile",
      ".mod", // Go modules (go.mod)
      ".sum", // Go checksums (go.sum)

      // Other text formats
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

    // Check for known text extensions
    const hasTextExtension = textExtensions.some((ext) => pathLower.endsWith(ext));

    // Check for compound extensions and special cases
    const hasCompoundExtension =
      pathLower.includes(".env.") || // .env.example, .env.local, etc.
      pathLower.endsWith(".env") ||
      pathLower.includes(".config.") || // webpack.config.js, etc.
      pathLower.includes(".lock"); // package-lock.json, etc.

    // Also include files without extensions that are commonly text files
    const fileName = path.split("/").pop() || "";
    const fileNameLower = fileName.toLowerCase();
    const commonTextFiles = [
      // Documentation files without extensions
      "readme",
      "license",
      "changelog",
      "contributing",
      "authors",
      "maintainers",

      // Build files without extensions
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

      // Configuration files (dotfiles)
      ".prettierrc",
      ".eslintrc",
      ".babelrc",
      ".nvmrc",
      ".npmrc",
    ];

    const isCommonTextFile = commonTextFiles.some((name) => {
      if (name.startsWith(".")) {
        // For dotfiles, match exactly or with additional extension (e.g., .prettierrc.js)
        return fileNameLower === name || fileNameLower.startsWith(`${name}.`);
      }
      // For regular files, match exactly or with extension
      return fileNameLower === name || fileNameLower.startsWith(`${name}.`);
    });

    // Process file if it has a text extension, compound extension, or is a common text file
    if (!hasTextExtension && !hasCompoundExtension && !isCommonTextFile) {
      return false;
    }

    // Apply user-defined include/exclude patterns (use the file path directly)
    return shouldIncludeUrl(path, options.includePatterns, options.excludePatterns);
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

    const rawContent = await this.httpFetcher.fetch(rawUrl, { signal });

    // Override GitHub's generic 'text/plain' MIME type with file extension-based detection
    const detectedMimeType = MimeTypeUtils.detectMimeTypeFromPath(filePath);
    if (detectedMimeType && rawContent.mimeType === "text/plain") {
      return {
        ...rawContent,
        mimeType: detectedMimeType,
      };
    }

    return rawContent;
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
      let processed: Awaited<ReturnType<ContentPipeline["process"]>> | undefined;

      for (const pipeline of this.pipelines) {
        if (pipeline.canProcess(rawContent)) {
          logger.debug(
            `Selected ${pipeline.constructor.name} for content type "${rawContent.mimeType}" (${filePath})`,
          );
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
          },
          contentType: rawContent.mimeType, // Preserve the detected MIME type
        } satisfies Document,
        links: [], // Always return empty links array for individual files
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

    return super.scrape(options, progressCallback, signal);
  }

  /**
   * Cleanup resources used by this strategy, specifically the pipeline browser instances.
   */
  async cleanup(): Promise<void> {
    await Promise.allSettled(this.pipelines.map((pipeline) => pipeline.close()));
  }
}
