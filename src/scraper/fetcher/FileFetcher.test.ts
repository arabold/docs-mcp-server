import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScraperError } from "../../utils/errors";
import { FileFetcher } from "./FileFetcher";

vi.mock("node:fs/promises", () => ({ default: vol.promises }));
vi.mock("../../utils/logger");

describe("FileFetcher", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("should fetch file content successfully", async () => {
    const fetcher = new FileFetcher();
    const mockContent = "Hello, world!";

    // Create a virtual file system
    vol.fromJSON({
      "/path/to/file.txt": mockContent,
    });

    const result = await fetcher.fetch("file:///path/to/file.txt");
    expect(result.content.toString()).toBe(mockContent);
    expect(result.mimeType).toBe("text/plain");
    expect(result.source).toBe("file:///path/to/file.txt");
    // charset should be undefined to allow pipeline to detect it
    expect(result.charset).toBeUndefined();
    // encoding should be undefined as files are not compressed
    expect(result.encoding).toBeUndefined();
  });

  it("should handle different file types", async () => {
    const fetcher = new FileFetcher();
    const mockContent = "<h1>Hello</h1>";

    // Create a virtual file system
    vol.fromJSON({
      "/path/to/file.html": mockContent,
    });

    const result = await fetcher.fetch("file:///path/to/file.html");
    expect(result.mimeType).toBe("text/html");
  });

  it("should detect source code MIME types correctly", async () => {
    const fetcher = new FileFetcher();
    const files = {
      "/code/app.ts": "interface User { name: string; }",
      "/code/component.tsx": "export const App = () => <div>Hello</div>;",
      "/code/script.py": "def hello(): print('world')",
      "/code/main.go": "package main\nfunc main() {}",
      "/code/lib.rs": 'fn main() { println!("Hello"); }',
      "/code/App.kt": 'fun main() { println("Hello") }',
      "/code/script.rb": "puts 'Hello world'",
      "/code/index.js": "console.log('Hello');",
      "/code/style.css": "body { margin: 0; }",
      "/code/data.json": '{"name": "test"}',
      "/code/config.xml": "<config></config>",
      "/code/readme.md": "# Hello",
      "/code/script.sh": "#!/bin/bash\necho hello",
    };

    vol.fromJSON(files);

    // Test TypeScript files
    const tsResult = await fetcher.fetch("file:///code/app.ts");
    expect(tsResult.mimeType).toBe("text/x-typescript");

    const tsxResult = await fetcher.fetch("file:///code/component.tsx");
    expect(tsxResult.mimeType).toBe("text/x-tsx");

    // Test Python files
    const pyResult = await fetcher.fetch("file:///code/script.py");
    expect(pyResult.mimeType).toBe("text/x-python");

    // Test Go files
    const goResult = await fetcher.fetch("file:///code/main.go");
    expect(goResult.mimeType).toBe("text/x-go");

    // Test Rust files
    const rsResult = await fetcher.fetch("file:///code/lib.rs");
    expect(rsResult.mimeType).toBe("text/x-rust");

    // Test Kotlin files
    const ktResult = await fetcher.fetch("file:///code/App.kt");
    expect(ktResult.mimeType).toBe("text/x-kotlin");

    // Test Ruby files
    const rbResult = await fetcher.fetch("file:///code/script.rb");
    expect(rbResult.mimeType).toBe("text/x-ruby");

    // Test JavaScript files (fallback to mime package)
    const jsResult = await fetcher.fetch("file:///code/index.js");
    expect(jsResult.mimeType).toBe("text/javascript");

    // Test shell scripts
    const shResult = await fetcher.fetch("file:///code/script.sh");
    expect(shResult.mimeType).toBe("text/x-shellscript");

    // Test other file types (fallback to mime package)
    const cssResult = await fetcher.fetch("file:///code/style.css");
    expect(cssResult.mimeType).toBe("text/css");

    const jsonResult = await fetcher.fetch("file:///code/data.json");
    expect(jsonResult.mimeType).toBe("application/json");

    const xmlResult = await fetcher.fetch("file:///code/config.xml");
    expect(xmlResult.mimeType).toBe("application/xml");

    const mdResult = await fetcher.fetch("file:///code/readme.md");
    expect(mdResult.mimeType).toBe("text/markdown");
  });

  it("should throw error if file does not exist", async () => {
    const fetcher = new FileFetcher();

    await expect(fetcher.fetch("file:///path/to/file.txt")).rejects.toThrow(ScraperError);
  });

  it("should only handle file protocol", async () => {
    const fetcher = new FileFetcher();
    expect(fetcher.canFetch("https://example.com")).toBe(false);
    expect(fetcher.canFetch("file:///path/to/file.txt")).toBe(true);
  });

  it("returns application/octet-stream for files with null bytes (binary)", async () => {
    const fetcher = new FileFetcher();
    // Use memfs for the binary file
    const buf = Buffer.from([0x41, 0x00, 0x42, 0x43]); // 'A\0BC'
    vol.fromJSON({
      "/binary.bin": buf,
    });
    const result = await fetcher.fetch("file:///binary.bin");
    expect(result.mimeType).toBe("application/octet-stream");
  });

  it("does not process unsupported/binary files (e.g., images)", async () => {
    const fetcher = new FileFetcher();
    // Simulate a directory with a supported text file and an unsupported image file
    const mockText = "Hello, supported!";
    const mockImage = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
    vol.fromJSON({
      "/docs/readme.md": mockText,
      "/docs/image.png": mockImage,
    });
    // Only fetch the markdown file, not the image
    const result = await fetcher.fetch("file:///docs/readme.md");
    expect(result.mimeType).toBe("text/markdown");
    // Try to fetch the image: should be detected as binary
    const imageResult = await fetcher.fetch("file:///docs/image.png");
    expect(imageResult.mimeType).toBe("image/png");
  });

  it("should fetch a file with spaces in its name (percent-encoded in file:// URL)", async () => {
    const fetcher = new FileFetcher();
    const mockContent = "Hello, space!";
    vol.fromJSON({
      "/path with space/file with space.txt": mockContent,
    });
    const result = await fetcher.fetch(
      "file:///path%20with%20space/file%20with%20space.txt",
    );
    expect(result.content.toString()).toBe(mockContent);
    expect(result.source).toBe("file:///path%20with%20space/file%20with%20space.txt");
  });

  it("should fetch a file with spaces in its name (percent-encoded in file:// URL)", async () => {
    const filePath = "/tmp/test folder/file with space.md";
    vol.fromJSON(
      {
        [filePath]: "# Hello with space",
      },
      "/",
    );
    const url = "file:///tmp/test%20folder/file%20with%20space.md";
    const fetcher = new FileFetcher();
    const result = await fetcher.fetch(url);
    expect(result.content.toString()).toBe("# Hello with space");
    expect(result.mimeType).toBe("text/markdown");
    expect(result.source).toBe(url);
    // charset should be undefined to allow pipeline to detect it
    expect(result.charset).toBeUndefined();
    // encoding should be undefined as files are not compressed
    expect(result.encoding).toBeUndefined();
  });

  it("should handle malformed file URLs with only two slashes", async () => {
    const fetcher = new FileFetcher();
    const mockContent = "Hello, malformed URL!";

    // Create a virtual file system
    vol.fromJSON({
      "/Users/testuser/foo/bar/file.txt": mockContent,
    });

    // Test with malformed URL (file:// instead of file:///)
    const result = await fetcher.fetch("file://Users/testuser/foo/bar/file.txt");
    expect(result.content.toString()).toBe(mockContent);
    expect(result.mimeType).toBe("text/plain");
    expect(result.source).toBe("file://Users/testuser/foo/bar/file.txt");
  });
});
