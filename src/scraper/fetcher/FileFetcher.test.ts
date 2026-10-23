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

  it("detects the MIME type from the file extension", async () => {
    const fetcher = new FileFetcher();
    const cases: Array<[extension: string, mimeType: string, content: string | Buffer]> =
      [
        [".html", "text/html", "<h1>Hello</h1>"],
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
        // An image keeps its own type, so no text pipeline claims it.
        [
          ".png",
          "image/png",
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        ],
      ];
    vol.fromJSON(
      Object.fromEntries(
        cases.map(([extension, , content]) => [`/code/file${extension}`, content]),
      ),
    );

    for (const [extension, mimeType] of cases) {
      const result = await fetcher.fetch(`file:///code/file${extension}`);
      expect.soft(result.mimeType, extension).toBe(mimeType);
    }
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
});
