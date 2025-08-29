import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
      excludePatterns: [], // Override default exclusions for cleaner testing
    };

    it("should process markdown files", () => {
      const fileItem = {
        path: "README.md",
        type: "blob" as const,
        sha: "abc123",
        url: "test-url",
      };

      const result = (strategy as any).shouldProcessFile(fileItem, options);
      expect(result).toBe(true);
    });

    it("should process files with various text extensions", () => {
      const textFiles = [
        "README.md",
        "docs.mdx",
        "guide.txt",
        "index.html",
        "styles.css",
        "script.js",
        "main.py",
        "config.json",
        "setup.yml",
        "Dockerfile",
        "requirements.txt",
        ".gitignore",
        "package.json",
      ];

      for (const path of textFiles) {
        const fileItem = {
          path,
          type: "blob" as const,
          sha: "abc123",
          url: "test-url",
        };
        const result = (strategy as any).shouldProcessFile(fileItem, options);
        expect(result, `Expected ${path} to be processed`).toBe(true);
      }
    });

    it("should process common text files without extensions", () => {
      const commonFiles = ["README", "LICENSE", "CHANGELOG", "Dockerfile", "Makefile"];

      for (const path of commonFiles) {
        const fileItem = {
          path,
          type: "blob" as const,
          sha: "abc123",
          url: "test-url",
        };
        const result = (strategy as any).shouldProcessFile(fileItem, options);
        expect(result, `Expected ${path} to be processed`).toBe(true);
      }
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
      const binaryFiles = [
        "image.png",
        "photo.jpg",
        "video.mp4",
        "audio.wav",
        "archive.zip",
        "binary.exe",
        "font.ttf",
        "data.pdf",
      ];

      for (const path of binaryFiles) {
        const binaryItem = {
          path,
          type: "blob" as const,
          sha: "abc123",
          url: "test-url",
        };
        const result = (strategy as any).shouldProcessFile(binaryItem, options);
        expect(result, `Expected ${path} to be skipped`).toBe(false);
      }
    });

    it("should handle files in subdirectories", () => {
      const files = [
        "src/main.js",
        "docs/api/index.md",
        ".github/workflows/ci.yml",
        "tests/unit/test.py",
      ];

      for (const path of files) {
        const fileItem = {
          path,
          type: "blob" as const,
          sha: "abc123",
          url: "test-url",
        };
        const result = (strategy as any).shouldProcessFile(fileItem, options);
        expect(result, `Expected ${path} to be processed`).toBe(true);
      }
    });

    it("should respect include patterns", () => {
      const optionsWithInclude: ScraperOptions = {
        ...options,
        includePatterns: ["docs/*"],
      };

      const docsFile = {
        path: "docs/guide.md",
        type: "blob" as const,
        sha: "abc123",
        url: "test-url",
      };

      const srcFile = {
        path: "src/main.js",
        type: "blob" as const,
        sha: "abc123",
        url: "test-url",
      };

      expect((strategy as any).shouldProcessFile(docsFile, optionsWithInclude)).toBe(
        true,
      );
      expect((strategy as any).shouldProcessFile(srcFile, optionsWithInclude)).toBe(
        false,
      );
    });

    it("should respect exclude patterns", () => {
      const optionsWithExclude: ScraperOptions = {
        ...options,
        excludePatterns: ["test/*", "**/*.test.*"],
      };

      const regularFile = {
        path: "src/main.js",
        type: "blob" as const,
        sha: "abc123",
        url: "test-url",
      };

      const testFile = {
        path: "test/unit.js",
        type: "blob" as const,
        sha: "abc123",
        url: "test-url",
      };

      const testFileWithExt = {
        path: "src/component.test.js",
        type: "blob" as const,
        sha: "abc123",
        url: "test-url",
      };

      expect((strategy as any).shouldProcessFile(regularFile, optionsWithExclude)).toBe(
        true,
      );
      expect((strategy as any).shouldProcessFile(testFile, optionsWithExclude)).toBe(
        false,
      );
      expect(
        (strategy as any).shouldProcessFile(testFileWithExt, optionsWithExclude),
      ).toBe(false);
    });

    it("should handle files with uppercase extensions", () => {
      const files = ["README.MD", "CONFIG.JSON", "SCRIPT.JS"];

      for (const path of files) {
        const fileItem = {
          path,
          type: "blob" as const,
          sha: "abc123",
          url: "test-url",
        };
        const result = (strategy as any).shouldProcessFile(fileItem, options);
        expect(result, `Expected ${path} to be processed (case insensitive)`).toBe(true);
      }
    });
  });

  describe("GitHub scraper integration", () => {
    const options: ScraperOptions = {
      url: "https://github.com/owner/repo",
      library: "test-lib",
      version: "1.0.0",
      excludePatterns: [], // Override default exclusions for cleaner testing
    };

    it("should discover and filter files from repository structure", async () => {
      const mockRepoResponse = {
        default_branch: "main",
      };

      const mockTreeResponse = {
        sha: "abc123",
        url: "test-url",
        tree: [
          // Mix of processable and non-processable files
          { path: "README.md", type: "blob", sha: "1", url: "test-url" },
          { path: ".dockerignore", type: "blob", sha: "2", url: "test-url" },
          { path: "src/main.js", type: "blob", sha: "3", url: "test-url" },
          { path: "image.png", type: "blob", sha: "4", url: "test-url" }, // Should be filtered out
          { path: "src", type: "tree", sha: "5", url: "test-url" }, // Should be filtered out
          { path: "package.json", type: "blob", sha: "6", url: "test-url" },
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

      const item = { url: options.url, depth: 0 };
      const result = await (strategy as any).processItem(item, options);

      // Should only return links for processable files
      expect(result.links).toEqual([
        "github-file://README.md",
        "github-file://.dockerignore",
        "github-file://src/main.js",
        "github-file://package.json",
      ]);

      // Should not include binary files or directories
      expect(result.links).not.toContain("github-file://image.png");
      expect(result.links).not.toContain("github-file://src");
    });

    it("should handle include patterns in repository discovery", async () => {
      const optionsWithInclude = {
        ...options,
        includePatterns: ["docs/*", "*.md"],
      };

      const mockRepoResponse = { default_branch: "main" };
      const mockTreeResponse = {
        sha: "abc123",
        url: "test-url",
        tree: [
          { path: "README.md", type: "blob", sha: "1", url: "test-url" }, // Should include
          { path: "docs/guide.md", type: "blob", sha: "2", url: "test-url" }, // Should include
          { path: "src/main.js", type: "blob", sha: "3", url: "test-url" }, // Should exclude
          { path: "docs/api.json", type: "blob", sha: "4", url: "test-url" }, // Should include (docs/*)
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

      const item = { url: optionsWithInclude.url, depth: 0 };
      const result = await (strategy as any).processItem(item, optionsWithInclude);

      expect(result.links).toEqual([
        "github-file://README.md",
        "github-file://docs/guide.md",
        "github-file://docs/api.json",
      ]);
      expect(result.links).not.toContain("github-file://src/main.js");
    });

    it("should handle exclude patterns in repository discovery", async () => {
      const optionsWithExclude = {
        ...options,
        excludePatterns: ["test/*", "**/*.test.*"],
      };

      const mockRepoResponse = { default_branch: "main" };
      const mockTreeResponse = {
        sha: "abc123",
        url: "test-url",
        tree: [
          { path: "README.md", type: "blob", sha: "1", url: "test-url" }, // Should include
          { path: "src/main.js", type: "blob", sha: "2", url: "test-url" }, // Should include
          { path: "test/unit.js", type: "blob", sha: "3", url: "test-url" }, // Should exclude
          { path: "src/component.test.js", type: "blob", sha: "4", url: "test-url" }, // Should exclude
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

      const item = { url: optionsWithExclude.url, depth: 0 };
      const result = await (strategy as any).processItem(item, optionsWithExclude);

      expect(result.links).toEqual([
        "github-file://README.md",
        "github-file://src/main.js",
      ]);
      expect(result.links).not.toContain("github-file://test/unit.js");
      expect(result.links).not.toContain("github-file://src/component.test.js");
    });

    it("should process file content and return proper document", async () => {
      const rawContent: RawContent = {
        content: "# Documentation\n\nThis is important content.",
        mimeType: "text/markdown",
        source: "https://raw.githubusercontent.com/owner/repo/main/docs/guide.md",
        charset: "utf-8",
      };

      const processedContent = {
        textContent: "Documentation\n\nThis is important content.",
        metadata: { title: "Documentation" },
        errors: [],
        links: ["https://example.com/related"],
      };

      vi.spyOn(strategy as any, "fetchFileContent").mockResolvedValue(rawContent);
      markdownPipelineInstance.canProcess.mockReturnValue(true);
      markdownPipelineInstance.process.mockResolvedValue(processedContent);

      const item = { url: "github-file://docs/guide.md", depth: 1 };
      const result = await (strategy as any).processItem(item, options);

      expect(result.document).toEqual({
        content: "Documentation\n\nThis is important content.",
        contentType: "text/markdown",
        metadata: {
          url: "https://github.com/owner/repo/blob/main/docs/guide.md",
          title: "Documentation",
          library: "test-lib",
          version: "1.0.0",
        },
      });
      expect(result.links).toEqual([]);
    });
  });

  describe("Real-world repository structures", () => {
    const options: ScraperOptions = {
      url: "https://github.com/arabold/docs-mcp-server",
      library: "docs-mcp-server",
      version: "1.23.0",
      excludePatterns: ["dist/**", "node_modules/**", "build/**"], // Common build/dependency exclusions
    };

    it("should process docs-mcp-server repository structure", () => {
      const realWorldFiles = [
        // Configuration files
        ".dockerignore",
        ".env.example",
        ".gitignore",
        "package.json",
        "tsconfig.json",
        "biome.json",
        "docker-compose.yml",
        "Dockerfile",

        // Documentation
        "README.md",
        "ARCHITECTURE.md",
        "CHANGELOG.md",
        "LICENSE",

        // GitHub specific
        ".github/copilot-instructions.md",
        ".github/workflows/ci.yml",

        // Source code
        "src/index.ts",
        "src/scraper/strategies/GitHubScraperStrategy.ts",
        "src/types/index.ts",

        // Build output (should be excluded by default patterns)
        "dist/index.js",
        "node_modules/package/index.js",
      ];

      const shouldBeProcessed = realWorldFiles.filter(
        (path) => !path.startsWith("dist/") && !path.startsWith("node_modules/"),
      );

      for (const path of shouldBeProcessed) {
        const fileItem = {
          path,
          type: "blob" as const,
          sha: "abc123",
          url: "test-url",
        };
        const result = (strategy as any).shouldProcessFile(fileItem, options);
        expect(result, `Expected ${path} to be processed`).toBe(true);
      }

      // Verify build output would be excluded
      const excludedFiles = realWorldFiles.filter(
        (path) => path.startsWith("dist/") || path.startsWith("node_modules/"),
      );

      for (const path of excludedFiles) {
        const fileItem = {
          path,
          type: "blob" as const,
          sha: "abc123",
          url: "test-url",
        };
        const result = (strategy as any).shouldProcessFile(fileItem, options);
        expect(result, `Expected ${path} to be excluded`).toBe(false);
      }
    });

    it("should handle typical open source repository patterns", () => {
      const commonRepoFiles = [
        // Root documentation
        "README.md",
        "LICENSE",
        "CONTRIBUTING.md",
        "CODE_OF_CONDUCT.md",
        "SECURITY.md",

        // Configuration
        "package.json",
        "Cargo.toml",
        "requirements.txt",
        "pyproject.toml",
        "go.mod",
        "composer.json",

        // CI/CD
        ".github/workflows/test.yml",
        ".github/workflows/release.yml",
        ".travis.yml",
        ".circleci/config.yml",

        // Development
        ".editorconfig",
        ".prettierrc",
        ".eslintrc.json",
        "jest.config.js",
        "webpack.config.js",

        // Documentation directories
        "docs/installation.md",
        "docs/api/endpoints.md",
        "examples/basic.js",
        "tutorials/getting-started.md",
      ];

      for (const path of commonRepoFiles) {
        const fileItem = {
          path,
          type: "blob" as const,
          sha: "abc123",
          url: "test-url",
        };
        const result = (strategy as any).shouldProcessFile(fileItem, options);
        expect(result, `Expected ${path} to be processed`).toBe(true);
      }
    });

    it("should exclude common binary and build files", () => {
      const excludedFiles = [
        // Images
        "logo.png",
        "screenshot.jpg",
        "favicon.ico",
        "assets/images/banner.svg",

        // Videos/Audio
        "demo.mp4",
        "tutorial.avi",
        "sound.wav",

        // Archives
        "releases.zip",
        "backup.tar.gz",
        "data.rar",

        // Binaries
        "app.exe",
        "library.so",
        "framework.dylib",
        "binary",

        // Fonts
        "font.ttf",
        "icons.woff2",

        // Documents
        "manual.pdf",
        "spec.docx",
      ];

      for (const path of excludedFiles) {
        const fileItem = {
          path,
          type: "blob" as const,
          sha: "abc123",
          url: "test-url",
        };
        const result = (strategy as any).shouldProcessFile(fileItem, options);
        expect(result, `Expected ${path} to be excluded`).toBe(false);
      }
    });
  });

  describe("Error handling and edge cases", () => {
    const options: ScraperOptions = {
      url: "https://github.com/owner/repo",
      library: "test-lib",
      version: "1.0.0",
      excludePatterns: [], // Override default exclusions for cleaner testing
    };

    it("should handle GitHub API errors gracefully", async () => {
      httpFetcherInstance.fetch.mockRejectedValue(
        new Error("GitHub API rate limit exceeded"),
      );

      const item = { url: options.url, depth: 0 };

      await expect((strategy as any).processItem(item, options)).rejects.toThrow(
        "GitHub API rate limit exceeded",
      );
    });

    it("should handle malformed GitHub API responses", async () => {
      httpFetcherInstance.fetch.mockResolvedValue({
        content: "invalid json{",
        mimeType: "application/json",
      });

      const item = { url: options.url, depth: 0 };

      await expect((strategy as any).processItem(item, options)).rejects.toThrow();
    });

    it("should handle empty repository trees", async () => {
      const mockRepoResponse = { default_branch: "main" };
      const mockTreeResponse = {
        sha: "abc123",
        url: "test-url",
        tree: [], // Empty repository
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

      const item = { url: options.url, depth: 0 };
      const result = await (strategy as any).processItem(item, options);

      expect(result.links).toEqual([]);
      expect(result.document).toBeUndefined();
    });

    it("should handle truncated repository trees", async () => {
      const mockRepoResponse = { default_branch: "main" };
      const mockTreeResponse = {
        sha: "abc123",
        url: "test-url",
        tree: [{ path: "README.md", type: "blob", sha: "1", url: "test-url" }],
        truncated: true, // Large repository was truncated
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

      const item = { url: options.url, depth: 0 };
      const result = await (strategy as any).processItem(item, options);

      // Should still process available files
      expect(result.links).toEqual(["github-file://README.md"]);
    });

    it("should handle repositories with no default branch info", async () => {
      const mockTreeResponse = {
        sha: "abc123",
        url: "test-url",
        tree: [{ path: "README.md", type: "blob", sha: "1", url: "test-url" }],
        truncated: false,
      };

      // First call fails, second call succeeds with fallback branch
      httpFetcherInstance.fetch
        .mockRejectedValueOnce(new Error("Repository not found"))
        .mockResolvedValueOnce({
          content: JSON.stringify(mockTreeResponse),
          mimeType: "application/json",
        });

      const repoInfo = { owner: "owner", repo: "repo" };
      const result = await (strategy as any).fetchRepositoryTree(repoInfo);

      // Should fallback to 'main' and still work
      expect(result.tree).toEqual(mockTreeResponse);
      expect(result.resolvedBranch).toBe("main");
    });
  });

  describe("processItem", () => {
    const options: ScraperOptions = {
      url: "https://github.com/owner/repo",
      library: "test-lib",
      version: "1.0.0",
      excludePatterns: [], // Override default exclusions for cleaner testing
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
      ).mockResolvedValue(undefined);

      await strategy.scrape(options, vi.fn());

      expect(htmlPipelineInstance.close).toHaveBeenCalled();
      expect(markdownPipelineInstance.close).toHaveBeenCalled();
    });
  });
});
