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
        totalPages: 1,
        document: {
          content: "# Test\n\nThis is a test file.",
          contentType: "text/markdown",
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
        totalPages: 4,
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
        totalPages: 4,
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
        totalPages: 4,
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
    const progressCallback = vi.fn();

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
        document: expect.objectContaining({
          contentType: "text/x-typescript",
          content: expect.stringContaining("interface User"),
          metadata: expect.objectContaining({
            url: "file:///codebase/app.ts",
          }),
        }),
      }),
    );

    // Check TSX file
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({
          contentType: "text/x-tsx",
          content: expect.stringContaining("export const App"),
          metadata: expect.objectContaining({
            url: "file:///codebase/component.tsx",
          }),
        }),
      }),
    );

    // Check Python file
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({
          contentType: "text/x-python",
          content: expect.stringContaining("def hello"),
          metadata: expect.objectContaining({
            url: "file:///codebase/script.py",
          }),
        }),
      }),
    );

    // Check Go file
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({
          contentType: "text/x-go",
          content: expect.stringContaining("package main"),
          metadata: expect.objectContaining({
            url: "file:///codebase/main.go",
          }),
        }),
      }),
    );

    // Check Rust file
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({
          contentType: "text/x-rust",
          content: expect.stringContaining("fn main"),
          metadata: expect.objectContaining({
            url: "file:///codebase/lib.rs",
          }),
        }),
      }),
    );

    // Check Kotlin file
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({
          contentType: "text/x-kotlin",
          content: expect.stringContaining("fun main"),
          metadata: expect.objectContaining({
            url: "file:///codebase/App.kt",
          }),
        }),
      }),
    );

    // Check Ruby file
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({
          contentType: "text/x-ruby",
          content: expect.stringContaining("puts"),
          metadata: expect.objectContaining({
            url: "file:///codebase/script.rb",
          }),
        }),
      }),
    );

    // Check Shell script
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({
          contentType: "text/x-shellscript",
          content: expect.stringContaining("#!/bin/bash"),
          metadata: expect.objectContaining({
            url: "file:///codebase/run.sh",
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
    const progressCallback = vi.fn();
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
    const progressCallback = vi.fn();
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
    const progressCallback = vi.fn();
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
        document: expect.objectContaining({
          content: "# Space File\n\nThis file has spaces in its name.",
          metadata: expect.objectContaining({
            url: "file:///test%20dir/space%20file.md",
            title: "Space File",
          }),
        }),
      }),
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
    const progressCallback = vi.fn();
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
});
