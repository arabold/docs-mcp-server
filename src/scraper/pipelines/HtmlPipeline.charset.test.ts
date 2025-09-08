import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawContent } from "../fetcher/types";
import { ScrapeMode } from "../types";
import { HtmlPipeline } from "./HtmlPipeline";

// Mock logger
vi.mock("../../utils/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("HtmlPipeline charset integration", () => {
  let pipeline: HtmlPipeline;

  beforeEach(() => {
    pipeline = new HtmlPipeline();
  });

  it("should use meta charset when it differs from HTTP header charset", async () => {
    // Simulate content that was served with wrong HTTP charset but has correct meta charset
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="iso-8859-1">
<title>Test Page</title>
</head>
<body>
<p>Special characters: café, résumé, naïve</p>
</body>
</html>`;

    // Create buffer with ISO-8859-1 encoding (as the meta tag specifies)
    const buffer = Buffer.from(htmlContent, "latin1");

    const rawContent: RawContent = {
      content: buffer,
      mimeType: "text/html",
      charset: "utf-8", // Wrong charset from HTTP header
      source: "https://example.com/test.html",
    };

    const result = await pipeline.process(rawContent, {
      url: "https://example.com/test.html",
      library: "test",
      version: "1.0.0",
      maxDepth: 1,
      maxPages: 1,
      maxConcurrency: 1,
      scope: "subpages",
      followRedirects: true,
      ignoreErrors: false,
      scrapeMode: ScrapeMode.Fetch,
    });

    // Should correctly decode the content using meta charset, not HTTP charset
    expect(result.textContent).toContain("café");
    expect(result.textContent).toContain("résumé");
    expect(result.textContent).toContain("naïve");
    expect(result.textContent).not.toContain("cafÃ©"); // This would indicate wrong UTF-8 decoding
  });

  it("should use HTTP charset when no meta charset is present", async () => {
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
<title>Test Page</title>
</head>
<body>
<p>Special characters: café, résumé, naïve</p>
</body>
</html>`;

    // Create buffer with ISO-8859-1 encoding
    const buffer = Buffer.from(htmlContent, "latin1");

    const rawContent: RawContent = {
      content: buffer,
      mimeType: "text/html",
      charset: "iso-8859-1", // Correct charset from HTTP header
      source: "https://example.com/test.html",
    };

    const result = await pipeline.process(rawContent, {
      url: "https://example.com/test.html",
      library: "test",
      version: "1.0.0",
      maxDepth: 1,
      maxPages: 1,
      maxConcurrency: 1,
      scope: "subpages",
      followRedirects: true,
      ignoreErrors: false,
      scrapeMode: ScrapeMode.Fetch,
    });

    // Should correctly decode using HTTP charset
    expect(result.textContent).toContain("café");
    expect(result.textContent).toContain("résumé");
    expect(result.textContent).toContain("naïve");
  });

  it("should default to UTF-8 when no charset information is available", async () => {
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
<title>Test Page</title>
</head>
<body>
<p>Simple ASCII content only</p>
</body>
</html>`;

    const buffer = Buffer.from(htmlContent, "utf-8");

    const rawContent: RawContent = {
      content: buffer,
      mimeType: "text/html",
      // No charset information
      source: "https://example.com/test.html",
    };

    const result = await pipeline.process(rawContent, {
      url: "https://example.com/test.html",
      library: "test",
      version: "1.0.0",
      maxDepth: 1,
      maxPages: 1,
      maxConcurrency: 1,
      scope: "subpages",
      followRedirects: true,
      ignoreErrors: false,
      scrapeMode: ScrapeMode.Fetch,
    });

    expect(result.textContent).toContain("Simple ASCII content only");
  });
});
