import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpFetcher } from "../fetcher";
import type { RawContent } from "../fetcher/types";
import { HtmlPipeline } from "../pipelines/HtmlPipeline";
import { MarkdownPipeline } from "../pipelines/MarkdownPipeline";
import { ScrapeMode, type ScraperOptions } from "../types";
import { GitHubWikiScraperStrategy } from "./GitHubWikiScraperStrategy";

// Mock the fetcher and pipelines
vi.mock("../fetcher");
vi.mock("../pipelines/HtmlPipeline");
vi.mock("../pipelines/MarkdownPipeline");

const mockHttpFetcher = vi.mocked(HttpFetcher);
const mockHtmlPipeline = vi.mocked(HtmlPipeline);
const mockMarkdownPipeline = vi.mocked(MarkdownPipeline);

describe("GitHubWikiScraperStrategy", () => {
  let strategy: GitHubWikiScraperStrategy;
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
    };
    markdownPipelineInstance = {
      canProcess: vi.fn(),
      process: vi.fn(),
    };
    mockHtmlPipeline.mockImplementation(() => htmlPipelineInstance);
    mockMarkdownPipeline.mockImplementation(() => markdownPipelineInstance);

    strategy = new GitHubWikiScraperStrategy();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("canHandle", () => {
    it("should handle GitHub wiki URLs", () => {
      expect(strategy.canHandle("https://github.com/owner/repo/wiki")).toBe(true);
      expect(strategy.canHandle("https://github.com/owner/repo/wiki/")).toBe(true);
      expect(strategy.canHandle("https://github.com/owner/repo/wiki/Home")).toBe(true);
      expect(
        strategy.canHandle("https://github.com/owner/repo/wiki/Getting-Started"),
      ).toBe(true);
      expect(strategy.canHandle("https://www.github.com/owner/repo/wiki/API")).toBe(true);
    });

    it("should not handle non-wiki GitHub URLs", () => {
      expect(strategy.canHandle("https://github.com/owner/repo")).toBe(false);
      expect(strategy.canHandle("https://github.com/owner/repo/tree/main")).toBe(false);
      expect(
        strategy.canHandle("https://github.com/owner/repo/blob/main/README.md"),
      ).toBe(false);
      expect(strategy.canHandle("https://github.com/owner/repo/issues")).toBe(false);
    });

    it("should not handle non-GitHub URLs", () => {
      expect(strategy.canHandle("https://example.com/wiki")).toBe(false);
      expect(strategy.canHandle("https://gitlab.com/owner/repo/wiki")).toBe(false);
      expect(strategy.canHandle("https://bitbucket.org/owner/repo/wiki")).toBe(false);
    });

    it("should handle malformed URLs gracefully", () => {
      expect(strategy.canHandle("invalid-url")).toBe(false);
      expect(strategy.canHandle("")).toBe(false);
      expect(strategy.canHandle("not-a-url-at-all")).toBe(false);
    });
  });

  describe("parseGitHubWikiUrl", () => {
    it("should parse basic wiki URL", () => {
      const result = (strategy as any).parseGitHubWikiUrl(
        "https://github.com/owner/repo/wiki",
      );
      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse wiki URL with trailing slash", () => {
      const result = (strategy as any).parseGitHubWikiUrl(
        "https://github.com/owner/repo/wiki/",
      );
      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse wiki URL with specific page", () => {
      const result = (strategy as any).parseGitHubWikiUrl(
        "https://github.com/owner/repo/wiki/Home",
      );
      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse wiki URL with complex page name", () => {
      const result = (strategy as any).parseGitHubWikiUrl(
        "https://github.com/owner/repo/wiki/Getting-Started-Guide",
      );
      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("should handle www subdomain", () => {
      const result = (strategy as any).parseGitHubWikiUrl(
        "https://www.github.com/owner/repo/wiki",
      );
      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("should throw error for invalid wiki URL", () => {
      expect(() => {
        (strategy as any).parseGitHubWikiUrl("https://github.com/invalid");
      }).toThrow("Invalid GitHub wiki URL");

      expect(() => {
        (strategy as any).parseGitHubWikiUrl("https://github.com/owner/repo");
      }).toThrow("Invalid GitHub wiki URL");
    });
  });

  describe("shouldProcessUrl", () => {
    const options: ScraperOptions = {
      url: "https://github.com/owner/repo/wiki",
      library: "test-lib",
      version: "1.0.0",
    };

    it("should process URLs within the same wiki", () => {
      expect(
        (strategy as any).shouldProcessUrl(
          "https://github.com/owner/repo/wiki/Home",
          options,
        ),
      ).toBe(true);
      expect(
        (strategy as any).shouldProcessUrl(
          "https://github.com/owner/repo/wiki/API",
          options,
        ),
      ).toBe(true);
      expect(
        (strategy as any).shouldProcessUrl(
          "https://github.com/owner/repo/wiki/Getting-Started",
          options,
        ),
      ).toBe(true);
    });

    it("should not process URLs outside the wiki", () => {
      expect(
        (strategy as any).shouldProcessUrl("https://github.com/owner/repo", options),
      ).toBe(false);
      expect(
        (strategy as any).shouldProcessUrl(
          "https://github.com/owner/repo/tree/main",
          options,
        ),
      ).toBe(false);
      expect(
        (strategy as any).shouldProcessUrl(
          "https://github.com/other/repo/wiki/Home",
          options,
        ),
      ).toBe(false);
    });

    it("should respect include patterns", () => {
      const optionsWithInclude = {
        ...options,
        includePatterns: ["API*", "Getting*"],
      };

      expect(
        (strategy as any).shouldProcessUrl(
          "https://github.com/owner/repo/wiki/API-Reference",
          optionsWithInclude,
        ),
      ).toBe(true);
      expect(
        (strategy as any).shouldProcessUrl(
          "https://github.com/owner/repo/wiki/Getting-Started",
          optionsWithInclude,
        ),
      ).toBe(true);
      expect(
        (strategy as any).shouldProcessUrl(
          "https://github.com/owner/repo/wiki/Home",
          optionsWithInclude,
        ),
      ).toBe(false);
    });

    it("should respect exclude patterns", () => {
      const optionsWithExclude = {
        ...options,
        excludePatterns: ["*deprecated*", "old-*"],
      };

      expect(
        (strategy as any).shouldProcessUrl(
          "https://github.com/owner/repo/wiki/deprecated-api",
          optionsWithExclude,
        ),
      ).toBe(false);
      expect(
        (strategy as any).shouldProcessUrl(
          "https://github.com/owner/repo/wiki/old-guide",
          optionsWithExclude,
        ),
      ).toBe(false);
      expect(
        (strategy as any).shouldProcessUrl(
          "https://github.com/owner/repo/wiki/current-guide",
          optionsWithExclude,
        ),
      ).toBe(true);
    });

    it("should handle Home page as default", () => {
      expect(
        (strategy as any).shouldProcessUrl("https://github.com/owner/repo/wiki", options),
      ).toBe(true);
      expect(
        (strategy as any).shouldProcessUrl(
          "https://github.com/owner/repo/wiki/",
          options,
        ),
      ).toBe(true);
    });

    it("should handle malformed URLs gracefully", () => {
      expect((strategy as any).shouldProcessUrl("invalid-url", options)).toBe(false);
      expect((strategy as any).shouldProcessUrl("", options)).toBe(false);
    });
  });

  describe("processItem", () => {
    const options: ScraperOptions = {
      url: "https://github.com/owner/repo/wiki",
      library: "test-lib",
      version: "1.0.0",
    };

    it("should process wiki page and return document with links", async () => {
      const rawContent: RawContent = {
        content: `
          <!DOCTYPE html>
          <html>
            <head><title>Wiki Home</title></head>
            <body>
              <h1>Welcome to the Wiki</h1>
              <p>This is the home page of our documentation.</p>
              <ul>
                <li><a href="/owner/repo/wiki/API">API Documentation</a></li>
                <li><a href="/owner/repo/wiki/Getting-Started">Getting Started</a></li>
                <li><a href="https://external.com">External Link</a></li>
              </ul>
            </body>
          </html>
        `,
        mimeType: "text/html",
        source: "https://github.com/owner/repo/wiki/Home",
        charset: "utf-8",
      };

      const processedContent = {
        textContent:
          "Wiki Home\n\nWelcome to the Wiki\n\nThis is the home page of our documentation.",
        metadata: { title: "Wiki Home" },
        errors: [],
        links: [
          "/owner/repo/wiki/API",
          "/owner/repo/wiki/Getting-Started",
          "https://external.com",
        ],
      };

      httpFetcherInstance.fetch.mockResolvedValue(rawContent);
      htmlPipelineInstance.canProcess.mockReturnValue(true);
      htmlPipelineInstance.process.mockResolvedValue(processedContent);

      const item = { url: "https://github.com/owner/repo/wiki/Home", depth: 1 };
      const result = await (strategy as any).processItem(item, options);

      expect(result.document).toEqual({
        content:
          "Wiki Home\n\nWelcome to the Wiki\n\nThis is the home page of our documentation.",
        contentType: "text/html",
        metadata: {
          url: "https://github.com/owner/repo/wiki/Home",
          title: "Wiki Home",
          library: "test-lib",
          version: "1.0.0",
        },
      });

      // Should only include wiki links, not external links
      expect(result.links).toEqual([
        "https://github.com/owner/repo/wiki/API",
        "https://github.com/owner/repo/wiki/Getting-Started",
      ]);
    });

    it("should use page name as title fallback when no title found", async () => {
      const rawContent: RawContent = {
        content: "<html><body><p>Content without title</p></body></html>",
        mimeType: "text/html",
        source: "https://github.com/owner/repo/wiki/Getting-Started",
        charset: "utf-8",
      };

      const processedContent = {
        textContent: "Content without title",
        metadata: { title: "" },
        errors: [],
        links: [],
      };

      httpFetcherInstance.fetch.mockResolvedValue(rawContent);
      htmlPipelineInstance.canProcess.mockReturnValue(true);
      htmlPipelineInstance.process.mockResolvedValue(processedContent);

      const item = {
        url: "https://github.com/owner/repo/wiki/Getting-Started",
        depth: 1,
      };
      const result = await (strategy as any).processItem(item, options);

      expect(result.document?.metadata.title).toBe("Getting-Started");
    });

    it("should handle Home page title fallback", async () => {
      const rawContent: RawContent = {
        content: "<html><body><p>Home page content</p></body></html>",
        mimeType: "text/html",
        source: "https://github.com/owner/repo/wiki",
        charset: "utf-8",
      };

      const processedContent = {
        textContent: "Home page content",
        metadata: { title: "" },
        errors: [],
        links: [],
      };

      httpFetcherInstance.fetch.mockResolvedValue(rawContent);
      htmlPipelineInstance.canProcess.mockReturnValue(true);
      htmlPipelineInstance.process.mockResolvedValue(processedContent);

      const item = { url: "https://github.com/owner/repo/wiki", depth: 1 };
      const result = await (strategy as any).processItem(item, options);

      expect(result.document?.metadata.title).toBe("Home");
    });

    it("should force ScrapeMode.Fetch for consistent behavior", async () => {
      const rawContent: RawContent = {
        content: "<html><body><h1>Test</h1></body></html>",
        mimeType: "text/html",
        source: "https://github.com/owner/repo/wiki/Test",
        charset: "utf-8",
      };

      const processedContent = {
        textContent: "Test",
        metadata: { title: "Test" },
        errors: [],
        links: [],
      };

      httpFetcherInstance.fetch.mockResolvedValue(rawContent);
      htmlPipelineInstance.canProcess.mockReturnValue(true);
      htmlPipelineInstance.process.mockImplementation(
        async (_content: any, opts: any) => {
          expect(opts.scrapeMode).toBe("fetch");
          return processedContent;
        },
      );

      const optionsWithPlaywright = {
        ...options,
        scrapeMode: ScrapeMode.Playwright,
      };

      const item = { url: "https://github.com/owner/repo/wiki/Test", depth: 1 };
      await (strategy as any).processItem(item, optionsWithPlaywright);

      expect(htmlPipelineInstance.process).toHaveBeenCalledWith(
        rawContent,
        expect.objectContaining({ scrapeMode: "fetch" }),
        expect.any(Object),
      );
    });

    it("should handle unsupported content types", async () => {
      const rawContent: RawContent = {
        content: "binary content",
        mimeType: "application/octet-stream",
        source: "https://github.com/owner/repo/wiki/Binary",
        charset: "utf-8",
      };

      httpFetcherInstance.fetch.mockResolvedValue(rawContent);
      htmlPipelineInstance.canProcess.mockReturnValue(false);
      markdownPipelineInstance.canProcess.mockReturnValue(false);

      const item = { url: "https://github.com/owner/repo/wiki/Binary", depth: 1 };
      const result = await (strategy as any).processItem(item, options);

      expect(result.document).toBeUndefined();
      expect(result.links).toEqual([]);
    });

    it("should handle fetch errors gracefully", async () => {
      httpFetcherInstance.fetch.mockRejectedValue(new Error("Network error"));

      const item = { url: "https://github.com/owner/repo/wiki/Unreachable", depth: 1 };
      const result = await (strategy as any).processItem(item, options);

      expect(result.document).toBeUndefined();
      expect(result.links).toEqual([]);
    });

    it("should handle processing errors from pipelines", async () => {
      const rawContent: RawContent = {
        content: "<html><body><h1>Test</h1></body></html>",
        mimeType: "text/html",
        source: "https://github.com/owner/repo/wiki/Test",
        charset: "utf-8",
      };

      const processedContentWithErrors = {
        textContent: "Test",
        metadata: { title: "Test" },
        errors: [new Error("Processing warning")],
        links: [],
      };

      httpFetcherInstance.fetch.mockResolvedValue(rawContent);
      htmlPipelineInstance.canProcess.mockReturnValue(true);
      htmlPipelineInstance.process.mockResolvedValue(processedContentWithErrors);

      const item = { url: "https://github.com/owner/repo/wiki/Test", depth: 1 };
      const result = await (strategy as any).processItem(item, options);

      expect(result.document).toBeDefined();
      expect(result.document?.content).toBe("Test");
    });
  });

  describe("scrape", () => {
    it("should validate GitHub wiki URL", async () => {
      const invalidOptions: ScraperOptions = {
        url: "https://example.com/wiki",
        library: "test-lib",
        version: "1.0.0",
      };

      await expect(strategy.scrape(invalidOptions, vi.fn())).rejects.toThrow(
        "URL must be a GitHub wiki URL",
      );
    });

    it("should validate GitHub URL without wiki path", async () => {
      const invalidOptions: ScraperOptions = {
        url: "https://github.com/owner/repo",
        library: "test-lib",
        version: "1.0.0",
      };

      await expect(strategy.scrape(invalidOptions, vi.fn())).rejects.toThrow(
        "URL must be a GitHub wiki URL",
      );
    });

    it("should append /Home to bare wiki URLs", async () => {
      const options: ScraperOptions = {
        url: "https://github.com/owner/repo/wiki",
        library: "test-lib",
        version: "1.0.0",
      };

      // Mock super.scrape to capture the options passed to it
      const superScrapeSpy = vi.spyOn(
        Object.getPrototypeOf(Object.getPrototypeOf(strategy)),
        "scrape",
      );
      superScrapeSpy.mockResolvedValue(undefined);

      await strategy.scrape(options, vi.fn());

      expect(superScrapeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://github.com/owner/repo/wiki/Home",
        }),
        expect.any(Function),
        undefined,
      );

      superScrapeSpy.mockRestore();
    });

    it("should append /Home to wiki URLs with trailing slash", async () => {
      const options: ScraperOptions = {
        url: "https://github.com/owner/repo/wiki/",
        library: "test-lib",
        version: "1.0.0",
      };

      const superScrapeSpy = vi.spyOn(
        Object.getPrototypeOf(Object.getPrototypeOf(strategy)),
        "scrape",
      );
      superScrapeSpy.mockResolvedValue(undefined);

      await strategy.scrape(options, vi.fn());

      expect(superScrapeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://github.com/owner/repo/wiki/Home",
        }),
        expect.any(Function),
        undefined,
      );

      superScrapeSpy.mockRestore();
    });

    it("should not modify URLs that already point to specific pages", async () => {
      const options: ScraperOptions = {
        url: "https://github.com/owner/repo/wiki/Getting-Started",
        library: "test-lib",
        version: "1.0.0",
      };

      const superScrapeSpy = vi.spyOn(
        Object.getPrototypeOf(Object.getPrototypeOf(strategy)),
        "scrape",
      );
      superScrapeSpy.mockResolvedValue(undefined);

      await strategy.scrape(options, vi.fn());

      expect(superScrapeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://github.com/owner/repo/wiki/Getting-Started",
        }),
        expect.any(Function),
        undefined,
      );

      superScrapeSpy.mockRestore();
    });
  });

  describe("Link filtering and URL normalization", () => {
    const options: ScraperOptions = {
      url: "https://github.com/owner/repo/wiki",
      library: "test-lib",
      version: "1.0.0",
    };

    it("should convert relative links to absolute URLs", async () => {
      const rawContent: RawContent = {
        content: `
          <html><body>
            <a href="/owner/repo/wiki/API">API Docs</a>
            <a href="Getting-Started">Getting Started</a>
            <a href="./Advanced-Topics">Advanced</a>
          </body></html>
        `,
        mimeType: "text/html",
        source: "https://github.com/owner/repo/wiki/Home",
        charset: "utf-8",
      };

      const processedContent = {
        textContent: "Content",
        metadata: { title: "Test" },
        errors: [],
        links: ["/owner/repo/wiki/API", "Getting-Started", "./Advanced-Topics"],
      };

      httpFetcherInstance.fetch.mockResolvedValue(rawContent);
      htmlPipelineInstance.canProcess.mockReturnValue(true);
      htmlPipelineInstance.process.mockResolvedValue(processedContent);

      const item = { url: "https://github.com/owner/repo/wiki/Home", depth: 1 };
      const result = await (strategy as any).processItem(item, options);

      expect(result.links).toEqual([
        "https://github.com/owner/repo/wiki/API",
        "https://github.com/owner/repo/wiki/Getting-Started",
        "https://github.com/owner/repo/wiki/Advanced-Topics",
      ]);
    });

    it("should filter out non-wiki links", async () => {
      const rawContent: RawContent = {
        content: "<html><body>Content</body></html>",
        mimeType: "text/html",
        source: "https://github.com/owner/repo/wiki/Home",
        charset: "utf-8",
      };

      const processedContent = {
        textContent: "Content",
        metadata: { title: "Test" },
        errors: [],
        links: [
          "https://github.com/owner/repo/wiki/API", // Should include
          "https://github.com/owner/repo", // Should exclude (not wiki)
          "https://github.com/other/repo/wiki/Home", // Should exclude (different repo)
          "https://external.com/wiki", // Should exclude (external domain)
          "mailto:test@example.com", // Should exclude (different protocol)
        ],
      };

      httpFetcherInstance.fetch.mockResolvedValue(rawContent);
      htmlPipelineInstance.canProcess.mockReturnValue(true);
      htmlPipelineInstance.process.mockResolvedValue(processedContent);

      const item = { url: "https://github.com/owner/repo/wiki/Home", depth: 1 };
      const result = await (strategy as any).processItem(item, options);

      expect(result.links).toEqual(["https://github.com/owner/repo/wiki/API"]);
    });

    it("should handle malformed URLs in links gracefully", async () => {
      const rawContent: RawContent = {
        content: "<html><body>Content</body></html>",
        mimeType: "text/html",
        source: "https://github.com/owner/repo/wiki/Home",
        charset: "utf-8",
      };

      const processedContent = {
        textContent: "Content",
        metadata: { title: "Test" },
        errors: [],
        links: [
          "invalid-url",
          "https://github.com/owner/repo/wiki/Valid",
          "",
          "not-a-url-at-all",
        ],
      };

      httpFetcherInstance.fetch.mockResolvedValue(rawContent);
      htmlPipelineInstance.canProcess.mockReturnValue(true);
      htmlPipelineInstance.process.mockResolvedValue(processedContent);

      const item = { url: "https://github.com/owner/repo/wiki/Home", depth: 1 };
      const result = await (strategy as any).processItem(item, options);

      // Should only include the valid wiki link
      expect(result.links).toEqual(["https://github.com/owner/repo/wiki/Valid"]);
    });
  });
});
