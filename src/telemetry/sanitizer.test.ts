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
  it("should sanitize error messages removing sensitive info", () => {
    expect(sanitizeErrorMessage("Error in /Users/john/project/file.js")).toBe(
      "Error in [path]",
    );

    expect(
      sanitizeErrorMessage("Failed to read file:///Users/john/documents/secret.txt"),
    ).toBe("Failed to read [file-url]");

    expect(sanitizeErrorMessage("Cannot access ./local/config.json")).toBe(
      "Cannot access [path]",
    );

    expect(sanitizeErrorMessage("api_key=secret123 invalid")).toBe(
      "api_key=[redacted] invalid",
    );
  });

  it("should remove URLs with paths and query strings", () => {
    expect(
      sanitizeErrorMessage("HTTP 404 for https://intranet.example.com/team/doc?q=secret"),
    ).toBe("HTTP 404 for [url]");
  });

  it("should remove absolute paths without a file extension", () => {
    expect(
      sanitizeErrorMessage(
        "ENOENT: no such file or directory, scandir '/home/john/private-docs'",
      ),
    ).toBe("ENOENT: no such file or directory, scandir '[path]'");
  });
});

describe("sanitizeErrorForTracking", () => {
  it("should keep the error name and sanitize the message", () => {
    const error = new TypeError("Failed to fetch https://secret.example.com/api");

    const sanitized = sanitizeErrorForTracking(error);

    expect(sanitized.name).toBe("TypeError");
    expect(sanitized.message).toBe("Failed to fetch [url]");
  });

  it("should shorten stack frame paths to file names or package paths", () => {
    const error = new Error("boom");
    error.stack = [
      "Error: boom",
      "    at run (/Users/john/project/dist/index.js:10:5)",
      "    at file:///home/john/.npm/_npx/abc/node_modules/better-sqlite3/lib/database.js:3:1",
      "    at C:\\Users\\john\\app\\server.js:7:2",
      "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
    ].join("\n");

    const sanitized = sanitizeErrorForTracking(error);

    expect(sanitized.stack).toBe(
      [
        "Error: boom",
        "    at run (index.js:10:5)",
        "    at better-sqlite3/lib/database.js:3:1",
        "    at server.js:7:2",
        "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
      ].join("\n"),
    );
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
