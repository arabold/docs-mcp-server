import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScraperError } from "../../utils/errors";
import { FileFetcher } from "./FileFetcher";

vi.mock("node:fs/promises", () => ({ default: vol.promises }));

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

  it.each([
    [".ts", "text/x-typescript", "interface User { name: string; }"],
    [".tsx", "text/x-tsx", "export const App = () => <div>Hello</div>;"],
    [".py", "text/x-python", "def hello(): print('world')"],
    [".go", "text/x-go", "package main\nfunc main() {}"],
    [".rs", "text/x-rust", 'fn main() { println!("Hello"); }'],
    [".kt", "text/x-kotlin", 'fun main() { println("Hello") }'],
    [".rb", "text/x-ruby", "puts 'Hello world'"],
    [".js", "text/javascript", "console.log('Hello');"],
    [".css", "text/css", "body { margin: 0; }"],
    [".json", "application/json", '{"name": "test"}'],
    [".xml", "application/xml", "<config></config>"],
    [".md", "text/markdown", "# Hello"],
    [".sh", "text/x-shellscript", "#!/bin/bash\necho hello"],
  ])("should detect %s files as %s", async (extension, expectedMimeType, content) => {
    const fetcher = new FileFetcher();
    const fileName = `/code/file${extension}`;

    vol.fromJSON({
      [fileName]: content,
    });

    const result = await fetcher.fetch(`file://${fileName}`);
    expect(result.mimeType).toBe(expectedMimeType);
  });

  it("should return status NOT_FOUND if file does not exist", async () => {
    const fetcher = new FileFetcher();

    const result = await fetcher.fetch("file:///path/to/nonexistent-file.txt");
    expect(result.status).toBe("not_found");
  });

  it("should throw ScraperError for other file system errors", async () => {
    const fetcher = new FileFetcher();
    const filePath = "/path/to/permission-denied.txt";

    // Create the file in the virtual filesystem first
    vol.fromJSON({
      [filePath]: "test content",
    });

    // Simulate a permission error by mocking stat to succeed but readFile to fail
    const permissionError = new Error("EACCES: permission denied");
    (permissionError as NodeJS.ErrnoException).code = "EACCES";
    const readFileSpy = vi
      .spyOn(vol.promises, "readFile")
      .mockRejectedValue(permissionError);

    await expect(fetcher.fetch(`file://${filePath}`)).rejects.toThrow(ScraperError);

    // Restore the spy
    readFileSpy.mockRestore();
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

  describe("File status detection for refresh", () => {
    beforeEach(() => {
      vol.reset();
    });

    it("should return NOT_MODIFIED when fetching an unchanged file with its etag", async () => {
      const fetcher = new FileFetcher();
      const filePath = "/test/unchanged.txt";

      vol.fromJSON({
        [filePath]: "content",
      });

      // First fetch to get the ETag
      const result1 = await fetcher.fetch(`file://${filePath}`);
      const etag = result1.etag;

      // Second fetch with the same ETag should return NOT_MODIFIED
      const result2 = await fetcher.fetch(`file://${filePath}`, { etag });

      expect(result2.status).toBe("not_modified");
      expect(result2.etag).toBe(etag);
      expect(result2.content).toEqual(Buffer.from(""));
    });

    it("should return SUCCESS when fetching a modified file with its old etag", async () => {
      const fetcher = new FileFetcher();
      const filePath = "/test/modified.txt";

      // Create initial file
      vol.fromJSON({
        [filePath]: "initial",
      });

      const result1 = await fetcher.fetch(`file://${filePath}`);
      const oldEtag = result1.etag;

      // Wait and modify file
      await new Promise((resolve) => setTimeout(resolve, 10));
      vol.fromJSON({
        [filePath]: "modified",
      });

      // Fetch with old ETag should detect change and return SUCCESS
      const result2 = await fetcher.fetch(`file://${filePath}`, { etag: oldEtag });

      expect(result2.status).toBe("success");
      expect(result2.etag).not.toBe(oldEtag);
      expect(result2.content.toString()).toBe("modified");
    });

    it("should return NOT_FOUND when the file has been deleted", async () => {
      const fetcher = new FileFetcher();

      const result = await fetcher.fetch("file:///test/does-not-exist.txt");

      expect(result.status).toBe("not_found");
      expect(result.content).toEqual(Buffer.from(""));
    });

    it("should return SUCCESS when fetching a new file without an etag", async () => {
      const fetcher = new FileFetcher();
      const filePath = "/test/file.txt";

      vol.fromJSON({
        [filePath]: "content",
      });

      // Fetch without etag should always return SUCCESS
      const result = await fetcher.fetch(`file://${filePath}`);

      expect(result.status).toBe("success");
      expect(result.etag).toBeTruthy();
      expect(result.content.toString()).toBe("content");
    });
  });
});
