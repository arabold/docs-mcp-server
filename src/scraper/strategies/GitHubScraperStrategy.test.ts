import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../utils/config";
import { ScraperError } from "../../utils/errors";
import { FetchStatus, HttpFetcher } from "../fetcher";
import type { ScraperOptions } from "../types";
import { GitHubScraperStrategy } from "./GitHubScraperStrategy";

// Mock the dependencies
vi.mock("../fetcher");

const mockHttpFetcher = vi.mocked(HttpFetcher);

describe("GitHubScraperStrategy", () => {
  let strategy: GitHubScraperStrategy;
  let httpFetcherInstance: any;
  const appConfig = loadConfig();

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup fetcher mock
    httpFetcherInstance = {
      fetch: vi.fn(),
    };
    mockHttpFetcher.mockImplementation(() => httpFetcherInstance);

    strategy = new GitHubScraperStrategy(appConfig);
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

    it("should handle legacy github-file:// URLs", () => {
      expect(strategy.canHandle("github-file://src/cli/types.ts")).toBe(true);
      expect(strategy.canHandle("github-file://README.md")).toBe(true);
      expect(strategy.canHandle("github-file://src/index.js")).toBe(true);
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

    it("should mark legacy github-file:// URLs as NOT_FOUND", async () => {
      const item = { url: "github-file://src/cli/types.ts", depth: 1 };
      const result = await strategy.processItem(item, options);

      expect(result.status).toBe(FetchStatus.NOT_FOUND);
      expect(result.links).toEqual([]);
      expect(result.url).toBe("github-file://src/cli/types.ts");
    });

    it("should mark legacy github-file:// URLs as NOT_FOUND at any depth", async () => {
      const item0 = { url: "github-file://README.md", depth: 0 };
      const result0 = await strategy.processItem(item0, options);
      expect(result0.status).toBe(FetchStatus.NOT_FOUND);

      const item2 = { url: "github-file://src/index.js", depth: 2 };
      const result2 = await strategy.processItem(item2, options);
      expect(result2.status).toBe(FetchStatus.NOT_FOUND);
    });

    it("should throw user-friendly error when repository info fetch returns NOT_FOUND", async () => {
      // Mock repo info API returning NOT_FOUND (private repo without auth)
      // This tests the bug fix where we detect inaccessible repos early
      httpFetcherInstance.fetch.mockImplementation((url: string) => {
        if (url.includes("api.github.com/repos/") && !url.includes("/git/trees/")) {
          return Promise.resolve({
            content: Buffer.from(""),
            mimeType: "application/json",
            source: url,
            status: FetchStatus.NOT_FOUND,
          });
        }
        // Tree API should not be called if repo info fails
        return Promise.resolve({
          content: "",
          mimeType: "text/plain",
          source: url,
          status: FetchStatus.NOT_FOUND,
        });
      });

      const item = { url: "https://github.com/owner/repo", depth: 0 };

      await expect(strategy.processItem(item, options)).rejects.toThrow(
        /Repository "owner\/repo" not found or not accessible/,
      );
      await expect(strategy.processItem(item, options)).rejects.toThrow(/GITHUB_TOKEN/);
    });

    it("should throw user-friendly error when tree API returns NOT_FOUND", async () => {
      // Mock repo info succeeds but tree API returns NOT_FOUND
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
            content: Buffer.from(""),
            mimeType: "application/json",
            source: url,
            status: FetchStatus.NOT_FOUND,
          });
        }
        return Promise.resolve({
          content: "",
          mimeType: "text/plain",
          source: url,
          status: FetchStatus.NOT_FOUND,
        });
      });

      const item = { url: "https://github.com/owner/repo", depth: 0 };

      await expect(strategy.processItem(item, options)).rejects.toThrow(
        /Repository "owner\/repo" not found or not accessible/,
      );
      await expect(strategy.processItem(item, options)).rejects.toThrow(/GITHUB_TOKEN/);
    });

    it("should throw user-friendly error when JSON parsing fails", async () => {
      // Mock tree API returning invalid JSON
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
            content: "not valid json {{{",
            mimeType: "application/json",
            source: url,
            status: FetchStatus.SUCCESS,
          });
        }
        return Promise.resolve({
          content: "",
          mimeType: "text/plain",
          source: url,
          status: FetchStatus.SUCCESS,
        });
      });

      const item = { url: "https://github.com/owner/repo", depth: 0 };

      await expect(strategy.processItem(item, options)).rejects.toThrow(
        /Failed to parse GitHub API response/,
      );
    });

    it("should pass headers to httpFetcher.fetch calls", async () => {
      const optionsWithHeaders = {
        ...options,
        headers: { Authorization: "Bearer test-token" },
      };
      const item = { url: "https://github.com/owner/repo", depth: 0 };

      await strategy.processItem(item, optionsWithHeaders);

      // Verify headers were passed to the fetch calls
      const fetchCalls = httpFetcherInstance.fetch.mock.calls;
      expect(fetchCalls.length).toBeGreaterThan(0);

      // Check that at least one API call includes the headers
      const apiCalls = fetchCalls.filter((call: unknown[]) =>
        (call[0] as string).includes("api.github.com"),
      );
      expect(apiCalls.length).toBeGreaterThan(0);

      // The headers should be passed in the options object
      for (const call of apiCalls) {
        expect(call[1]).toHaveProperty("headers");
        expect(call[1].headers).toHaveProperty("Authorization", "Bearer test-token");
      }
    });

    it("should throw user-friendly error when authentication fails (401)", async () => {
      // Mock repo info API throwing 401 error (invalid/expired token)
      httpFetcherInstance.fetch.mockImplementation((url: string) => {
        if (url.includes("api.github.com/repos/")) {
          return Promise.reject(
            new ScraperError(
              "Failed to fetch https://api.github.com/repos/owner/repo after 1 attempts: Request failed with status code 401",
              true,
            ),
          );
        }
        return Promise.resolve({
          content: "",
          mimeType: "text/plain",
          source: url,
          status: FetchStatus.SUCCESS,
        });
      });

      const item = { url: "https://github.com/owner/repo", depth: 0 };

      await expect(strategy.processItem(item, options)).rejects.toThrow(
        /GitHub authentication failed/,
      );
      await expect(strategy.processItem(item, options)).rejects.toThrow(
        /invalid or expired/,
      );
    });

    it("should throw user-friendly error when access is denied (403)", async () => {
      // Mock repo info API throwing 403 error (forbidden/rate-limited)
      httpFetcherInstance.fetch.mockImplementation((url: string) => {
        if (url.includes("api.github.com/repos/")) {
          return Promise.reject(
            new ScraperError(
              "Failed to fetch https://api.github.com/repos/owner/repo after 1 attempts: Request failed with status code 403",
              true,
            ),
          );
        }
        return Promise.resolve({
          content: "",
          mimeType: "text/plain",
          source: url,
          status: FetchStatus.SUCCESS,
        });
      });

      const item = { url: "https://github.com/owner/repo", depth: 0 };

      await expect(strategy.processItem(item, options)).rejects.toThrow(
        /GitHub access denied/,
      );
      await expect(strategy.processItem(item, options)).rejects.toThrow(
        /permissions|rate-limited/,
      );
    });
  });
});
