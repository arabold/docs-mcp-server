import { beforeEach, describe, expect, it, vi } from "vitest";
import { FetchStatus, HttpFetcher } from "../fetcher";
import type { RawContent } from "../fetcher/types";
import { HtmlPipeline } from "../pipelines/HtmlPipeline";
import { MarkdownPipeline } from "../pipelines/MarkdownPipeline";
import type { PipelineResult } from "../pipelines/types";
import type { ScraperOptions } from "../types";
import { GitHubRepoScraperStrategy } from "./GitHubRepoScraperStrategy";

// Mock the fetcher and pipelines
vi.mock("../fetcher");
vi.mock("../pipelines/HtmlPipeline");
vi.mock("../pipelines/MarkdownPipeline");

const mockHttpFetcher = vi.mocked(HttpFetcher);
const mockHtmlPipeline = vi.mocked(HtmlPipeline);
const mockMarkdownPipeline = vi.mocked(MarkdownPipeline);

describe("GitHubRepoScraperStrategy", () => {
  let strategy: GitHubRepoScraperStrategy;
  let httpFetcherInstance: any;
  let htmlPipelineInstance: any;
  let markdownPipelineInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup fetcher mock
    httpFetcherInstance = {
      fetch: vi.fn(),
    };
    mockHttpFetcher.mockImplementation(() => httpFetcherInstance);

    // Setup pipeline mocks
    htmlPipelineInstance = {
      canProcess: vi.fn(),
      process: vi.fn(),
      close: vi.fn(),
    };
    markdownPipelineInstance = {
      canProcess: vi.fn(),
      process: vi.fn(),
      close: vi.fn(),
    };
    mockHtmlPipeline.mockImplementation(() => htmlPipelineInstance);
    mockMarkdownPipeline.mockImplementation(() => markdownPipelineInstance);

    strategy = new GitHubRepoScraperStrategy();
  });

  describe("canHandle", () => {
    it("should handle GitHub URLs", () => {
      expect(strategy.canHandle("https://github.com/owner/repo")).toBe(true);
      expect(strategy.canHandle("https://www.github.com/owner/repo")).toBe(true);
      expect(strategy.canHandle("https://github.com/owner/repo/tree/main")).toBe(true);
      expect(
        strategy.canHandle("https://github.com/owner/repo/blob/main/README.md"),
      ).toBe(true);
    });

    it("should not handle non-GitHub URLs", () => {
      expect(strategy.canHandle("https://gitlab.com/owner/repo")).toBe(false);
      expect(strategy.canHandle("https://bitbucket.org/owner/repo")).toBe(false);
      expect(strategy.canHandle("https://example.com")).toBe(false);
    });
  });

  describe("parseGitHubUrl", () => {
    it("should parse basic repository URL", () => {
      const result = strategy.parseGitHubUrl("https://github.com/owner/repo");
      expect(result).toEqual({ owner: "owner", repo: "repo" });
    });

    it("should parse tree URL with branch", () => {
      const result = strategy.parseGitHubUrl("https://github.com/owner/repo/tree/main");
      expect(result).toEqual({ owner: "owner", repo: "repo", branch: "main" });
    });

    it("should parse tree URL with branch and subpath", () => {
      const result = strategy.parseGitHubUrl(
        "https://github.com/owner/repo/tree/main/docs",
      );
      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
        branch: "main",
        subPath: "docs",
      });
    });

    it("should parse blob URL", () => {
      const result = strategy.parseGitHubUrl(
        "https://github.com/owner/repo/blob/main/README.md",
      );
      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
        branch: "main",
        filePath: "README.md",
        isBlob: true,
      });
    });

    it("should parse blob URL without file path", () => {
      const result = strategy.parseGitHubUrl("https://github.com/owner/repo/blob/main");
      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
        branch: "main",
        filePath: undefined,
        isBlob: true,
      });
    });

    it("should throw error for invalid repository URL", () => {
      expect(() => {
        strategy.parseGitHubUrl("https://github.com/invalid");
      }).toThrow("Invalid GitHub repository URL");
    });
  });

  describe("processItem", () => {
    const options: ScraperOptions = {
      url: "https://github.com/owner/repo",
      library: "test-lib",
      version: "1.0.0",
    };

    beforeEach(() => {
      // Mock repository info response
      httpFetcherInstance.fetch.mockImplementation((url: string) => {
        if (url.includes("api.github.com/repos")) {
          return Promise.resolve({
            textContent: JSON.stringify({ default_branch: "main" }),
            mimeType: "application/json",
            source: url,
            charset: "utf-8",
          });
        }
        if (url.includes("git/trees")) {
          return Promise.resolve({
            textContent: JSON.stringify({
              sha: "tree123",
              url: "https://api.github.com/repos/owner/repo/git/trees/tree123",
              tree: [
                {
                  path: "README.md",
                  type: "blob",
                  sha: "abc123",
                  size: 1024,
                  url: "https://api.github.com/repos/owner/repo/git/blobs/abc123",
                },
                {
                  path: "src/index.js",
                  type: "blob",
                  sha: "def456",
                  size: 512,
                  url: "https://api.github.com/repos/owner/repo/git/blobs/def456",
                },
                {
                  path: "binary-file.png",
                  type: "blob",
                  sha: "ghi789",
                  size: 2048,
                  url: "https://api.github.com/repos/owner/repo/git/blobs/ghi789",
                },
              ],
              truncated: false,
            }),
            mimeType: "application/json",
            source: url,
            charset: "utf-8",
          });
        }
        return Promise.resolve({
          textContent: "file content",
          mimeType: "text/plain",
          source: url,
          charset: "utf-8",
        });
      });
    });

    it("should discover repository structure and return file links", async () => {
      const item = { url: "https://github.com/owner/repo", depth: 0 };

      // Mock the fetchRepositoryTree method directly since it's a complex interaction
      const mockFetchRepositoryTree = vi
        .spyOn(strategy as any, "fetchRepositoryTree")
        .mockResolvedValue({
          tree: {
            sha: "tree123",
            url: "https://api.github.com/repos/owner/repo/git/trees/tree123",
            tree: [
              {
                path: "README.md",
                type: "blob",
                sha: "abc123",
                size: 1024,
                url: "https://api.github.com/repos/owner/repo/git/blobs/abc123",
              },
              {
                path: "src/index.js",
                type: "blob",
                sha: "def456",
                size: 512,
                url: "https://api.github.com/repos/owner/repo/git/blobs/def456",
              },
              {
                path: "binary-file.png",
                type: "blob",
                sha: "ghi789",
                size: 2048,
                url: "https://api.github.com/repos/owner/repo/git/blobs/ghi789",
              },
            ],
            truncated: false,
          },
          resolvedBranch: "main",
        });

      const result = await strategy.processItem(item, options);

      expect(result.links).toEqual([
        "github-file://README.md",
        "github-file://src/index.js",
      ]);
      expect(result.content).toBeUndefined();

      // Clean up the spy
      mockFetchRepositoryTree.mockRestore();
    });

    it("should handle blob URL with file path", async () => {
      const blobOptions = {
        ...options,
        url: "https://github.com/owner/repo/blob/main/README.md",
      };
      const item = { url: "https://github.com/owner/repo/blob/main/README.md", depth: 0 };
      const result = await strategy.processItem(item, blobOptions);

      expect(result.links).toEqual(["github-file://README.md"]);
      expect(result.content).toBeUndefined();
    });

    it("should handle blob URL without file path", async () => {
      const blobOptions = {
        ...options,
        url: "https://github.com/owner/repo/blob/main",
      };
      const item = { url: "https://github.com/owner/repo/blob/main", depth: 0 };
      const result = await strategy.processItem(item, blobOptions);

      expect(result.links).toEqual([]);
      expect(result.content).toBeUndefined();
    });

    it("should process individual file content", async () => {
      const rawContent: RawContent = {
        content: "# Test File\nThis is a test markdown file.",
        mimeType: "text/markdown",
        source: "https://raw.githubusercontent.com/owner/repo/main/README.md",
        charset: "utf-8",
        status: FetchStatus.SUCCESS,
      };

      const processedContent: PipelineResult = {
        textContent: "Test File\nThis is a test markdown file.",
        title: "Test File",
        chunks: [],
        errors: [],
        links: [],
      };

      httpFetcherInstance.fetch.mockResolvedValue(rawContent);
      markdownPipelineInstance.canProcess.mockReturnValue(true);
      markdownPipelineInstance.process.mockResolvedValue(processedContent);

      const item = { url: "github-file://README.md", depth: 1 };
      const result = await strategy.processItem(item, options);

      expect(result.content?.textContent).toBe(
        "Test File\nThis is a test markdown file.",
      );
      expect(result.contentType).toBe("text/markdown");
      expect(result.url).toBe("https://github.com/owner/repo/blob/main/README.md");
      expect(result.content?.title).toBe("Test File");
      expect(result.links).toEqual([]);
    });

    it("should use filename as title fallback when no title found", async () => {
      const rawContent: RawContent = {
        content: "Some content without title",
        mimeType: "text/plain",
        source: "https://raw.githubusercontent.com/owner/repo/main/config.txt",
        charset: "utf-8",
        status: FetchStatus.SUCCESS,
      };

      const processedContent: PipelineResult = {
        textContent: "Some content without title",
        title: "",
        chunks: [],
        errors: [],
        links: [],
      };

      httpFetcherInstance.fetch.mockResolvedValue(rawContent);
      markdownPipelineInstance.canProcess.mockReturnValue(true);
      markdownPipelineInstance.process.mockResolvedValue(processedContent);

      const item = { url: "github-file://config.txt", depth: 1 };
      const result = await strategy.processItem(item, options);

      expect(result.title).toBe("config.txt");
    });

    it("should handle unsupported content types", async () => {
      const rawContent: RawContent = {
        content: "binary content",
        mimeType: "application/octet-stream",
        source: "https://raw.githubusercontent.com/owner/repo/main/binary.bin",
        charset: "utf-8",
        status: FetchStatus.SUCCESS,
      };

      httpFetcherInstance.fetch.mockResolvedValue(rawContent);
      htmlPipelineInstance.canProcess.mockReturnValue(false);
      markdownPipelineInstance.canProcess.mockReturnValue(false);

      const item = { url: "github-file://binary.bin", depth: 1 };
      const result = await strategy.processItem(item, options);

      expect(result.content).toBeUndefined();
      expect(result.links).toEqual([]);
    });
  });

  describe("shouldProcessFile", () => {
    const options: ScraperOptions = {
      url: "https://github.com/owner/repo",
      library: "test-lib",
      version: "1.0.0",
    };

    it("should process text files", () => {
      const textFiles = [
        { path: "README.md", type: "blob" as const },
        { path: "src/index.js", type: "blob" as const },
        { path: "docs/guide.rst", type: "blob" as const },
        { path: "package.json", type: "blob" as const },
        { path: "Dockerfile", type: "blob" as const },
        // Note: LICENSE files are excluded by default patterns, so we don't test it here
      ];

      for (const file of textFiles) {
        // @ts-expect-error Accessing private method for testing
        expect(strategy.shouldProcessFile(file, options)).toBe(true);
      }
    });

    it("should skip binary files", () => {
      const binaryFiles = [
        { path: "image.png", type: "blob" as const },
        { path: "video.mp4", type: "blob" as const },
        { path: "archive.zip", type: "blob" as const },
        { path: "binary.exe", type: "blob" as const },
      ];

      for (const file of binaryFiles) {
        // @ts-expect-error Accessing private method for testing
        expect(strategy.shouldProcessFile(file, options)).toBe(false);
      }
    });

    it("should skip tree items", () => {
      const treeItem = { path: "src", type: "tree" as const };
      // @ts-expect-error Accessing private method for testing
      expect(strategy.shouldProcessFile(treeItem, options)).toBe(false);
    });

    it("should respect include patterns", () => {
      const optionsWithInclude = {
        ...options,
        includePatterns: ["*.md", "src/*"],
      };

      expect(
        // @ts-expect-error Accessing private method for testing
        strategy.shouldProcessFile(
          {
            path: "README.md",
            type: "blob" as const,
            sha: "abc123",
            url: "https://api.github.com/repos/owner/repo/git/blobs/abc123",
          },
          optionsWithInclude,
        ),
      ).toBe(true);
      expect(
        // @ts-expect-error Accessing private method for testing
        strategy.shouldProcessFile(
          {
            path: "src/index.js",
            type: "blob" as const,
            sha: "def456",
            url: "https://api.github.com/repos/owner/repo/git/blobs/def456",
          },
          optionsWithInclude,
        ),
      ).toBe(true);
      expect(
        // @ts-expect-error Accessing private method for testing
        strategy.shouldProcessFile(
          {
            path: "package.json",
            type: "blob" as const,
            sha: "ghi789",
            url: "https://api.github.com/repos/owner/repo/git/blobs/ghi789",
          },
          optionsWithInclude,
        ),
      ).toBe(false);
    });

    it("should respect exclude patterns", () => {
      const optionsWithExclude = {
        ...options,
        excludePatterns: ["**/*.test.js", "node_modules/**"],
      };

      expect(
        // @ts-expect-error Accessing private method for testing
        strategy.shouldProcessFile(
          {
            path: "src/index.js",
            type: "blob" as const,
            sha: "abc123",
            url: "https://api.github.com/repos/owner/repo/git/blobs/abc123",
          },
          optionsWithExclude,
        ),
      ).toBe(true);
      expect(
        // @ts-expect-error Accessing private method for testing
        strategy.shouldProcessFile(
          {
            path: "src/index.test.js",
            type: "blob" as const,
            sha: "def456",
            url: "https://api.github.com/repos/owner/repo/git/blobs/def456",
          },
          optionsWithExclude,
        ),
      ).toBe(false);
      expect(
        // @ts-expect-error Accessing private method for testing
        strategy.shouldProcessFile(
          {
            path: "node_modules/package/index.js",
            type: "blob" as const,
            sha: "ghi789",
            url: "https://api.github.com/repos/owner/repo/git/blobs/ghi789",
          },
          optionsWithExclude,
        ),
      ).toBe(false);
    });
  });

  describe("cleanup", () => {
    it("should cleanup pipeline resources", async () => {
      await strategy.cleanup();
      expect(htmlPipelineInstance.close).toHaveBeenCalled();
      expect(markdownPipelineInstance.close).toHaveBeenCalled();
    });
  });
});
