import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../utils/config";
import { FetchStatus, type RawContent } from "../fetcher/types";
import { HtmlMetadataExtractorMiddleware } from "../middleware/HtmlMetadataExtractorMiddleware";
import { HtmlPlaywrightMiddleware } from "../middleware/HtmlPlaywrightMiddleware";
import { ScrapeMode, type ScraperOptions } from "../types";
import { HtmlPipeline } from "./HtmlPipeline";

const appConfig = loadConfig();

function options(scrapeMode: ScrapeMode | undefined = ScrapeMode.Fetch): ScraperOptions {
  return { url: "https://example.com/", library: "example", version: "", scrapeMode };
}

function html(content: string | Buffer, charset?: string): RawContent {
  return {
    content,
    mimeType: "text/html",
    charset,
    source: "https://example.com/page",
    status: FetchStatus.SUCCESS,
  };
}

describe("HtmlPipeline", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["text/html", true],
    ["application/xhtml+xml", true],
    ["text/markdown", false],
    ["", false],
  ])("canProcess(%j) is %s", (mimeType, expected) => {
    expect(new HtmlPipeline(appConfig).canProcess(mimeType)).toBe(expected);
  });

  describe("decoding", () => {
    it.each([
      ["UTF-8", Buffer.from("<p>naïve café</p>", "utf-8"), "utf-8", "naïve café"],
      [
        "ISO-8859-1",
        Buffer.from("<p>naïve café</p>", "latin1"),
        "iso-8859-1",
        "naïve café",
      ],
      [
        "no charset as UTF-8",
        Buffer.from("<p>Привет, мир</p>", "utf-8"),
        undefined,
        "Привет, мир",
      ],
      [
        "Japanese UTF-8",
        Buffer.from("<p>こんにちは世界</p>", "utf-8"),
        "utf-8",
        "こんにちは世界",
      ],
      [
        "a UTF-16LE BOM",
        Buffer.from([0xff, 0xfe, 0x61, 0x00, 0x62, 0x00, 0x63, 0x00]),
        "utf-16le",
        "abc",
      ],
      ["a UTF-8 BOM", Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x62, 0x63]), "utf-8", "abc"],
      ["a string as is", "<p>naïve café</p>", "iso-8859-1", "naïve café"],
    ])("decodes %s", async (_label, content, charset, expected) => {
      const result = await new HtmlPipeline(appConfig).process(
        html(content, charset),
        options(),
      );

      expect(result.textContent).toContain(expected);
    });

    it("prefers a meta charset over the HTTP header charset", async () => {
      const page = `<!DOCTYPE html><html><head><meta charset="iso-8859-1"><title>T</title></head>
        <body><p>Special characters: café, résumé, naïve</p></body></html>`;

      const result = await new HtmlPipeline(appConfig).process(
        html(Buffer.from(page, "latin1"), "utf-8"),
        options(),
      );

      expect(result.textContent).toContain("café, résumé, naïve");
      expect(result.textContent).not.toContain("cafÃ©");
    });
  });

  it("returns the title, the links and sanitized Markdown of the page", async () => {
    const page = `
      <html>
        <head>
          <title>Test Page</title>
          <meta name="description" content="A test page">
        </head>
        <body>
          <h1>Hello World</h1>
          <p>This is a <a href="https://example.com/test/link">test link</a>.</p>
          <script>alert('This should be sanitized');</script>
          <img src="image.jpg" onerror="alert('This attribute should be sanitized');">
        </body>
      </html>
    `;

    const result = await new HtmlPipeline(appConfig).process(
      html(page, "utf-8"),
      options(),
    );

    expect(result.title).toBe("Test Page");
    expect(result.links).toContain("https://example.com/test/link");
    expect(result.contentType).toBe("text/markdown");
    expect(result.textContent).toContain("# Hello World");
    expect(result.textContent).toContain(
      "This is a [test link](https://example.com/test/link).",
    );
    expect(result.textContent).not.toContain("alert");
    expect(result.errors).toEqual([]);
    expect(result.chunks?.length).toBeGreaterThan(0);
  });

  it("discovers links inside removed chrome and keeps that chrome out of the content", async () => {
    // Link discovery must read the complete document, before extraction
    // discards anything. These sibling links exist only inside a <nav>
    // landmark, which the extractor removes, and outside <main>, which
    // region scoping discards — so reordering the extractor ahead of link
    // extraction would silently shrink every crawl frontier.
    const page = `
      <html>
        <head><title>Routing</title></head>
        <body>
          <nav>
            <a href="https://example.com/guide/install">Installation</a>
            <a href="https://example.com/guide/config">Configuration</a>
          </nav>
          <main>
            <h1>Routing</h1>
            <p>Routes are declared in the configuration file and resolved in the order they appear.</p>
          </main>
        </body>
      </html>
    `;

    const result = await new HtmlPipeline(appConfig).process(
      html(page, "utf-8"),
      options(),
    );

    // The crawler is still offered both sibling URLs...
    expect(result.links).toContain("https://example.com/guide/install");
    expect(result.links).toContain("https://example.com/guide/config");

    // ...while the navigation itself stays out of the indexed content.
    expect(result.textContent).not.toContain("Installation");
    expect(result.textContent).not.toContain("Configuration");
    expect(result.textContent).toContain("Routes are declared");
  });

  it("collects errors that middleware reports", async () => {
    vi.spyOn(HtmlMetadataExtractorMiddleware.prototype, "process").mockImplementationOnce(
      async (ctx, next) => {
        ctx.errors.push(new Error("fail"));
        await next();
      },
    );

    const result = await new HtmlPipeline(appConfig).process(
      html("<html><body>abc</body></html>", "utf-8"),
      options(),
    );

    expect(result.errors?.map((e) => e.message)).toContain("fail");
  });

  // The pipeline treats a missing scrapeMode as "no browser", while
  // HtmlPlaywrightMiddleware on its own treats it as Auto. The pipeline decides
  // first, so a missing scrapeMode never renders.
  it.each([
    [ScrapeMode.Playwright, true],
    [ScrapeMode.Auto, true],
    [ScrapeMode.Fetch, false],
    [undefined, false],
  ])(
    "with scrapeMode %s uses the browser-rendered page: %s",
    async (scrapeMode, rendered) => {
      vi.spyOn(HtmlPlaywrightMiddleware.prototype, "process").mockImplementation(
        async (ctx, next) => {
          ctx.content = "<html><body><p>Rendered by the browser</p></body></html>";
          await next();
        },
      );

      const result = await new HtmlPipeline(appConfig).process(
        html("<html><body><p>Served by the server</p></body></html>", "utf-8"),
        options(scrapeMode),
      );

      expect(result.textContent).toContain(
        rendered ? "Rendered by the browser" : "Served by the server",
      );
    },
  );

  it("processes HTML via Defuddle when htmlExtractor is set to defuddle", async () => {
    // Verifies the lazy-loading path: HtmlPipeline only imports the Defuddle
    // module when `htmlExtractor: defuddle` is configured, and the resulting
    // pipeline produces clean markdown end-to-end on first process() call.
    const defuddleConfig = {
      ...appConfig,
      scraper: { ...appConfig.scraper, htmlExtractor: "defuddle" as const },
    };
    const pipeline = new HtmlPipeline(defuddleConfig);

    // Article body needs enough word count for Defuddle to score the main
    // element above the boilerplate.
    const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(40);
    const page = `
      <html><head><title>Defuddle pipeline test</title></head>
      <body>
        <nav class="site-nav">Top nav links</nav>
        <main><article>
          <h1>Defuddle pipeline test</h1>
          <p>${lorem}</p>
        </article></main>
        <footer class="site-footer">Footer copyright</footer>
      </body></html>`;

    const result = await pipeline.process(html(page, "utf-8"), options());

    expect(result.contentType).toBe("text/markdown");
    expect(result.textContent).toContain("Lorem ipsum");
    // Boilerplate stripped by Defuddle.
    expect(result.textContent).not.toContain("Top nav links");
    expect(result.textContent).not.toContain("Footer copyright");
    expect(result.errors).toHaveLength(0);
  });

  describe("close", () => {
    it("closes the browser", async () => {
      const closeBrowser = vi.spyOn(HtmlPlaywrightMiddleware.prototype, "closeBrowser");

      await new HtmlPipeline(appConfig).close();

      expect(closeBrowser).toHaveBeenCalledOnce();
    });

    it("can be called repeatedly", async () => {
      const pipeline = new HtmlPipeline(appConfig);

      await pipeline.close();
      await pipeline.close();
      await expect(pipeline.close()).resolves.toBeUndefined();
    });

    it("resolves even when closing the browser fails", async () => {
      vi.spyOn(HtmlPlaywrightMiddleware.prototype, "closeBrowser").mockRejectedValue(
        new Error("Browser cleanup failed"),
      );

      await expect(new HtmlPipeline(appConfig).close()).resolves.toBeUndefined();
    });
  });
});
