import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressCallback } from "../../types";
import type { ScraperProgressEvent } from "../types";
import { GitHubRepoScraperStrategy } from "./GitHubRepoScraperStrategy";
import { GitHubScraperStrategy } from "./GitHubScraperStrategy";
import { GitHubWikiScraperStrategy } from "./GitHubWikiScraperStrategy";

// Mock the underlying strategies
vi.mock("./GitHubRepoScraperStrategy");
vi.mock("./GitHubWikiScraperStrategy");

const mockRepoStrategy = vi.mocked(GitHubRepoScraperStrategy);
const mockWikiStrategy = vi.mocked(GitHubWikiScraperStrategy);

describe("GitHubScraperStrategy", () => {
  let strategy: GitHubScraperStrategy;
  let repoStrategyInstance: any;
  let wikiStrategyInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup repo strategy mock
    repoStrategyInstance = {
      canHandle: vi.fn(),
      scrape: vi.fn(),
      cleanup: vi.fn(),
    };
    mockRepoStrategy.mockImplementation(() => repoStrategyInstance);

    // Setup wiki strategy mock
    wikiStrategyInstance = {
      canHandle: vi.fn(),
      scrape: vi.fn(),
      cleanup: vi.fn(),
    };
    mockWikiStrategy.mockImplementation(() => wikiStrategyInstance);

    strategy = new GitHubScraperStrategy();
  });

  describe("canHandle", () => {
    it("should handle base GitHub repository URLs", () => {
      expect(strategy.canHandle("https://github.com/owner/repo")).toBe(true);
      expect(strategy.canHandle("https://github.com/owner/repo/")).toBe(true);
      expect(strategy.canHandle("https://www.github.com/owner/repo")).toBe(true);
    });

    it("should not handle GitHub URLs with specific paths", () => {
      expect(strategy.canHandle("https://github.com/owner/repo/wiki")).toBe(false);
      expect(strategy.canHandle("https://github.com/owner/repo/wiki/Home")).toBe(false);
      expect(strategy.canHandle("https://github.com/owner/repo/tree/main")).toBe(false);
      expect(
        strategy.canHandle("https://github.com/owner/repo/blob/main/README.md"),
      ).toBe(false);
      expect(strategy.canHandle("https://github.com/owner/repo/issues")).toBe(false);
    });

    it("should not handle non-GitHub URLs", () => {
      expect(strategy.canHandle("https://gitlab.com/owner/repo")).toBe(false);
      expect(strategy.canHandle("https://bitbucket.org/owner/repo")).toBe(false);
      expect(strategy.canHandle("https://example.com")).toBe(false);
    });

    it("should not handle invalid URLs", () => {
      expect(strategy.canHandle("invalid-url")).toBe(false);
      expect(strategy.canHandle("")).toBe(false);
    });
  });

  // Note: shouldProcessUrl is a protected method that delegates to underlying strategies,
  // but it's mainly used internally. The most important behavior is tested via the scrape() method.

  describe("scrape", () => {
    it("should orchestrate both repo and wiki scraping", async () => {
      const options = {
        url: "https://github.com/owner/repo",
        library: "test-lib",
        version: "1.0.0",
      };

      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      repoStrategyInstance.scrape.mockResolvedValue(undefined);
      wikiStrategyInstance.scrape.mockResolvedValue(undefined);

      await strategy.scrape(options, progressCallback);

      // Should scrape wiki first (prioritized)
      expect(wikiStrategyInstance.scrape).toHaveBeenCalledWith(
        expect.objectContaining({
          ...options,
          url: "https://github.com/owner/repo/wiki",
        }),
        expect.any(Function),
        undefined,
      );

      // Should then scrape repository with adjusted maxPages
      expect(repoStrategyInstance.scrape).toHaveBeenCalledWith(
        expect.objectContaining({
          ...options,
          maxPages: 1000, // Default maxPages since no wiki pages were scraped in mock
        }),
        expect.any(Function),
        undefined,
      );
    });

    it("should handle wiki scraping failure gracefully", async () => {
      const options = {
        url: "https://github.com/owner/repo",
        library: "test-lib",
        version: "1.0.0",
      };

      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      repoStrategyInstance.scrape.mockResolvedValue(undefined);
      wikiStrategyInstance.scrape.mockRejectedValue(new Error("Wiki not found"));

      // Should not throw error when wiki fails
      await expect(strategy.scrape(options, progressCallback)).resolves.toBeUndefined();

      expect(repoStrategyInstance.scrape).toHaveBeenCalled();
      expect(wikiStrategyInstance.scrape).toHaveBeenCalled();
    });

    it("should validate GitHub URLs", async () => {
      const options = {
        url: "https://example.com/owner/repo",
        library: "test-lib",
        version: "1.0.0",
      };

      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      await expect(strategy.scrape(options, progressCallback)).rejects.toThrow(
        "URL must be a GitHub URL",
      );
    });

    it("should validate repository URL format", async () => {
      const options = {
        url: "https://github.com/owner/repo/tree/main",
        library: "test-lib",
        version: "1.0.0",
      };

      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      await expect(strategy.scrape(options, progressCallback)).rejects.toThrow(
        "URL must be a base GitHub repository URL",
      );
    });
  });

  describe("cleanup", () => {
    it("should cleanup both underlying strategies", async () => {
      await strategy.cleanup();

      expect(repoStrategyInstance.cleanup).toHaveBeenCalled();
      expect(wikiStrategyInstance.cleanup).toHaveBeenCalled();
    });
  });
});
