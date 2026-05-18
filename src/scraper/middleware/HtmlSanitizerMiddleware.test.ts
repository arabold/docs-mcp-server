import * as cheerio from "cheerio"; // Import cheerio
import { describe, expect, it, vi } from "vitest";
import type { ScraperOptions } from "../types";
import { HtmlSanitizerMiddleware } from "./HtmlSanitizerMiddleware";
import type { MiddlewareContext } from "./types";

// Helper to create a minimal valid ScraperOptions object
const createMockScraperOptions = (
  url = "http://example.com",
  excludeSelectors?: string[],
): ScraperOptions => ({
  url,
  library: "test-lib",
  version: "1.0.0",
  maxDepth: 0,
  maxPages: 1,
  maxConcurrency: 1,
  scope: "subpages",
  followRedirects: true,
  excludeSelectors: excludeSelectors || [],
  ignoreErrors: false,
});

const createMockContext = (
  htmlContent?: string,
  source = "http://example.com",
  options?: Partial<ScraperOptions>,
): MiddlewareContext => {
  const fullOptions = { ...createMockScraperOptions(source), ...options };
  const context: MiddlewareContext = {
    content: htmlContent || "",
    contentType: "text/html",
    source,
    links: [],
    errors: [],
    options: fullOptions,
  };
  if (htmlContent) {
    context.dom = cheerio.load(htmlContent);
  }
  return context;
};

describe("HtmlSanitizerMiddleware", () => {
  it("should remove default unwanted elements (nav, footer)", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    const html = `
      <html><body>
        <nav>Navigation</nav>
        <main>Main content</main>
        <footer>Footer info</footer>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    // Use Cheerio syntax for assertions
    expect(context.dom).toBeDefined();
    if (!context.dom) throw new Error("DOM not defined"); // Type guard
    expect(context.dom("nav").length).toBe(0); // Check element doesn't exist
    expect(context.dom("footer").length).toBe(0);
    expect(context.dom("main").text()).toBe("Main content");
    expect(context.errors).toHaveLength(0);

    // No close needed
  });

  it("should remove custom unwanted elements via excludeSelectors", async () => {
    const customSelectors = [".remove-me", "#specific-id"];
    const middleware = new HtmlSanitizerMiddleware();
    const html = `
      <html><body>
        <div class="keep-me">Keep</div>
        <div class="remove-me">Remove Class</div>
        <p id="specific-id">Remove ID</p>
        <p id="keep-id">Keep ID</p>
      </body></html>`;
    // Pass excludeSelectors via options in context creation
    const context = createMockContext(html, undefined, {
      excludeSelectors: customSelectors,
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    // Use Cheerio syntax for assertions
    expect(context.dom).toBeDefined();
    if (!context.dom) throw new Error("DOM not defined"); // Type guard
    expect(context.dom(".remove-me").length).toBe(0);
    expect(context.dom("#specific-id").length).toBe(0);
    expect(context.dom(".keep-me").length).toBe(1);
    expect(context.dom("#keep-id").length).toBe(1);
    expect(context.errors).toHaveLength(0);

    // No close needed
  });

  it("should combine default and custom selectors for removal", async () => {
    const customSelectors = [".remove-custom"];
    // Pass excludeSelectors via options in context creation AND middleware constructor
    // Note: The middleware constructor options are primarily for default behavior,
    // context options should ideally override or supplement. Let's test context options.
    const middleware = new HtmlSanitizerMiddleware(); // No constructor options here
    const html = `
      <html><body>
        <nav>Default Remove</nav>
        <div class="remove-custom">Custom Remove</div>
        <p>Keep</p>
      </body></html>`;
    const context = createMockContext(html, undefined, {
      excludeSelectors: customSelectors,
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    // Use Cheerio syntax for assertions
    expect(context.dom).toBeDefined();
    if (!context.dom) throw new Error("DOM not defined"); // Type guard
    expect(context.dom("nav").length).toBe(0);
    expect(context.dom(".remove-custom").length).toBe(0);
    expect(context.dom("p").text()).toBe("Keep");
    expect(context.errors).toHaveLength(0);

    // No close needed
  });

  it("should skip processing if context.dom is missing for HTML content", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    const context = createMockContext(); // No HTML content, dom is undefined
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.errors).toHaveLength(0);
  });

  it("should strip Carbon Ads markup while keeping surrounding content", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    const html = `
      <html><body>
        <main>
          <div id="carbonads">
            <span>
              <span class="carbon-wrap">
                <a href="https://srv.carbonads.net/ads/click/x/abc">
                  <img alt="ads via Carbon" src="https://srv.carbonads.net/static/30242/abc.png" />
                </a>
                <a class="carbon-text" href="https://srv.carbonads.net/ads/click/x/abc">
                  Frontend Masters - Become a Career-Ready Web Developer!
                </a>
                <a class="carbon-poweredby" href="https://carbonads.net/?utm_source=site">ads via Carbon</a>
              </span>
            </span>
            <img src="https://cnv.event.prod.bidr.io/log/cnv?tag_id=3503" />
            <img src="https://insight.adsrvr.org/track/pxl/?adv=abc" />
          </div>
          <h1>HMR API</h1>
          <p>Real documentation content describing the HMR API.</p>
        </main>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    if (!context.dom) throw new Error("DOM not defined");
    expect(context.dom("#carbonads").length).toBe(0);
    expect(context.dom('img[src*="bidr.io"]').length).toBe(0);
    expect(context.dom('img[src*="adsrvr.org"]').length).toBe(0);
    expect(context.dom("h1").text()).toBe("HMR API");
    expect(context.dom("p").text()).toContain("Real documentation content");
    expect(context.errors).toHaveLength(0);
  });

  it("should strip EthicalAds and Google AdSense markup", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    const html = `
      <html><body>
        <main>
          <div data-ea-publisher="readthedocs" class="ethical-rtd">
            <a href="https://server.ethicalads.io/proxy/click/abc/">Sponsored</a>
          </div>
          <ins class="adsbygoogle" data-ad-client="ca-pub-x"></ins>
          <iframe id="google_ads_iframe_abc"></iframe>
          <h2>Configuration</h2>
        </main>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    if (!context.dom) throw new Error("DOM not defined");
    expect(context.dom(".ethical-rtd").length).toBe(0);
    expect(context.dom("[data-ea-publisher]").length).toBe(0);
    expect(context.dom(".adsbygoogle").length).toBe(0);
    expect(context.dom('[id^="google_ads_iframe"]').length).toBe(0);
    expect(context.dom("h2").text()).toBe("Configuration");
  });

  it("should strip Algolia DocSearch and MkDocs search-result widgets", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    const html = `
      <html><body>
        <main>
          <button class="DocSearch DocSearch-Button">Search ⌘K</button>
          <div class="md-search-result">
            <ol class="md-search-result__list"><li>Stale result</li></ol>
          </div>
          <h1>Guide</h1>
        </main>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    if (!context.dom) throw new Error("DOM not defined");
    expect(context.dom(".DocSearch-Button").length).toBe(0);
    expect(context.dom(".md-search-result").length).toBe(0);
    expect(context.dom("h1").text()).toBe("Guide");
  });

  it("should strip skip-links and breadcrumb variants", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    const html = `
      <html><body>
        <a href="#main" class="sr-only">Skip to main content</a>
        <a href="#nav" class="skip-link">Skip navigation</a>
        <ol aria-label="breadcrumb">
          <li><a href="/">Home</a></li>
          <li>Current</li>
        </ol>
        <ol itemscope itemtype="https://schema.org/BreadcrumbList">
          <li>Crumb</li>
        </ol>
        <span class="sr-only">Search</span>
        <main><h1>Page Title</h1></main>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    if (!context.dom) throw new Error("DOM not defined");
    expect(context.dom("a.sr-only").length).toBe(0);
    expect(context.dom("a.skip-link").length).toBe(0);
    expect(context.dom('[aria-label="breadcrumb"]').length).toBe(0);
    expect(context.dom('[itemtype*="BreadcrumbList"]').length).toBe(0);
    expect(context.dom("span.sr-only").length).toBe(1);
    expect(context.dom("h1").text()).toBe("Page Title");
  });

  it("should not strip prose or code blocks that mention ad-network hostnames", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    const html = `
      <html><body>
        <main>
          <h1>How third-party ads work</h1>
          <p>
            Networks like Carbon load their assets from
            <code>srv.carbonads.net</code> and track clicks via
            <code>bidr.io</code>.
          </p>
          <pre><code>&lt;img src="https://srv.carbonads.net/example.png" /&gt;</code></pre>
        </main>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    if (!context.dom) throw new Error("DOM not defined");
    expect(context.dom("h1").text()).toBe("How third-party ads work");
    expect(context.dom("p").text()).toContain("srv.carbonads.net");
    expect(context.dom("p").text()).toContain("bidr.io");
    expect(context.dom("pre code").text()).toContain("srv.carbonads.net");
  });

  it("should skip processing if content type is not HTML", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    const context = createMockContext("<script>alert(1)</script>");
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.content).toBe("<script>alert(1)</script>"); // Content unchanged
    expect(context.errors).toHaveLength(0);
  });
});
