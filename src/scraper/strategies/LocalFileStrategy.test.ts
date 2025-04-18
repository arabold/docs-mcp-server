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
      maxDepth: 0, // No recursion
    };
    const progressCallback = vi.fn();

    vol.fromJSON(
      {
        "/test.md": "# Test\n\nThis is a test file.",
      },
      "/",
    ); // Set root for relative paths

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

  it("should process a directory recursively", async () => {
    const strategy = new LocalFileStrategy();
    const options: ScraperOptions = {
      url: "file:///testdir",
      library: "test",
      version: "1.0",
      maxPages: 10,
      maxDepth: 3, // Recurse up to 3 levels deep
    };
    const progressCallback = vi.fn();

    vol.fromJSON(
      {
        "/testdir/file1.md": "# File 1",
        "/testdir/subdir/file2.html":
          "<html><head><title>File 2 Title</title></head><body><h1>File 2</h1></body></html>",
        "/testdir/subdir/file3.txt": "File 3",
        "/testdir/subdir/subsubdir/file4.md": "# File 4",
        "/testdir/file5.md": "# File 5",
      },
      "/",
    );

    await strategy.scrape(options, progressCallback);
    expect(progressCallback).toHaveBeenCalledTimes(5);
  });

  it("should respect maxDepth option", async () => {
    const strategy = new LocalFileStrategy();
    const options: ScraperOptions = {
      url: "file:///testdir",
      library: "test",
      version: "1.0",
      maxPages: 10,
      maxDepth: 1, // Limit to depth of 1
    };
    const progressCallback = vi.fn();

    vol.fromJSON(
      {
        "/testdir/file1.md": "# File 1",
        "/testdir/subdir/file2.html":
          "<html><head><title>File 2 Title</title></head><body><h1>File 2</h1></body></html>",
        "/testdir/subdir/subsubdir/file3.txt": "File 3",
        "/testdir/file4.md": "# File 4",
      },
      "/",
    );

    await strategy.scrape(options, progressCallback);
    expect(progressCallback).toHaveBeenCalledTimes(2); //file1, file4 and subdir
  });

  it("should respect maxPages option", async () => {
    const strategy = new LocalFileStrategy();
    const options: ScraperOptions = {
      url: "file:///testdir",
      library: "test",
      version: "1.0",
      maxPages: 2, // Limit to 2 files
      maxDepth: 2,
    };
    const progressCallback = vi.fn();

    vol.fromJSON(
      {
        "/testdir/file1.md": "# File 1",
        "/testdir/subdir/file2.html":
          "<html><head><title>File 2 Title</title></head><body><h1>File 2</h1></body></html>",
        "/testdir/subdir/subsubdir/file3.txt": "File 3",
        "/testdir/file4.md": "# File 4",
      },
      "/",
    );

    await strategy.scrape(options, progressCallback);
    expect(progressCallback).toHaveBeenCalledTimes(2); //Only 2 files
  });

  it("should process different file types correctly", async () => {
    const strategy = new LocalFileStrategy();
    const options: ScraperOptions = {
      url: "file:///testdir",
      library: "test",
      version: "1.0",
      maxPages: 10,
      maxDepth: 1,
      maxConcurrency: 1, // Process sequentially
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
    expect(progressCallback).toHaveBeenCalledTimes(3);

    expect(progressCallback).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        pagesScraped: 1,
        currentUrl: "file:///testdir/file1.md",
        depth: 1, // the root folder is depth 0
        maxDepth: 1,
        maxPages: 10,
        document: {
          content: "# File 1",
          metadata: {
            url: "file:///testdir/file1.md",
            title: "File 1",
            library: "test",
            version: "1.0",
          },
        },
      }),
    );
    expect(progressCallback).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        pagesScraped: 2,
        currentUrl: "file:///testdir/file2.html",
        depth: 1,
        maxDepth: 1,
        maxPages: 10,
        document: {
          content: expect.stringContaining("# File 2"),
          metadata: {
            url: "file:///testdir/file2.html",
            title: "File 2 Title",
            library: "test",
            version: "1.0",
          },
        },
      }),
    );
    expect(progressCallback).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        pagesScraped: 3,
        currentUrl: "file:///testdir/file3.txt",
        depth: 1,
        maxDepth: 1,
        maxPages: 10,
        document: {
          content: "File 3",
          metadata: {
            url: "file:///testdir/file3.txt",
            title: "Untitled",
            library: "test",
            version: "1.0",
          },
        },
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
      maxConcurrency: 1, // Process sequentially
    };
    const progressCallback = vi.fn();
    vol.fromJSON(
      {
        "/testdir/empty.md": "",
      },
      "/",
    );

    await strategy.scrape(options, progressCallback);

    // Expect the callback to be called once with an empty document
    expect(progressCallback).toHaveBeenCalledTimes(1);
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        pagesScraped: 1,
        currentUrl: "file:///testdir/empty.md",
        document: {
          content: "", // Expect empty string content
          metadata: expect.objectContaining({
            title: "Untitled", // Expect default title
            url: "file:///testdir/empty.md",
            library: "test",
            version: "1.0",
          }),
        },
      }),
    );
  });
});
