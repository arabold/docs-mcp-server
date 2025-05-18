import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScraperOptions } from "../types";
import { LocalFileStrategy } from "./LocalFileStrategy";
vi.mock("node:fs/promises", () => ({ default: vol.promises }));
vi.mock("../../utils/logger");
vi.mock("node:fs");

describe("LocalFileStrategy", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("should handle file:// URLs", () => {
    const strategy = new LocalFileStrategy();
    expect(strategy.canHandle("file:///path/to/file.txt")).toBe(true);
    expect(strategy.canHandle("https://example.com")).toBe(false);
  });

  it("should process a single file", async () => {
    const strategy = new LocalFileStrategy();
    const options: ScraperOptions = {
      url: "file:///test.md",
      library: "test",
      version: "1.0",
      maxPages: 1,
      maxDepth: 0,
    };
    const progressCallback = vi.fn();

    vol.fromJSON(
      {
        "/test.md": "# Test\n\nThis is a test file.",
      },
      "/",
    );

    await strategy.scrape(options, progressCallback);

    expect(progressCallback).toHaveBeenCalledTimes(1);
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        pagesScraped: 1,
        currentUrl: "file:///test.md",
        depth: 0,
        maxDepth: 0,
        maxPages: 1,
        document: {
          content: "# Test\n\nThis is a test file.",
          metadata: {
            url: "file:///test.md",
            title: "Test",
            library: "test",
            version: "1.0",
          },
        },
      }),
    );
  });

  it("should process a directory with files and a subdirectory", async () => {
    const strategy = new LocalFileStrategy();
    const options: ScraperOptions = {
      url: "file:///testdir",
      library: "test",
      version: "1.0",
      maxPages: 10,
      maxDepth: 2,
    };
    const progressCallback = vi.fn();

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
    // Should process file1.md, file2.html, and file3.txt (in subdir, depth=2)
    expect(progressCallback).toHaveBeenCalledTimes(3);
  });

  it("should process different file types correctly", async () => {
    const strategy = new LocalFileStrategy();
    const options: ScraperOptions = {
      url: "file:///testdir",
      library: "test",
      version: "1.0",
      maxPages: 10,
      maxDepth: 1,
      maxConcurrency: 1,
    };
    const progressCallback = vi.fn();
    vol.fromJSON(
      {
        "/testdir/file1.md": "# File 1",
        "/testdir/file2.html":
          "<html><head><title>File 2 Title</title></head><body><h1>File 2</h1></body></html>",
        "/testdir/file3.txt": "File 3",
      },
      "/",
    );

    await strategy.scrape(options, progressCallback);
    // All 3 files are processed: file1.md, file2.html, and file3.txt (as markdown)
    expect(progressCallback).toHaveBeenCalledTimes(3);

    // Validate .md
    expect(progressCallback).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        pagesScraped: 1,
        currentUrl: "file:///testdir/file1.md",
        depth: 1,
        maxDepth: 1,
        maxPages: 10,
        document: expect.objectContaining({
          content: "# File 1",
          metadata: expect.objectContaining({
            url: "file:///testdir/file1.md",
            title: "File 1",
            library: "test",
            version: "1.0",
          }),
        }),
      }),
    );
    // Validate .html
    expect(progressCallback).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        pagesScraped: 2,
        currentUrl: "file:///testdir/file2.html",
        depth: 1,
        maxDepth: 1,
        maxPages: 10,
        document: expect.objectContaining({
          content: expect.stringContaining("# File 2"),
          metadata: expect.objectContaining({
            url: "file:///testdir/file2.html",
            title: "File 2 Title",
            library: "test",
            version: "1.0",
          }),
        }),
      }),
    );
    // Validate .txt
    expect(progressCallback).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        pagesScraped: 3,
        currentUrl: "file:///testdir/file3.txt",
        depth: 1,
        maxDepth: 1,
        maxPages: 10,
        document: expect.objectContaining({
          content: "File 3",
          metadata: expect.objectContaining({
            url: "file:///testdir/file3.txt",
            title: "Untitled",
            library: "test",
            version: "1.0",
          }),
        }),
      }),
    );
  });

  it("should handle empty files", async () => {
    const strategy = new LocalFileStrategy();
    const options: ScraperOptions = {
      url: "file:///testdir",
      library: "test",
      version: "1.0",
      maxPages: 10,
      maxDepth: 1,
      maxConcurrency: 1,
    };
    const progressCallback = vi.fn();
    vol.fromJSON(
      {
        "/testdir/empty.md": "",
      },
      "/",
    );

    await strategy.scrape(options, progressCallback);

    expect(progressCallback).toHaveBeenCalledTimes(1);
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        pagesScraped: 1,
        currentUrl: "file:///testdir/empty.md",
        document: expect.objectContaining({
          content: "",
          metadata: expect.objectContaining({
            title: "Untitled",
            url: "file:///testdir/empty.md",
            library: "test",
            version: "1.0",
          }),
        }),
      }),
    );
  });

  it("should process .json files using the JsonPipeline", async () => {
    const strategy = new LocalFileStrategy();
    const options: ScraperOptions = {
      url: "file:///testdir",
      library: "test",
      version: "1.0",
      maxPages: 10,
      maxDepth: 1,
      maxConcurrency: 1,
    };
    const progressCallback = vi.fn();
    const jsonContent = JSON.stringify({ a: 1, b: [2, 3, 4], c: { d: 5 } });
    vol.fromJSON(
      {
        "/testdir/data.json": jsonContent,
      },
      "/",
    );

    await strategy.scrape(options, progressCallback);
    expect(progressCallback).toHaveBeenCalledTimes(1);
    const call = progressCallback.mock.calls[0][0];
    expect(call.currentUrl).toBe("file:///testdir/data.json");
    // Parse the output and check structure, not formatting
    const parsed = JSON.parse(call.document.content);
    expect(parsed.a).toBe(1);
    expect(parsed.b).toEqual([2, 3, 4]);
    expect(parsed.c).toEqual({ d: 5 });
    expect(call.document.metadata.url).toBe("file:///testdir/data.json");
  });
});
