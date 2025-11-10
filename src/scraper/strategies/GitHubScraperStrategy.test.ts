import { beforeEach, describe, expect, it, vi } from "vitest";
import { FetchStatus, HttpFetcher } from "../fetcher";
import type { ScraperOptions } from "../types";
import { GitHubScraperStrategy } from "./GitHubScraperStrategy";

// Mock the dependencies
vi.mock("../fetcher");

const mockHttpFetcher = vi.mocked(HttpFetcher);

describe("GitHubScraperStrategy", () => {
  let strategy: GitHubScraperStrategy;
  let httpFetcherInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup fetcher mock
    httpFetcherInstance = {
      fetch: vi.fn(),
    };
    mockHttpFetcher.mockImplementation(() => httpFetcherInstance);

    strategy = new GitHubScraperStrategy();
  });

  describe("canHandle", () => {
    it("should handle base GitHub repository URLs", () => {
      expect(strategy.canHandle("https://github.com/owner/repo")).toBe(true);
      expect(strategy.canHandle("https://www.github.com/owner/repo")).toBe(true);
      expect(strategy.canHandle("https://github.com/owner/repo/")).toBe(true);
    });

    it("should handle tree URLs with branch", () => {
      expect(strategy.canHandle("https://github.com/owner/repo/tree/main")).toBe(true);
      expect(strategy.canHandle("https://github.com/owner/repo/tree/develop/src")).toBe(
        true,
      );
    });

    it("should handle blob URLs with file paths", () => {
      expect(
        strategy.canHandle("https://github.com/owner/repo/blob/main/README.md"),
      ).toBe(true);
      expect(
        strategy.canHandle("https://github.com/owner/repo/blob/main/src/index.js"),
      ).toBe(true);
    });

    it("should not handle non-GitHub URLs", () => {
      expect(strategy.canHandle("https://gitlab.com/owner/repo")).toBe(false);
      expect(strategy.canHandle("https://bitbucket.org/owner/repo")).toBe(false);
      expect(strategy.canHandle("https://example.com")).toBe(false);
    });

    it("should not handle GitHub wiki URLs", () => {
      expect(strategy.canHandle("https://github.com/owner/repo/wiki")).toBe(false);
      expect(strategy.canHandle("https://github.com/owner/repo/wiki/Page")).toBe(false);
    });

    it("should not handle other GitHub paths", () => {
      expect(strategy.canHandle("https://github.com/owner/repo/issues")).toBe(false);
      expect(strategy.canHandle("https://github.com/owner/repo/pulls")).toBe(false);
    });
  });

  describe("parseGitHubUrl", () => {
    it("should parse basic repository URL", () => {
      const result = (strategy as any).parseGitHubUrl("https://github.com/owner/repo");
      expect(result).toEqual({ owner: "owner", repo: "repo" });
    });

    it("should parse tree URL with branch", () => {
      const result = (strategy as any).parseGitHubUrl(
        "https://github.com/owner/repo/tree/main",
      );
      expect(result).toEqual({ owner: "owner", repo: "repo", branch: "main" });
    });

    it("should parse tree URL with branch and subpath", () => {
      const result = (strategy as any).parseGitHubUrl(
        "https://github.com/owner/repo/tree/main/docs",
      );
      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
        branch: "main",
        subPath: "docs",
      });
    });

    it("should parse blob URL with file", () => {
      const result = (strategy as any).parseGitHubUrl(
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

    it("should parse blob URL with nested file path", () => {
      const result = (strategy as any).parseGitHubUrl(
        "https://github.com/owner/repo/blob/main/src/index.js",
      );
      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
        branch: "main",
        filePath: "src/index.js",
        isBlob: true,
      });
    });

    it("should throw error for invalid repository URL", () => {
      expect(() => {
        (strategy as any).parseGitHubUrl("https://github.com/invalid");
      }).toThrow("Invalid GitHub repository URL");
    });
  });

  describe("shouldProcessFile", () => {
    const options: ScraperOptions = {
      url: "https://github.com/owner/repo",
      library: "test-lib",
      version: "1.0.0",
    };

    it("should process text files with common extensions", () => {
      const textFiles = [
        { path: "README.md", type: "blob" as const },
        { path: "src/index.js", type: "blob" as const },
        { path: "docs/guide.rst", type: "blob" as const },
        { path: "package.json", type: "blob" as const },
        { path: "config.yaml", type: "blob" as const },
        { path: "script.py", type: "blob" as const },
      ];

      for (const file of textFiles) {
        // @ts-expect-error Accessing private method for testing
        expect(strategy.shouldProcessFile(file, options)).toBe(true);
      }
    });

    it("should process common text files without extensions", () => {
      const commonFiles = [
        { path: "Dockerfile", type: "blob" as const },
        { path: "Makefile", type: "blob" as const },
        { path: "README", type: "blob" as const },
        { path: "CHANGELOG", type: "blob" as const },
      ];

      for (const file of commonFiles) {
        // @ts-expect-error Accessing private method for testing
        expect(strategy.shouldProcessFile(file, options)).toBe(true);
      }
    });

    it("should process config files", () => {
      const configFiles = [
        { path: ".prettierrc", type: "blob" as const },
        { path: ".eslintrc", type: "blob" as const },
        { path: ".babelrc", type: "blob" as const },
        { path: ".env", type: "blob" as const },
        { path: ".env.local", type: "blob" as const },
      ];

      for (const file of configFiles) {
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
        { path: "lib.so", type: "blob" as const },
        { path: "app.dmg", type: "blob" as const },
      ];

      for (const file of binaryFiles) {
        // @ts-expect-error Accessing private method for testing
        expect(strategy.shouldProcessFile(file, options)).toBe(false);
      }
    });

    it("should skip tree items (directories)", () => {
      const treeItem = { path: "src", type: "tree" as const };
      // @ts-expect-error Accessing private method for testing
      expect(strategy.shouldProcessFile(treeItem, options)).toBe(false);
    });

    it("should respect include patterns", () => {
      const optionsWithInclude = {
        ...options,
        includePatterns: ["*.md", "src/**"],
      };

      expect(
        // @ts-expect-error Accessing private method for testing
        strategy.shouldProcessFile(
          { path: "README.md", type: "blob" as const, sha: "abc", url: "" },
          optionsWithInclude,
        ),
      ).toBe(true);
      expect(
        // @ts-expect-error Accessing private method for testing
        strategy.shouldProcessFile(
          { path: "src/index.js", type: "blob" as const, sha: "def", url: "" },
          optionsWithInclude,
        ),
      ).toBe(true);
      expect(
        // @ts-expect-error Accessing private method for testing
        strategy.shouldProcessFile(
          { path: "package.json", type: "blob" as const, sha: "ghi", url: "" },
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
          { path: "src/index.js", type: "blob" as const, sha: "abc", url: "" },
          optionsWithExclude,
        ),
      ).toBe(true);
      expect(
        // @ts-expect-error Accessing private method for testing
        strategy.shouldProcessFile(
          { path: "src/index.test.js", type: "blob" as const, sha: "def", url: "" },
          optionsWithExclude,
        ),
      ).toBe(false);
      expect(
        // @ts-expect-error Accessing private method for testing
        strategy.shouldProcessFile(
          {
            path: "node_modules/package/index.js",
            type: "blob" as const,
            sha: "ghi",
            url: "",
          },
          optionsWithExclude,
        ),
      ).toBe(false);
    });
  });

  describe("isWithinSubPath", () => {
    it("should return true when no subPath is specified", () => {
      // @ts-expect-error Accessing private method for testing
      expect(strategy.isWithinSubPath("any/path", undefined)).toBe(true);
      // @ts-expect-error Accessing private method for testing
      expect(strategy.isWithinSubPath("any/path", "")).toBe(true);
    });

    it("should return true for exact subPath match", () => {
      // @ts-expect-error Accessing private method for testing
      expect(strategy.isWithinSubPath("docs", "docs")).toBe(true);
      // @ts-expect-error Accessing private method for testing
      expect(strategy.isWithinSubPath("src/lib", "src/lib")).toBe(true);
    });

    it("should return true for paths within subPath", () => {
      // @ts-expect-error Accessing private method for testing
      expect(strategy.isWithinSubPath("docs/guide.md", "docs")).toBe(true);
      // @ts-expect-error Accessing private method for testing
      expect(strategy.isWithinSubPath("src/lib/index.js", "src/lib")).toBe(true);
    });

    it("should return false for paths outside subPath", () => {
      // @ts-expect-error Accessing private method for testing
      expect(strategy.isWithinSubPath("README.md", "docs")).toBe(false);
      // @ts-expect-error Accessing private method for testing
      expect(strategy.isWithinSubPath("src/index.js", "docs")).toBe(false);
    });

    it("should handle trailing slashes correctly", () => {
      // @ts-expect-error Accessing private method for testing
      expect(strategy.isWithinSubPath("docs/guide.md", "docs/")).toBe(true);
      // @ts-expect-error Accessing private method for testing
      expect(strategy.isWithinSubPath("docs/guide.md", "/docs")).toBe(true);
      // @ts-expect-error Accessing private method for testing
      expect(strategy.isWithinSubPath("docs/guide.md", "/docs/")).toBe(true);
    });
  });

  describe("processItem", () => {
    const options: ScraperOptions = {
      url: "https://github.com/owner/repo",
      library: "test-lib",
      version: "1.0.0",
    };

    beforeEach(() => {
      // Mock default branch fetch
      httpFetcherInstance.fetch.mockImplementation((url: string) => {
        if (url.includes("api.github.com/repos/") && !url.includes("/git/trees/")) {
          return Promise.resolve({
            content: JSON.stringify({ default_branch: "main" }),
            mimeType: "application/json",
            source: url,
            charset: "utf-8",
            status: FetchStatus.SUCCESS,
          });
        }
        if (url.includes("/git/trees/")) {
          return Promise.resolve({
            content: JSON.stringify({
              sha: "tree123",
              url: "https://api.github.com/repos/owner/repo/git/trees/tree123",
              tree: [
                {
                  path: "README.md",
                  type: "blob",
                  sha: "abc123",
                  size: 1024,
                  url: "...",
                },
                {
                  path: "src/index.js",
                  type: "blob",
                  sha: "def456",
                  size: 512,
                  url: "...",
                },
                {
                  path: "image.png",
                  type: "blob",
                  sha: "ghi789",
                  size: 2048,
                  url: "...",
                },
              ],
              truncated: false,
            }),
            mimeType: "application/json",
            source: url,
            charset: "utf-8",
            status: FetchStatus.SUCCESS,
          });
        }
        return Promise.resolve({
          content: "file content",
          mimeType: "text/plain",
          source: url,
          charset: "utf-8",
          status: FetchStatus.SUCCESS,
        });
      });
    });

    it("should discover files and return HTTPS blob URLs", async () => {
      const item = { url: "https://github.com/owner/repo", depth: 0 };
      const result = await strategy.processItem(item, options);

      expect(result.status).toBe(FetchStatus.SUCCESS);
      expect(result.links).toContain("https://github.com/owner/repo/blob/main/README.md");
      expect(result.links).toContain(
        "https://github.com/owner/repo/blob/main/src/index.js",
      );
      expect(result.links).not.toContain(
        "https://github.com/owner/repo/blob/main/image.png",
      );
    });

    it("should return empty links for non-depth-0 items", async () => {
      const item = { url: "https://github.com/owner/repo", depth: 1 };
      const result = await strategy.processItem(item, options);

      expect(result.status).toBe(FetchStatus.SUCCESS);
      expect(result.links).toEqual([]);
    });

    it("should handle single blob file URLs with strict scoping", async () => {
      const blobOptions = {
        ...options,
        url: "https://github.com/owner/repo/blob/main/README.md",
      };
      const item = { url: "https://github.com/owner/repo/blob/main/README.md", depth: 0 };
      const result = await strategy.processItem(item, blobOptions);

      expect(result.status).toBe(FetchStatus.SUCCESS);
      // Strict scoping: blob URL should index ONLY that file, not discover wiki
      expect(result.links).toEqual(["https://github.com/owner/repo/blob/main/README.md"]);
    });
  });
});
