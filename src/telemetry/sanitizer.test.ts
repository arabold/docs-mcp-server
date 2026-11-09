import { describe, expect, it } from "vitest";
import {
  extractHostname,
  extractProtocol,
  sanitizeErrorForTracking,
  sanitizeErrorMessage,
} from "./sanitizer";

describe("extractHostname", () => {
  it("should extract hostname from various URL formats", () => {
    expect(extractHostname("https://example.com/path")).toBe("example.com");
    expect(extractHostname("http://subdomain.example.com")).toBe("subdomain.example.com");
    expect(extractHostname("https://docs.example.com/api/v1")).toBe("docs.example.com");
    expect(extractHostname("invalid-url")).toBe("invalid-hostname");
    expect(extractHostname("")).toBe("invalid-hostname");
  });
});

describe("extractProtocol", () => {
  it("should extract protocol from URLs", () => {
    expect(extractProtocol("https://example.com")).toBe("https");
    expect(extractProtocol("http://example.com")).toBe("http");
    expect(extractProtocol("file:///path/to/file")).toBe("file");
    expect(extractProtocol("invalid-url")).toBe("unknown");
    expect(extractProtocol("")).toBe("unknown");
  });
});

describe("sanitizeErrorMessage", () => {
  it("removes paths, file URLs, URLs and credentials, and keeps slashes that are not paths", () => {
    const cases = [
      { message: "Error in /Users/john/project/file.js", sanitized: "Error in [path]" },
      {
        message: "Failed to read file:///Users/john/documents/secret.txt",
        sanitized: "Failed to read [file-url]",
      },
      { message: "Cannot access ./local/config.json", sanitized: "Cannot access [path]" },
      { message: "api_key=secret123 invalid", sanitized: "api_key=[redacted] invalid" },
      // URLs with paths and query strings
      {
        message: "HTTP 404 for https://intranet.example.com/team/doc?q=secret",
        sanitized: "HTTP 404 for [url]",
      },
      // Absolute paths without a file extension
      {
        message: "ENOENT: no such file or directory, scandir '/home/john/private-docs'",
        sanitized: "ENOENT: no such file or directory, scandir '[path]'",
      },
      // Single-component absolute paths
      { message: "scandir '/private-docs'", sanitized: "scandir '[path]'" },
      { message: "cannot open /private-docs", sanitized: "cannot open [path]" },
      // Paths with spaces
      {
        message: "scandir '/Users/Jane Doe/private-docs'",
        sanitized: "scandir '[path]'",
      },
      {
        message: "open C:\\Users\\Jane Doe\\docs failed",
        sanitized: "open [path] failed",
      },
      // Slashes that are not paths
      {
        message: "HTTP/1.1 503 on 2024/10/18, retry and/or wait",
        sanitized: "HTTP/1.1 503 on 2024/10/18, retry and/or wait",
      },
    ];

    for (const { message, sanitized } of cases) {
      expect.soft(sanitizeErrorMessage(message), message).toBe(sanitized);
    }
  });
});

describe("sanitizeErrorForTracking", () => {
  it("should keep the error name and sanitize the message", () => {
    const error = new TypeError("Failed to fetch https://secret.example.com/api");

    const sanitized = sanitizeErrorForTracking(error);

    expect(sanitized.name).toBe("TypeError");
    expect(sanitized.message).toBe("Failed to fetch [url]");
  });

  it("shortens stack frame paths to file names or package paths", () => {
    const cases = [
      {
        frame: "    at run (/Users/john/project/dist/index.js:10:5)",
        shortened: "    at run (index.js:10:5)",
      },
      {
        frame:
          "    at file:///home/john/.npm/_npx/abc/node_modules/better-sqlite3/lib/database.js:3:1",
        shortened: "    at better-sqlite3/lib/database.js:3:1",
      },
      {
        frame: "    at C:\\Users\\john\\app\\server.js:7:2",
        shortened: "    at server.js:7:2",
      },
      {
        frame:
          "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
        shortened:
          "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
      },
      // Query strings and fragments are dropped from URL frames
      {
        frame:
          "    at eval (https://intranet.example.com/private-module.js?token=secret:3:7)",
        shortened: "    at eval (private-module.js:3:7)",
      },
      {
        frame: "    at load (https://intranet.example.com/loader.js#secret:1:2)",
        shortened: "    at load (loader.js:1:2)",
      },
      // A line but no column
      {
        frame: "    at load (/Users/john/private-docs/loader.js:10)",
        shortened: "    at load (loader.js:10)",
      },
      // Frames without a file location are kept
      {
        frame: "    at async Promise.all (index 0)",
        shortened: "    at async Promise.all (index 0)",
      },
    ];

    for (const { frame, shortened } of cases) {
      const error = new Error("boom");
      error.stack = `Error: boom\n${frame}`;

      expect
        .soft(sanitizeErrorForTracking(error).stack, frame)
        .toBe(`Error: boom\n${shortened}`);
    }
  });

  it("should drop lines that are not stack frames", () => {
    const error = new Error(
      "Request failed\n    at https://private.example/docs?token=secret",
    );

    const sanitized = sanitizeErrorForTracking(error);

    expect(sanitized.stack).not.toContain("private.example");
    expect(sanitized.stack).not.toContain("secret");
  });

  it("should drop the original message from the stack", () => {
    const error = new Error("Cannot open /Users/john/secret/notes");

    const sanitized = sanitizeErrorForTracking(error);

    expect(sanitized.stack).not.toContain("john");
    expect(sanitized.stack?.split("\n")[0]).toBe("Error: Cannot open [path]");
  });

  it("should sanitize the error cause", () => {
    const error = new Error("Scrape failed", {
      cause: new Error("Request to https://secret.example.com/x failed"),
    });

    const sanitized = sanitizeErrorForTracking(error);

    expect((sanitized.cause as Error).message).toBe("Request to [url] failed");
  });
});
