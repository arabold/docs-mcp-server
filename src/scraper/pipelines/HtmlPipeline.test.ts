// Copyright (c) 2025
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FetchStatus, type RawContent } from "../fetcher/types";
import { HtmlCheerioParserMiddleware } from "../middleware/HtmlCheerioParserMiddleware";
import { HtmlLinkExtractorMiddleware } from "../middleware/HtmlLinkExtractorMiddleware";
import { HtmlMetadataExtractorMiddleware } from "../middleware/HtmlMetadataExtractorMiddleware";
import { HtmlSanitizerMiddleware } from "../middleware/HtmlSanitizerMiddleware";
import { HtmlToMarkdownMiddleware } from "../middleware/HtmlToMarkdownMiddleware";
import { ScrapeMode, type ScraperOptions } from "../types";
import { HtmlPipeline } from "./HtmlPipeline";

describe("HtmlPipeline", () => {
  beforeEach(() => {
    // Set up spies without mock implementations to use real middleware
    vi.spyOn(HtmlCheerioParserMiddleware.prototype, "process");
    vi.spyOn(HtmlMetadataExtractorMiddleware.prototype, "process");
    vi.spyOn(HtmlLinkExtractorMiddleware.prototype, "process");
    vi.spyOn(HtmlSanitizerMiddleware.prototype, "process");
    vi.spyOn(HtmlToMarkdownMiddleware.prototype, "process");
  });

  it("canProcess returns true for text/html", () => {
    const pipeline = new HtmlPipeline();
    expect(pipeline.canProcess("text/html")).toBe(true);
    expect(pipeline.canProcess("application/xhtml+xml")).toBe(true);
  });

  it("canProcess returns false for non-html", () => {
    const pipeline = new HtmlPipeline();
    expect(pipeline.canProcess("text/markdown")).toBe(false);
    expect(pipeline.canProcess("")).toBe(false);
  });

  it("process decodes Buffer content with UTF-8 charset", async () => {
    const pipeline = new HtmlPipeline();
    const raw: RawContent = {
      content: Buffer.from("<html><body>abc</body></html>", "utf-8"),
      mimeType: "text/html",
      charset: "utf-8",
      source: "http://test",
      status: FetchStatus.SUCCESS,
    };
    const result = await pipeline.process(raw, {} as ScraperOptions);
    // Check that we got some markdown content (exact format depends on the actual middleware)
    expect(result.textContent).toBeTruthy();
    expect(result.textContent).toContain("abc");
  });

  it("process decodes Buffer content with ISO-8859-1 charset", async () => {
    // Create a spy to capture the content before it's processed
    let capturedContent = "";
    const originalProcess = HtmlCheerioParserMiddleware.prototype.process;
    vi.spyOn(HtmlCheerioParserMiddleware.prototype, "process").mockImplementationOnce(
      async function (this: HtmlCheerioParserMiddleware, ctx, next) {
        capturedContent = ctx.content;
        // Call the original implementation after capturing
        return originalProcess.call(this, ctx, next);
      },
    );

    const pipeline = new HtmlPipeline();
    // Create a buffer with ISO-8859-1 encoding (Latin-1)
    // This contains characters that would be encoded differently in UTF-8
    const raw: RawContent = {
      content: Buffer.from("<html><body>Café</body></html>", "latin1"),
      mimeType: "text/html",
      charset: "iso-8859-1", // Explicitly set charset to ISO-8859-1
      source: "http://test",
      status: FetchStatus.SUCCESS,
    };
    const result = await pipeline.process(raw, {} as ScraperOptions);

    // Verify the content was properly decoded
    expect(capturedContent).toBe("<html><body>Café</body></html>");

    // Check that we got some markdown content (exact format depends on the actual middleware)
    expect(result.textContent).toBeTruthy();
    expect(result.textContent).toContain("Café");
  });

  it("process defaults to UTF-8 when charset is not specified", async () => {
    const pipeline = new HtmlPipeline();
    const raw: RawContent = {
      content: Buffer.from("<html><body>abc</body></html>", "utf-8"),
      mimeType: "text/html",
      // No charset specified
      source: "http://test",
      status: FetchStatus.SUCCESS,
    };
    const result = await pipeline.process(raw, {} as ScraperOptions);
    // Check that we got some markdown content (exact format depends on the actual middleware)
    expect(result.textContent).toBeTruthy();
    expect(result.textContent).toContain("abc");
  });

  it("process uses string content directly", async () => {
    const pipeline = new HtmlPipeline();
    const raw: RawContent = {
      content: "<html><body>abc</body></html>",
      mimeType: "text/html",
      charset: "utf-8",
      source: "http://test",
      status: FetchStatus.SUCCESS,
    };
    const result = await pipeline.process(raw, {} as ScraperOptions);
    // Check that we got some markdown content (exact format depends on the actual middleware)
    expect(result.textContent).toBeTruthy();
    expect(result.textContent).toContain("abc");
  });

  it("process decodes Buffer content with UTF-16LE BOM", async () => {
    const pipeline = new HtmlPipeline();
    // UTF-16LE BOM: 0xFF 0xFE, then 'abc' as UTF-16LE
    const buf = Buffer.from([0xff, 0xfe, 0x61, 0x00, 0x62, 0x00, 0x63, 0x00]);
    const raw: RawContent = {
      content: buf,
      mimeType: "text/html",
      charset: "utf-16le",
      source: "http://test",
      status: FetchStatus.SUCCESS,
    };
    const result = await pipeline.process(raw, {} as ScraperOptions);
    expect(result.textContent).toContain("abc");
  });

  it("process decodes Buffer content with UTF-8 BOM", async () => {
    const pipeline = new HtmlPipeline();
    // UTF-8 BOM: 0xEF 0xBB 0xBF, then 'abc'
    const buf = Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x62, 0x63]);
    const raw: RawContent = {
      content: buf,
      mimeType: "text/html",
      charset: "utf-8",
      source: "http://test",
      status: FetchStatus.SUCCESS,
    };
    const result = await pipeline.process(raw, {} as ScraperOptions);
    expect(result.textContent).toContain("abc");
  });

  it("process decodes Buffer content with Japanese UTF-8 text", async () => {
    const pipeline = new HtmlPipeline();
    const japanese = "<html><body>こんにちは世界</body></html>"; // "Hello, world" in Japanese
    const raw: RawContent = {
      content: Buffer.from(japanese, "utf-8"),
      mimeType: "text/html",
      charset: "utf-8",
      source: "http://test",
      status: FetchStatus.SUCCESS,
    };
    const result = await pipeline.process(raw, {} as ScraperOptions);
    expect(result.textContent).toContain("こんにちは世界");
  });

  it("process decodes Buffer content with Russian UTF-8 text", async () => {
    const pipeline = new HtmlPipeline();
    const russian = "<html><body>Привет, мир</body></html>"; // "Hello, world" in Russian
    const raw: RawContent = {
      content: Buffer.from(russian, "utf-8"),
      mimeType: "text/html",
      charset: "utf-8",
      source: "http://test",
      status: FetchStatus.SUCCESS,
    };
    const result = await pipeline.process(raw, {} as ScraperOptions);
    expect(result.textContent).toContain("Привет, мир");
  });

  it("process calls middleware in order and aggregates results", async () => {
    const pipeline = new HtmlPipeline();
    const html = `
      <html>
        <head>
          <title>Test Title</title>
        </head>
        <body>
          <p>This is a <a href="https://test.link/">test link</a>.</p>
        </body>
      </html>
    `;
    const raw: RawContent = {
      content: html,
      mimeType: "text/html",
      charset: "utf-8",
      source: "http://test",
      status: FetchStatus.SUCCESS,
    };
    const result = await pipeline.process(raw, {} as ScraperOptions);

    // Verify all middleware was called
    expect(HtmlCheerioParserMiddleware.prototype.process).toHaveBeenCalledTimes(1);
    expect(HtmlMetadataExtractorMiddleware.prototype.process).toHaveBeenCalledTimes(1);
    expect(HtmlLinkExtractorMiddleware.prototype.process).toHaveBeenCalledTimes(1);
    expect(HtmlSanitizerMiddleware.prototype.process).toHaveBeenCalledTimes(1);
    expect(HtmlToMarkdownMiddleware.prototype.process).toHaveBeenCalledTimes(1);

    // Verify the result contains expected data from the actual middleware
    expect(result.title).toBe("Test Title");
    expect(result.links).toContain("https://test.link/");
    expect(result.textContent).toBeTruthy();
    expect(result.textContent).toEqual("This is a [test link](https://test.link/).");
  });

  it("process collects errors from middleware", async () => {
    // Override with error-generating implementation just for this test
    vi.spyOn(HtmlMetadataExtractorMiddleware.prototype, "process").mockImplementationOnce(
      async (ctx, next) => {
        ctx.errors.push(new Error("fail"));
        await next();
      },
    );

    const pipeline = new HtmlPipeline();
    const raw: RawContent = {
      content: "<html><body>abc</body></html>",
      mimeType: "text/html",
      charset: "utf-8",
      source: "http://test",
      status: FetchStatus.SUCCESS,
    };
    const result = await pipeline.process(raw, {} as ScraperOptions);
    expect(result.errors?.some((e) => e.message === "fail")).toBe(true);
  });

  it("should correctly process HTML through the full standard middleware stack (E2E with spies)", async () => {
    // Reset call counts for all spies
    vi.clearAllMocks();

    const pipeline = new HtmlPipeline();

    // Sample HTML with elements for each middleware to process
    const html = `
      <html>
        <head>
          <title>Test Page</title>
          <meta name="description" content="A test page for E2E testing">
        </head>
        <body>
          <h1>Hello World</h1>
          <p>This is a <a href="https://example.com/test/link">test link</a>.</p>
          <script>alert('This should be sanitized');</script>
          <img src="image.jpg" onerror="alert('This attribute should be sanitized');">
        </body>
      </html>
    `;

    const raw: RawContent = {
      content: html,
      mimeType: "text/html",
      charset: "utf-8",
      source: "http://test.example.com",
      status: FetchStatus.SUCCESS,
    };

    const result = await pipeline.process(raw, {
      url: "http://example.com",
      library: "example",
      version: "",
      scrapeMode: ScrapeMode.Fetch,
    });

    // Verify all middleware was called
    expect(HtmlCheerioParserMiddleware.prototype.process).toHaveBeenCalledTimes(1);
    expect(HtmlMetadataExtractorMiddleware.prototype.process).toHaveBeenCalledTimes(1);
    expect(HtmlLinkExtractorMiddleware.prototype.process).toHaveBeenCalledTimes(1);
    expect(HtmlSanitizerMiddleware.prototype.process).toHaveBeenCalledTimes(1);
    expect(HtmlToMarkdownMiddleware.prototype.process).toHaveBeenCalledTimes(1);

    // Verify the result contains expected data
    // The exact values will depend on the actual middleware implementations
    expect(result.title).toBe("Test Page");
    expect(result.links).toContain("https://example.com/test/link");

    // Verify contentType was updated to markdown after HTML conversion
    expect(result.contentType).toBe("text/markdown");

    // Verify the content was sanitized (no script tags) and converted to markdown
    expect(result.textContent).not.toContain("alert");
    expect(result.textContent).toContain("Hello World");
    expect(result.textContent).toContain("test link");

    // Verify no errors occurred
    expect(result.errors).toHaveLength(0);
  });

  it("should convert contentType from text/html to text/markdown", async () => {
    const pipeline = new HtmlPipeline();
    const html = `
      <html>
        <head><title>Mimetype Test</title></head>
        <body>
          <h1>Testing Content Type</h1>
          <p>This HTML should be converted to markdown.</p>
        </body>
      </html>
    `;

    const raw: RawContent = {
      content: html,
      mimeType: "text/html",
      charset: "utf-8",
      source: "http://test.example.com",
      status: FetchStatus.SUCCESS,
    };

    const result = await pipeline.process(raw, {
      url: "http://example.com",
      library: "example",
      version: "",
      scrapeMode: ScrapeMode.Fetch,
    });

    // Verify contentType was transformed from HTML to Markdown
    expect(result.contentType).toBe("text/markdown");
    expect(result.contentType).not.toBe("text/html");

    // Verify content is in markdown format
    expect(result.textContent).toContain("# Testing Content Type");
    expect(result.textContent).toContain("This HTML should be converted to markdown");
  });

  describe("cleanup", () => {
    it("should call closeBrowser on Playwright middleware when close() is called", async () => {
      const pipeline = new HtmlPipeline();

      // Spy on the closeBrowser method
      const closeBrowserSpy = vi.spyOn(
        (pipeline as any).playwrightMiddleware,
        "closeBrowser",
      );

      await pipeline.close();

      expect(closeBrowserSpy).toHaveBeenCalledOnce();
    });

    it("should be idempotent - multiple close() calls should not error", async () => {
      const pipeline = new HtmlPipeline();

      // Multiple calls should not throw
      await expect(pipeline.close()).resolves.not.toThrow();
      await expect(pipeline.close()).resolves.not.toThrow();
      await expect(pipeline.close()).resolves.not.toThrow();
    });

    it("should call close() even if closeBrowser throws an error", async () => {
      const pipeline = new HtmlPipeline();

      // Mock closeBrowser to throw an error
      vi.spyOn((pipeline as any).playwrightMiddleware, "closeBrowser").mockRejectedValue(
        new Error("Browser cleanup failed"),
      );

      // close() should still complete (error should be handled internally or thrown)
      await expect(pipeline.close()).rejects.toThrow("Browser cleanup failed");
    });
  });
});
