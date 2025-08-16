import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "../../types";
import { HttpFetcher } from "../fetcher";
import type { RawContent } from "../fetcher/types";
import { HtmlPipeline } from "../pipelines/HtmlPipeline";
import { MarkdownPipeline } from "../pipelines/MarkdownPipeline";
import type { ScraperOptions } from "../types";
import { GitHubScraperStrategy } from "./GitHubScraperStrategy";

// Mock the fetcher and pipelines
vi.mock("../fetcher");
vi.mock("../pipelines/HtmlPipeline");
vi.mock("../pipelines/MarkdownPipeline");

const mockHttpFetcher = vi.mocked(HttpFetcher);
const mockHtmlPipeline = vi.mocked(HtmlPipeline);
const mockMarkdownPipeline = vi.mocked(MarkdownPipeline);

describe("GitHubScraperStrategy", () => {
  let strategy: GitHubScraperStrategy;
  let httpFetcherInstance: any;
  let htmlPipelineInstance: any;
  let markdownPipelineInstance: any;

  beforeEach(() => {
    // Reset all mocks
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

    strategy = new GitHubScraperStrategy();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("canHandle", () => {
    it("should handle github.com URLs", () => {
      expect(strategy.canHandle("https://github.com/owner/repo")).toBe(true);
      expect(strategy.canHandle("https://www.github.com/owner/repo")).toBe(true);
    });

    it("should not handle non-GitHub URLs", () => {
      expect(strategy.canHandle("https://example.com")).toBe(false);
      expect(strategy.canHandle("https://gitlab.com/owner/repo")).toBe(false);
    });
  });

  describe("parseGitHubUrl", () => {
    it("should parse basic repository URL", () => {
      const result = (strategy as any).parseGitHubUrl("https://github.com/owner/repo");
      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
        branch: undefined,
      });
    });

    it("should parse URL with branch", () => {
      const result = (strategy as any).parseGitHubUrl(
        "https://github.com/owner/repo/tree/feature-branch",
      );
      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
        branch: "feature-branch",
      });
    });

    it("should throw error for invalid URL", () => {
      expect(() => {
        (strategy as any).parseGitHubUrl("https://github.com/invalid");
      }).toThrow("Invalid GitHub repository URL");
    });
  });

  describe("fetchRepositoryTree", () => {
    it("should fetch and parse repository tree", async () => {
      const mockRepoResponse = {
        default_branch: "main",
      };

      const mockTreeResponse = {
        sha: "abc123",
        url: "https://api.github.com/repos/owner/repo/git/trees/abc123",
        tree: [
          {
            path: "README.md",
            type: "blob",
            sha: "def456",
            size: 1024,
            url: "https://api.github.com/repos/owner/repo/git/blobs/def456",
          },
          {
            path: "src",
            type: "tree",
            sha: "ghi789",
            url: "https://api.github.com/repos/owner/repo/git/trees/ghi789",
          },
        ],
        truncated: false,
      };

      httpFetcherInstance.fetch
        .mockResolvedValueOnce({
          content: JSON.stringify(mockRepoResponse),
          mimeType: "application/json",
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(mockTreeResponse),
          mimeType: "application/json",
        });

      const repoInfo = { owner: "owner", repo: "repo" };
      const result = await (strategy as any).fetchRepositoryTree(repoInfo);

      expect(httpFetcherInstance.fetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/owner/repo",
        { signal: undefined },
      );
      expect(httpFetcherInstance.fetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/owner/repo/git/trees/main?recursive=1",
        { signal: undefined },
      );
      expect(result.tree).toEqual(mockTreeResponse);
      expect(result.resolvedBranch).toBe("main");
    });
  });

  describe("shouldProcessFile", () => {
    const options: ScraperOptions = {
      url: "https://github.com/owner/repo",
      library: "test-lib",
      version: "1.0.0",
    };

    it("should process text files", () => {
      const fileItem = {
        path: "README.md",
        type: "blob" as const,
        sha: "abc123",
        url: "test-url",
      };

      // Mock shouldProcessUrl to return true
      vi.spyOn(strategy as any, "shouldProcessUrl").mockReturnValue(true);

      const result = (strategy as any).shouldProcessFile(fileItem, options);
      expect(result).toBe(true);
    });

    it("should not process directory items", () => {
      const treeItem = {
        path: "src",
        type: "tree" as const,
        sha: "abc123",
        url: "test-url",
      };

      const result = (strategy as any).shouldProcessFile(treeItem, options);
      expect(result).toBe(false);
    });

    it("should not process binary files", () => {
      const binaryItem = {
        path: "image.png",
        type: "blob" as const,
        sha: "abc123",
        url: "test-url",
      };

      const result = (strategy as any).shouldProcessFile(binaryItem, options);
      expect(result).toBe(false);
    });
  });

  describe("processItem", () => {
    const options: ScraperOptions = {
      url: "https://github.com/owner/repo",
      library: "test-lib",
      version: "1.0.0",
    };

    it("should discover repository structure on initial item", async () => {
      const mockTreeResponse = {
        sha: "abc123",
        url: "test-url",
        tree: [
          {
            path: "README.md",
            type: "blob" as const,
            sha: "def456",
            url: "test-url",
          },
        ],
        truncated: false,
      };

      // Mock the tree fetch
      vi.spyOn(strategy as any, "fetchRepositoryTree").mockResolvedValue({
        tree: mockTreeResponse,
        resolvedBranch: "main",
      });
      vi.spyOn(strategy as any, "shouldProcessFile").mockReturnValue(true);

      const item = { url: options.url, depth: 0 };
      const result = await (strategy as any).processItem(item, options);

      expect(result.links).toEqual(["github-file://README.md"]);
    });

    it("should process individual files", async () => {
      const rawContent: RawContent = {
        content: "# Hello World\nThis is a test file.",
        mimeType: "text/markdown",
        source: "https://raw.githubusercontent.com/owner/repo/main/README.md",
        charset: "utf-8",
      };

      const processedContent = {
        textContent: "Hello World\nThis is a test file.",
        metadata: { title: "Hello World" },
        errors: [],
        links: [],
      };

      // Mock file content fetch
      vi.spyOn(strategy as any, "fetchFileContent").mockResolvedValue(rawContent);

      // Mock pipeline processing
      markdownPipelineInstance.canProcess.mockReturnValue(true);
      markdownPipelineInstance.process.mockResolvedValue(processedContent);

      const item = { url: "github-file://README.md", depth: 1 };
      const result = await (strategy as any).processItem(item, options);

      expect(result.document).toBeDefined();
      expect(result.document?.content).toBe("Hello World\nThis is a test file.");
      expect(result.document?.metadata.title).toBe("Hello World");
      expect(result.document?.metadata.filePath).toBe("README.md");
      expect(result.document?.metadata.repository).toBe("owner/repo");
    });
  });

  describe("scrape", () => {
    it("should validate GitHub URL", async () => {
      const options: ScraperOptions = {
        url: "https://example.com",
        library: "test-lib",
        version: "1.0.0",
      };

      await expect(strategy.scrape(options, vi.fn())).rejects.toThrow(
        "URL must be a GitHub URL",
      );
    });

    it("should close pipelines after scraping", async () => {
      const options: ScraperOptions = {
        url: "https://github.com/owner/repo",
        library: "test-lib",
        version: "1.0.0",
        maxPages: 1,
      };

      // Mock the base scrape method
      vi.spyOn(
        Object.getPrototypeOf(Object.getPrototypeOf(strategy)),
        "scrape",
      ).mockResolvedValue();

      await strategy.scrape(options, vi.fn());

      expect(htmlPipelineInstance.close).toHaveBeenCalled();
      expect(markdownPipelineInstance.close).toHaveBeenCalled();
    });
  });
});
