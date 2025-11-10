import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressCallback } from "../../types";
import type { ScrapeResult, ScraperOptions, ScraperProgressEvent } from "../types";
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
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    vol.fromJSON(
      {
        "/test.md": "# Test\n\nThis is a test file.",
      },
      "/",
    );

    await strategy.scrape(options, progressCallback);

    expect(progressCallback).toHaveBeenCalledTimes(1);

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

  it("should process a directory with files and a subdirectory", async () => {
    const strategy = new LocalFileStrategy();
    const options: ScraperOptions = {
      url: "file:///testdir",
      library: "test",
      version: "1.0",
      maxPages: 10,
      maxDepth: 2,
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
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
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
    // All 3 files are page: file1.md, file2.html, and file3.txt (as markdown)
    expect(progressCallback).toHaveBeenCalledTimes(3);

    // Validate .md
    expect(progressCallback).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        pagesScraped: 1,
        currentUrl: "file:///testdir/file1.md",
        depth: 1,
        maxDepth: 1,
        totalPages: 4,
        totalDiscovered: 4,
        result: expect.objectContaining({
          textContent: "# File 1",
          contentType: "text/markdown",
          url: "file:///testdir/file1.md",
          title: "File 1",
        } satisfies Partial<ScrapeResult>),
      } satisfies Partial<ScraperProgressEvent>),
    );
    // Validate .html
    expect(progressCallback).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        pagesScraped: 2,
        currentUrl: "file:///testdir/file2.html",
        depth: 1,
        maxDepth: 1,
        totalPages: 4,
        totalDiscovered: 4,
        result: expect.objectContaining({
          textContent: expect.stringContaining("# File 2"),
          contentType: "text/html",
          url: "file:///testdir/file2.html",
          title: "File 2 Title",
        } satisfies Partial<ScrapeResult>),
      } satisfies Partial<ScraperProgressEvent>),
    );
    // Validate .txt
    expect(progressCallback).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        pagesScraped: 3,
        currentUrl: "file:///testdir/file3.txt",
        depth: 1,
        maxDepth: 1,
        totalPages: 4,
        totalDiscovered: 4,
        result: expect.objectContaining({
          textContent: "File 3",
          contentType: "text/plain",
          url: "file:///testdir/file3.txt",
          title: "file3.txt",
        } satisfies Partial<ScrapeResult>),
      } satisfies Partial<ScraperProgressEvent>),
    );
  });

  it("should detect source code file types with correct MIME types", async () => {
    const strategy = new LocalFileStrategy();
    const options: ScraperOptions = {
      url: "file:///codebase",
      library: "test",
      version: "1.0",
      maxPages: 10,
      maxDepth: 1,
      maxConcurrency: 1,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    vol.fromJSON(
      {
        "/codebase/app.ts": "interface User {\n  name: string;\n}",
        "/codebase/component.tsx": "export const App = () => <div>Hello</div>;",
        "/codebase/script.py": "def hello():\n    print('world')",
        "/codebase/main.go": 'package main\n\nfunc main() {\n    fmt.Println("Hello")\n}',
        "/codebase/lib.rs": 'fn main() {\n    println!("Hello, world!");\n}',
        "/codebase/App.kt": 'fun main() {\n    println("Hello, world!")\n}',
        "/codebase/script.rb": "puts 'Hello, world!'",
        "/codebase/run.sh": "#!/bin/bash\necho 'Hello, world!'",
      },
      "/",
    );

    await strategy.scrape(options, progressCallback);

    // Expect 8 files to be processed
    expect(progressCallback).toHaveBeenCalledTimes(8);

    // Check TypeScript file
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          title: "app.ts",
          textContent: expect.stringContaining("interface User"),
          contentType: "text/x-typescript",
          url: "file:///codebase/app.ts",
        } satisfies Partial<ScrapeResult>),
      } satisfies Partial<ScraperProgressEvent>),
    );

    // Check TSX file
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          title: "component.tsx",
          textContent: expect.stringContaining("export const App"),
          contentType: "text/x-tsx",
          url: "file:///codebase/component.tsx",
        } satisfies Partial<ScrapeResult>),
      } satisfies Partial<ScraperProgressEvent>),
    );

    // Check Python file
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          title: "script.py",
          textContent: expect.stringContaining("def hello"),
          contentType: "text/x-python",
          url: "file:///codebase/script.py",
        } satisfies Partial<ScrapeResult>),
      } satisfies Partial<ScraperProgressEvent>),
    );

    // Check Go file
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          title: "main.go",
          textContent: expect.stringContaining("package main"),
          contentType: "text/x-go",
          url: "file:///codebase/main.go",
        } satisfies Partial<ScrapeResult>),
      } satisfies Partial<ScraperProgressEvent>),
    );

    // Check Rust file
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          title: "lib.rs",
          textContent: expect.stringContaining("fn main"),
          contentType: "text/x-rust",
          url: "file:///codebase/lib.rs",
        } satisfies Partial<ScrapeResult>),
      } satisfies Partial<ScraperProgressEvent>),
    );

    // Check Kotlin file
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          title: "App.kt",
          textContent: expect.stringContaining("fun main"),
          contentType: "text/x-kotlin",
          url: "file:///codebase/App.kt",
        } satisfies Partial<ScrapeResult>),
      } satisfies Partial<ScraperProgressEvent>),
    );

    // Check Ruby file
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          title: "script.rb",
          textContent: expect.stringContaining("puts"),
          contentType: "text/x-ruby",
          url: "file:///codebase/script.rb",
        } satisfies Partial<ScrapeResult>),
      } satisfies Partial<ScraperProgressEvent>),
    );

    // Check Shell script
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          textContent: expect.stringContaining("#!/bin/bash"),
          contentType: "text/x-shellscript",
          url: "file:///codebase/run.sh",
        } satisfies Partial<ScrapeResult>),
      } satisfies Partial<ScraperProgressEvent>),
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
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
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
        result: expect.objectContaining({
          textContent: "",
          contentType: "text/markdown",
          title: "Untitled",
          url: "file:///testdir/empty.md",
        } satisfies Partial<ScrapeResult>),
      } satisfies Partial<ScraperProgressEvent>),
    );
  });

  it("should skip binary/unsupported files and only process supported text files", async () => {
    const strategy = new LocalFileStrategy();
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
    expect(progressCallback).toHaveBeenCalledTimes(3);
    const calledUrls = progressCallback.mock.calls.map((call) => call[0].currentUrl);
    expect(calledUrls).toContain("file:///testdir/file1.md");
    expect(calledUrls).toContain("file:///testdir/file3.txt");
    expect(calledUrls).toContain("file:///testdir/file5.html");
    // Should NOT process binary/image files
    expect(calledUrls).not.toContain("file:///testdir/file2.png");
    expect(calledUrls).not.toContain("file:///testdir/file4.bin");
  });

  it("should respect include and exclude patterns for local crawling", async () => {
    const strategy = new LocalFileStrategy();
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
    expect(progressCallback).toHaveBeenCalledTimes(1);
    const calledUrls = progressCallback.mock.calls.map((call) => call[0].currentUrl);
    expect(calledUrls).toContain("file:///testdir/file1.md");
    expect(calledUrls).not.toContain("file:///testdir/file2.html");
    expect(calledUrls).not.toContain("file:///testdir/file3.txt");
  });

  it("should process files and folders with spaces in their names (percent-encoded in file:// URL)", async () => {
    const strategy = new LocalFileStrategy();
    const options: ScraperOptions = {
      url: "file:///test%20dir/space%20file.md",
      library: "test",
      version: "1.0",
      maxPages: 1,
      maxDepth: 0,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
    vol.fromJSON(
      {
        "/test dir/space file.md": "# Space File\n\nThis file has spaces in its name.",
      },
      "/",
    );
    await strategy.scrape(options, progressCallback);
    expect(progressCallback).toHaveBeenCalledTimes(1);
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        pagesScraped: 1,
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

  it("should decode percent-encoded file paths (spaces as %20) for local crawling", async () => {
    const strategy = new LocalFileStrategy();
    const options: ScraperOptions = {
      url: "file:///test%20dir", // percent-encoded space
      library: "test",
      version: "1.0",
      maxPages: 10,
      maxDepth: 1,
      maxConcurrency: 1,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
    vol.fromJSON(
      {
        "/test dir/file with space.md": "# File With Space",
        "/test dir/normal.md": "# Normal File",
      },
      "/",
    );
    await strategy.scrape(options, progressCallback);
    // Both files should be processed
    expect(progressCallback).toHaveBeenCalledTimes(2);
    const calledUrls = progressCallback.mock.calls.map((call) => call[0].currentUrl);
    expect(calledUrls).toContain("file:///test%20dir/file%20with%20space.md");
    expect(calledUrls).toContain("file:///test%20dir/normal.md");
  });

  it("should process JSON files through JsonPipeline", async () => {
    const strategy = new LocalFileStrategy();
    const options: ScraperOptions = {
      url: "file:///api-docs.json",
      library: "test-api",
      version: "1.0.0",
      maxPages: 1,
      maxDepth: 0,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    // Create a JSON file with API documentation structure
    const jsonContent = JSON.stringify(
      {
        title: "Test API Documentation",
        version: "1.0.0",
        endpoints: {
          users: {
            get: {
              description: "Get all users",
              method: "GET",
              path: "/users",
            },
            post: {
              description: "Create a new user",
              method: "POST",
              path: "/users",
              body: {
                name: "string",
                email: "string",
              },
            },
          },
        },
        schemas: {
          User: {
            id: "integer",
            name: "string",
            email: "string",
          },
        },
      },
      null,
      2,
    );

    vol.fromJSON(
      {
        "/api-docs.json": jsonContent,
      },
      "/",
    );

    await strategy.scrape(options, progressCallback);

    expect(progressCallback).toHaveBeenCalledTimes(1);
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        pagesScraped: 1,
        currentUrl: "file:///api-docs.json",
        depth: 0,
        maxDepth: 0,
        totalPages: 1,
        totalDiscovered: 1,
        result: expect.objectContaining({
          textContent: jsonContent,
          contentType: "application/json",
          title: "Test API Documentation",
          url: "file:///api-docs.json",
        } satisfies Partial<ScrapeResult>),
      } satisfies Partial<ScraperProgressEvent>),
    );
  });

  it("should handle malformed file URLs with only two slashes", async () => {
    const strategy = new LocalFileStrategy();
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

    expect(progressCallback).toHaveBeenCalledTimes(1);
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

  describe("refresh workflow", () => {
    it("should skip processing when file returns NOT_MODIFIED (unchanged)", async () => {
      const strategy = new LocalFileStrategy();
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
      const testContent = "# Test File\nOriginal content";

      // Create initial file with a specific mtime
      vol.fromJSON({ "/test.md": testContent }, "/");

      // Get the file stats to capture the exact mtime
      const stats = await vol.promises.stat("/test.md");
      const initialMtime = stats.mtime;

      // First scrape to get the initial etag
      const initialOptions: ScraperOptions = {
        url: "file:///test.md",
        library: "test",
        version: "1.0",
        maxPages: 1,
        maxDepth: 0,
      };

      await strategy.scrape(initialOptions, progressCallback);
      expect(progressCallback).toHaveBeenCalledTimes(1);

      // Get the etag from the first scrape
      const firstCall = progressCallback.mock.calls[0][0];
      const etag = firstCall.result?.etag;

      // Verify the mtime hasn't changed
      const statsAfterScrape = await vol.promises.stat("/test.md");
      expect(statsAfterScrape.mtime.getTime()).toBe(initialMtime.getTime());

      // Reset the callback but DON'T reset the filesystem
      // This preserves the file's mtime, so the etag stays the same
      progressCallback.mockClear();

      // Now do a refresh with the same etag (file unchanged)
      const refreshOptions: ScraperOptions = {
        url: "file:///test.md",
        library: "test",
        version: "1.0",
        maxPages: 1,
        maxDepth: 0,
        initialQueue: [
          {
            url: "file:///test.md",
            depth: 0,
            pageId: 123,
            etag: etag,
          },
        ],
      };

      await strategy.scrape(refreshOptions, progressCallback);

      // Verify file was checked but returned NOT_MODIFIED (no result with content)
      // The root URL at depth 0 is always processed to check for changes
      expect(progressCallback).toHaveBeenCalledTimes(1);
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          pagesScraped: 1,
          currentUrl: "file:///test.md",
          depth: 0,
          result: null, // NOT_MODIFIED returns null result
          pageId: 123,
        }),
      );
    });

    it("should re-process file when it has been modified", async () => {
      const strategy = new LocalFileStrategy();
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
      const originalContent = "# Original\nOriginal content";
      const updatedContent = "# Updated\nNew updated content";

      // Create initial file
      vol.fromJSON({ "/test.md": originalContent }, "/");

      // First scrape
      const initialOptions: ScraperOptions = {
        url: "file:///test.md",
        library: "test",
        version: "1.0",
        maxPages: 1,
        maxDepth: 0,
      };

      await strategy.scrape(initialOptions, progressCallback);
      const firstCall = progressCallback.mock.calls[0][0];
      const oldEtag = firstCall.result?.etag;

      // Modify the file (update content and mtime)
      // Using a new date for fromJSON will create a new mtime
      vol.reset();
      vol.fromJSON({ "/test.md": updatedContent }, "/");

      // Wait a bit to ensure different mtime
      await new Promise((resolve) => setTimeout(resolve, 10));

      progressCallback.mockClear();

      // Refresh with old etag
      const refreshOptions: ScraperOptions = {
        url: "file:///test.md",
        library: "test",
        version: "1.0",
        maxPages: 1,
        maxDepth: 0,
        initialQueue: [
          {
            url: "file:///test.md",
            depth: 0,
            pageId: 456,
            etag: oldEtag,
          },
        ],
      };

      await strategy.scrape(refreshOptions, progressCallback);

      // Verify file was re-processed
      const docCalls = progressCallback.mock.calls.filter((call) => call[0].result);
      expect(docCalls).toHaveLength(1);
      expect(docCalls[0][0].result?.textContent).toContain("# Updated");
      expect(docCalls[0][0].result?.textContent).toContain("New updated content");
      expect(docCalls[0][0].result?.title).toBe("Updated");
      // Verify new etag is different
      expect(docCalls[0][0].result?.etag).not.toBe(oldEtag);
    });

    it("should handle deleted files during refresh", async () => {
      const strategy = new LocalFileStrategy();
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
      const testContent = "# Test File\nContent";

      // Create initial file
      vol.fromJSON({ "/test.md": testContent }, "/");

      // First scrape
      const initialOptions: ScraperOptions = {
        url: "file:///test.md",
        library: "test",
        version: "1.0",
        maxPages: 1,
        maxDepth: 0,
      };

      await strategy.scrape(initialOptions, progressCallback);
      const firstCall = progressCallback.mock.calls[0][0];
      const etag = firstCall.result?.etag;

      // Delete the file
      vol.reset();

      progressCallback.mockClear();

      // Refresh with deleted file
      const refreshOptions: ScraperOptions = {
        url: "file:///test.md",
        library: "test",
        version: "1.0",
        maxPages: 1,
        maxDepth: 0,
        initialQueue: [
          {
            url: "file:///test.md",
            depth: 0,
            pageId: 789,
            etag: etag,
          },
        ],
      };

      await strategy.scrape(refreshOptions, progressCallback);

      // Verify no processed documents were returned
      const docCalls = progressCallback.mock.calls.filter((call) => call[0].result);
      expect(docCalls).toHaveLength(0);
    });

    it("should discover and process new files in a directory during refresh", async () => {
      const strategy = new LocalFileStrategy();
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      // Create initial directory with one file
      vol.fromJSON(
        {
          "/testdir/file1.md": "# File 1",
        },
        "/",
      );

      // First scrape
      const initialOptions: ScraperOptions = {
        url: "file:///testdir",
        library: "test",
        version: "1.0",
        maxPages: 10,
        maxDepth: 1,
      };

      await strategy.scrape(initialOptions, progressCallback);
      expect(progressCallback).toHaveBeenCalledTimes(1);

      // Add a new file to the directory
      vol.fromJSON(
        {
          "/testdir/file1.md": "# File 1",
          "/testdir/file2.md": "# File 2\nNew file added",
        },
        "/",
      );

      progressCallback.mockClear();

      // Refresh the directory (directories don't use etag, they just re-scan)
      const refreshOptions: ScraperOptions = {
        url: "file:///testdir",
        library: "test",
        version: "1.0",
        maxPages: 10,
        maxDepth: 1,
      };

      await strategy.scrape(refreshOptions, progressCallback);

      // Should process both files
      expect(progressCallback).toHaveBeenCalledTimes(2);
      const calledUrls = progressCallback.mock.calls.map((call) => call[0].currentUrl);
      expect(calledUrls).toContain("file:///testdir/file1.md");
      expect(calledUrls).toContain("file:///testdir/file2.md");
    });

    it("should preserve depth from original scrape during refresh for nested files", async () => {
      const strategy = new LocalFileStrategy();
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      vol.fromJSON(
        {
          "/testdir/subdir/deep/file.md": "# Deep File\nOriginal content",
        },
        "/",
      );

      // First scrape starting from directory - file will be discovered at depth 3
      const initialOptions: ScraperOptions = {
        url: "file:///testdir",
        library: "test",
        version: "1.0",
        maxPages: 10,
        maxDepth: 3,
      };

      await strategy.scrape(initialOptions, progressCallback);
      expect(progressCallback).toHaveBeenCalledTimes(1);
      const firstCall = progressCallback.mock.calls[0][0];
      expect(firstCall.depth).toBe(3); // File discovered at depth 3
      const etag = firstCall.result?.etag;

      // Update the file with new content
      vol.reset();
      vol.fromJSON(
        {
          "/testdir/subdir/deep/file.md": "# Deep File\nUpdated content",
        },
        "/",
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      progressCallback.mockClear();

      // Refresh starting from same directory with file in initialQueue at depth 3
      const refreshOptions: ScraperOptions = {
        url: "file:///testdir",
        library: "test",
        version: "1.0",
        maxPages: 10,
        maxDepth: 3,
        initialQueue: [
          {
            url: "file:///testdir/subdir/deep/file.md",
            depth: 3, // Original depth from discovery
            pageId: 555,
            etag: etag,
          },
        ],
      };

      await strategy.scrape(refreshOptions, progressCallback);

      // Verify file was re-processed and depth from initialQueue is preserved
      const docCalls = progressCallback.mock.calls.filter((call) => call[0].result);
      expect(docCalls).toHaveLength(1);
      expect(docCalls[0][0].depth).toBe(3);
      expect(docCalls[0][0].pageId).toBe(555);
      expect(docCalls[0][0].result?.textContent).toContain("Updated content");
    });
  });
});
