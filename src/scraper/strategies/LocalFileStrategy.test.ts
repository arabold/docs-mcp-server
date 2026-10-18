import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressCallback } from "../../types";
import { loadConfig } from "../../utils/config";
import {
  PageOutcome,
  type ScrapeResult,
  type ScraperOptions,
  type ScraperProgressEvent,
} from "../types";
import { LocalFileStrategy } from "./LocalFileStrategy";

/**
 * Progress events that produced stored content.
 *
 * Every dequeued item now reports an outcome, including directories and files
 * that yield nothing, so a raw callback count no longer equals the number of
 * documents indexed.
 */
const storedCalls = (cb: { mock: { calls: [ScraperProgressEvent][] } }) =>
  cb.mock.calls.filter(([event]) => event.outcome === PageOutcome.Stored);

vi.mock("node:fs/promises", () => ({ default: vol.promises }));
vi.mock("node:fs");

describe("LocalFileStrategy", () => {
  const appConfig = {
    ...loadConfig(),
    scraper: {
      ...loadConfig().scraper,
      security: {
        ...loadConfig().scraper.security,
        fileAccess: {
          ...loadConfig().scraper.security.fileAccess,
          mode: "unrestricted" as const,
          allowedRoots: [],
        },
      },
    },
  };

  beforeEach(() => {
    vol.reset();
  });

  it("should process a single file", async () => {
    const strategy = new LocalFileStrategy(appConfig);
    const options: ScraperOptions = {
      url: "file:///test.md",
      library: "test",
      version: "1.0",
      maxPages: 1,
      maxDepth: 0,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    vol.fromJSON(
      {
        "/test.md": "# Test\n\nThis is a test file.",
      },
      "/",
    );

    await strategy.scrape(options, progressCallback);

    expect(storedCalls(progressCallback)).toHaveLength(1);

    const firstCall = progressCallback.mock.calls[0][0];
    expect(firstCall).toMatchObject({
      pagesScraped: 1,
      currentUrl: "file:///test.md",
      depth: 0,
      maxDepth: 0,
      totalPages: 1,
      totalDiscovered: 1,
      pageId: undefined,
      result: {
        textContent: "# Test\n\nThis is a test file.",
        sourceContentType: "text/markdown",
        contentType: "text/markdown",
        url: "file:///test.md",
        title: "Test",
        links: [],
        errors: [],
        chunks: [
          {
            content: "# Test\nThis is a test file.", // content is simplified
            section: {
              level: 1,
              path: ["Test"],
            },
            types: ["heading", "text"],
          },
        ],
      },
    } satisfies Partial<ScraperProgressEvent>);
    expect(firstCall.result?.etag).toBeDefined();
    expect(firstCall.result?.lastModified).toBeDefined();
  });

  it("should list directory entries in code-point order whatever order readdir returns", async () => {
    const strategy = new LocalFileStrategy(appConfig);
    const options: ScraperOptions = {
      url: "file:///testdir",
      library: "test",
      version: "1.0",
    };
    vol.fromJSON(
      {
        "/testdir/b.md": "# B",
        "/testdir/_c.md": "# C",
        "/testdir/\u{1F600}.md": "# Emoji",
        "/testdir/a.md": "# a",
        "/testdir/ａ.md": "# Fullwidth a",
        "/testdir/A.md": "# A",
        "/testdir/10.md": "# 10",
        "/testdir/9.md": "# 9",
      },
      "/",
    );
    // memfs lists names sorted, so reverse them to stand in for a platform
    // whose readdir returns another order, such as Windows.
    const readdir = vol.promises.readdir.bind(vol.promises);
    const readdirSpy = vi
      .spyOn(vol.promises, "readdir")
      .mockImplementation(async (dir, opts) =>
        (await readdir(dir, opts)).slice().reverse(),
      );

    try {
      const result = await strategy.processItem(
        { url: "file:///testdir", depth: 0 },
        options,
      );

      // Unlike a locale or case-insensitive comparison, code-point order puts
      // upper case before "_" and "_" before lower case. Unlike UTF-16
      // code-unit order, it puts U+FF41 before the emoji U+1F600.
      const names = result.links?.map((link) =>
        decodeURIComponent(link.slice("file:///testdir/".length)),
      );
      expect(names).toEqual([
        "10.md",
        "9.md",
        "A.md",
        "_c.md",
        "a.md",
        "b.md",
        "ａ.md",
        "\u{1F600}.md",
      ]);
    } finally {
      readdirSpy.mockRestore();
    }
  });

  it("should process different file types in a directory and its subdirectory", async () => {
    const strategy = new LocalFileStrategy(appConfig);
    const options: ScraperOptions = {
      url: "file:///testdir",
      library: "test",
      version: "1.0",
      maxPages: 10,
      maxDepth: 2,
      maxConcurrency: 1,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
    vol.fromJSON(
      {
        "/testdir/file1.md": "# File 1",
        "/testdir/file2.html":
          "<html><head><title>File 2 Title</title></head><body><h1>File 2</h1></body></html>",
        "/testdir/subdir/file3.txt": "File 3",
      },
      "/",
    );

    await strategy.scrape(options, progressCallback);
    // Five queued items — two directories and three files — and all five are
    // processed, so the fraction completes. Only the files produce content.
    expect(progressCallback).toHaveBeenCalledTimes(5);
    const final = progressCallback.mock.calls.at(-1)?.[0];
    expect(final).toMatchObject({ pagesScraped: 5, totalPages: 5, pagesIndexed: 3 });
    expect(progressCallback).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        outcome: PageOutcome.Empty,
        currentUrl: "file:///testdir",
        pagesScraped: 1,
        pagesIndexed: 0,
      } satisfies Partial<ScraperProgressEvent>),
    );

    // Validate .md
    expect(progressCallback).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        pagesScraped: 2,
        pagesIndexed: 1,
        currentUrl: "file:///testdir/file1.md",
        depth: 1,
        maxDepth: 2,
        totalPages: 4,
        totalDiscovered: 4,
        result: expect.objectContaining({
          textContent: "# File 1",
          sourceContentType: "text/markdown",
          contentType: "text/markdown",
          url: "file:///testdir/file1.md",
          title: "File 1",
        } satisfies Partial<ScrapeResult>),
      } satisfies Partial<ScraperProgressEvent>),
    );
    // Validate .html
    expect(progressCallback).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        pagesScraped: 3,
        pagesIndexed: 2,
        currentUrl: "file:///testdir/file2.html",
        depth: 1,
        maxDepth: 2,
        totalPages: 4,
        totalDiscovered: 4,
        result: expect.objectContaining({
          textContent: expect.stringContaining("# File 2"),
          sourceContentType: "text/html",
          contentType: "text/markdown",
          url: "file:///testdir/file2.html",
          title: "File 2 Title",
        } satisfies Partial<ScrapeResult>),
      } satisfies Partial<ScraperProgressEvent>),
    );
    // The subdirectory is listed, and its file is found one level deeper
    expect(progressCallback).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        outcome: PageOutcome.Empty,
        currentUrl: "file:///testdir/subdir",
        depth: 1,
        pagesScraped: 4,
        pagesIndexed: 2,
      } satisfies Partial<ScraperProgressEvent>),
    );
    // Validate .txt
    expect(progressCallback).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        pagesScraped: 5,
        pagesIndexed: 3,
        currentUrl: "file:///testdir/subdir/file3.txt",
        depth: 2,
        maxDepth: 2,
        totalPages: 5,
        totalDiscovered: 5,
        result: expect.objectContaining({
          textContent: "File 3",
          sourceContentType: "text/plain",
          contentType: "text/plain",
          url: "file:///testdir/subdir/file3.txt",
          title: "file3.txt",
        } satisfies Partial<ScrapeResult>),
      } satisfies Partial<ScraperProgressEvent>),
    );
  });

  it("should handle empty files", async () => {
    const strategy = new LocalFileStrategy(appConfig);
    const options: ScraperOptions = {
      url: "file:///testdir",
      library: "test",
      version: "1.0",
      maxPages: 10,
      maxDepth: 1,
      maxConcurrency: 1,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
    vol.fromJSON(
      {
        "/testdir/empty.md": "",
      },
      "/",
    );

    await strategy.scrape(options, progressCallback);

    // An empty file produces no chunks, so the store would drop it. Reporting it
    // as indexed would have inflated the count for a document never written; it
    // is recorded as an empty page instead.
    expect(storedCalls(progressCallback)).toHaveLength(0);
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        // The directory itself is item 1; the file is item 2.
        pagesScraped: 2,
        pagesIndexed: 0,
        currentUrl: "file:///testdir/empty.md",
        outcome: PageOutcome.Empty,
        emptyPage: expect.objectContaining({
          url: "file:///testdir/empty.md",
          contentType: "text/markdown",
          pipelineFailed: false,
        }),
      } satisfies Partial<ScraperProgressEvent>),
    );
  });

  it("should skip binary/unsupported files and only process supported text files", async () => {
    const strategy = new LocalFileStrategy(appConfig);
    const options: ScraperOptions = {
      url: "file:///testdir",
      library: "test",
      version: "1.0",
      maxPages: 10,
      maxDepth: 1,
      maxConcurrency: 1,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
    // Simulate a binary file (with null bytes) and an image file
    vol.fromJSON(
      {
        "/testdir/file1.md": "# File 1", // supported
        "/testdir/file2.png": Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
        ]).toString("binary"), // PNG signature + null bytes
        "/testdir/file3.txt": "File 3", // supported
        "/testdir/file4.bin": Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00]).toString(
          "binary",
        ), // binary with null bytes
        "/testdir/file5.html": "<html><body>File 5</body></html>", // supported
      },
      "/",
    );

    await strategy.scrape(options, progressCallback);
    // Only .md, .txt, and .html should be processed
    expect(storedCalls(progressCallback)).toHaveLength(3);
    const storedUrls = storedCalls(progressCallback).map(([e]) => e.currentUrl);
    expect(storedUrls).toContain("file:///testdir/file1.md");
    expect(storedUrls).toContain("file:///testdir/file3.txt");
    expect(storedUrls).toContain("file:///testdir/file5.html");
    // Binary files are dequeued and reported, but never produce content
    expect(storedUrls).not.toContain("file:///testdir/file2.png");
    expect(storedUrls).not.toContain("file:///testdir/file4.bin");
  });

  it("should respect include and exclude patterns for local crawling", async () => {
    const strategy = new LocalFileStrategy(appConfig);
    const options: ScraperOptions = {
      url: "file:///testdir",
      library: "test",
      version: "1.0",
      maxPages: 10,
      maxDepth: 1,
      includePatterns: ["/file1.md", "/file3.txt"],
      excludePatterns: ["/file3.txt"], // exclude takes precedence
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
    vol.fromJSON(
      {
        "/testdir/file1.md": "# File 1", // should be included
        "/testdir/file2.html": "<html><body>File 2</body></html>", // should be excluded (not in include)
        "/testdir/file3.txt": "File 3", // should be excluded (in exclude)
      },
      "/",
    );
    await strategy.scrape(options, progressCallback);
    // Only file1.md should be processed
    expect(storedCalls(progressCallback)).toHaveLength(1);
    const calledUrls = progressCallback.mock.calls.map((call) => call[0].currentUrl);
    expect(calledUrls).toContain("file:///testdir/file1.md");
    expect(calledUrls).not.toContain("file:///testdir/file2.html");
    expect(calledUrls).not.toContain("file:///testdir/file3.txt");
  });

  it("decodes percent-encoded spaces in directory and file URLs", async () => {
    const strategy = new LocalFileStrategy(appConfig);
    const options: ScraperOptions = {
      url: "file:///test%20dir",
      library: "test",
      version: "1.0",
      maxPages: 10,
      maxDepth: 1,
      maxConcurrency: 1,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
    vol.fromJSON(
      {
        "/test dir/space file.md": "# Space File\n\nThis file has spaces in its name.",
        "/test dir/normal.md": "# Normal File",
      },
      "/",
    );

    await strategy.scrape(options, progressCallback);

    expect(storedCalls(progressCallback).map(([e]) => e.currentUrl)).toEqual([
      "file:///test%20dir/normal.md",
      "file:///test%20dir/space%20file.md",
    ]);
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        currentUrl: "file:///test%20dir/space%20file.md",
        result: expect.objectContaining({
          textContent: "# Space File\n\nThis file has spaces in its name.",
          contentType: "text/markdown",
          url: "file:///test%20dir/space%20file.md",
          title: "Space File",
        } satisfies Partial<ScrapeResult>),
      } satisfies Partial<ScraperProgressEvent>),
    );
  });

  it("should handle malformed file URLs with only two slashes", async () => {
    const strategy = new LocalFileStrategy(appConfig);
    const options: ScraperOptions = {
      url: "file://testdir/test.md", // Note: only two slashes (malformed)
      library: "test",
      version: "1.0",
      maxPages: 10,
      maxDepth: 0,
      maxConcurrency: 1,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
    const testContent = "# Test Content\nThis is a test file.";

    vol.fromJSON(
      {
        "/testdir/test.md": testContent,
      },
      "/",
    );

    await strategy.scrape(options, progressCallback);

    expect(storedCalls(progressCallback)).toHaveLength(1);
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        pagesScraped: 1,
        currentUrl: "file://testdir/test.md", // Original malformed URL preserved
        result: expect.objectContaining({
          textContent: testContent,
          contentType: "text/markdown",
          title: "Test Content",
          url: "file://testdir/test.md",
        } satisfies Partial<ScrapeResult>),
      } satisfies Partial<ScraperProgressEvent>),
    );
  });
});
