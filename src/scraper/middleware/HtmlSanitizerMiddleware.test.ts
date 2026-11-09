import * as cheerio from "cheerio";
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

/** Sanitizes the HTML with a fresh middleware and returns the resulting DOM. */
async function sanitize(
  html: string,
  excludeSelectors: string[] = [],
): Promise<cheerio.CheerioAPI> {
  const middleware = new HtmlSanitizerMiddleware();
  const context = createMockContext(html, undefined, { excludeSelectors });
  const next = vi.fn().mockResolvedValue(undefined);

  await middleware.process(context, next);

  expect(next).toHaveBeenCalledOnce();
  expect(context.errors).toHaveLength(0);
  if (!context.dom) throw new Error("DOM not defined");
  return context.dom;
}

describe("HtmlSanitizerMiddleware", () => {
  it("should remove default chrome and custom excludeSelectors and keep the rest", async () => {
    const $ = await sanitize(
      `
      <html><body>
        <nav>Navigation</nav>
        <div class="keep-me">Keep</div>
        <div class="remove-me">Remove Class</div>
        <p id="specific-id">Remove ID</p>
        <p id="keep-id">Keep ID</p>
        <footer>Footer info</footer>
      </body></html>`,
      [".remove-me", "#specific-id"],
    );

    expect($("nav").length).toBe(0);
    expect($("footer").length).toBe(0);
    expect($(".remove-me").length).toBe(0);
    expect($("#specific-id").length).toBe(0);
    expect($(".keep-me").text()).toBe("Keep");
    expect($("#keep-id").text()).toBe("Keep ID");
  });

  it("should skip processing if context.dom is missing for HTML content", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    const context = createMockContext(); // No HTML content, dom is undefined
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.errors).toHaveLength(0);
  });

  it("should strip ads, search widgets, skip-links and breadcrumbs by default", async () => {
    const cases: Array<{
      label: string;
      html: string;
      removed: string[];
      kept: Array<[selector: string, text: string]>;
    }> = [
      {
        label: "Carbon Ads",
        html: `
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
            <img src="https://sp.analytics.yahoo.com/spp.pl?a=abc" />
            <h1>HMR API</h1>
            <p>Real documentation content describing the HMR API.</p>
          </main>`,
        removed: [
          "#carbonads",
          'img[src*="bidr.io"]',
          'img[src*="adsrvr.org"]',
          'img[src*="analytics.yahoo.com"]',
        ],
        kept: [
          ["h1", "HMR API"],
          ["p", "Real documentation content"],
        ],
      },
      {
        label: "EthicalAds and Google AdSense",
        html: `
          <main>
            <div data-ea-publisher="readthedocs" class="ethical-rtd">
              <a href="https://server.ethicalads.io/proxy/click/abc/">Sponsored</a>
            </div>
            <ins class="adsbygoogle" data-ad-client="ca-pub-x"></ins>
            <iframe id="google_ads_iframe_abc"></iframe>
            <h2>Configuration</h2>
          </main>`,
        removed: [
          ".ethical-rtd",
          "[data-ea-publisher]",
          ".adsbygoogle",
          '[id^="google_ads_iframe"]',
        ],
        kept: [["h2", "Configuration"]],
      },
      {
        label: "Algolia DocSearch and MkDocs search results",
        html: `
          <main>
            <button class="DocSearch DocSearch-Button">Search ⌘K</button>
            <div class="md-search-result">
              <ol class="md-search-result__list"><li>Stale result</li></ol>
            </div>
            <h1>Guide</h1>
          </main>`,
        removed: [".DocSearch-Button", ".md-search-result"],
        kept: [["h1", "Guide"]],
      },
      {
        label: "skip-links and breadcrumbs",
        html: `
          <a href="#main" class="sr-only">Skip to main content</a>
          <a href="#nav" class="skip-link">Skip navigation</a>
          <ol aria-label="breadcrumb">
            <li><a href="/">Home</a></li>
            <li>Current</li>
          </ol>
          <ol itemscope itemtype="https://schema.org/BreadcrumbList">
            <li>Crumb</li>
          </ol>
          <main>
            <h1>Page Title</h1>
            <span class="sr-only">Search</span>
          </main>`,
        removed: [
          "a.sr-only",
          "a.skip-link",
          '[aria-label="breadcrumb"]',
          '[itemtype*="BreadcrumbList"]',
        ],
        kept: [
          ["h1", "Page Title"],
          // The sr-only rule is scoped to <a>, so an icon-button's label survives.
          ["span.sr-only", "Search"],
        ],
      },
    ];

    for (const { label, html, removed, kept } of cases) {
      const $ = await sanitize(`<html><body>${html}</body></html>`);

      for (const selector of removed) {
        expect.soft($(selector).length, `${label}: ${selector}`).toBe(0);
      }
      for (const [selector, text] of kept) {
        expect.soft($(selector).text(), `${label}: ${selector}`).toContain(text);
      }
    }
  });

  it("should keep prose, code and links that only mention ad networks", async () => {
    const cases: Array<{
      label: string;
      html: string;
      kept: Array<[selector: string, text: string]>;
    }> = [
      {
        // Regression: the click-redirect host (srv.carbonads.net) is the ad-only
        // host; the apex (carbonads.net) is the human-facing landing page that a
        // docs page discussing monetization might legitimately link to.
        label: "link to the Carbon Ads apex domain",
        html: `
          <main>
            <h1>How we fund this project</h1>
            <p>
              We monetize via
              <a href="https://carbonads.net/">Carbon Ads</a> — see their site
              for advertiser information.
            </p>
          </main>`,
        kept: [
          ['a[href="https://carbonads.net/"]', "Carbon Ads"],
          ["p", "Carbon Ads"],
        ],
      },
      {
        label: "prose and code naming ad hosts",
        html: `
          <main>
            <h1>How third-party ads work</h1>
            <p>
              Networks like Carbon load their assets from
              <code>srv.carbonads.net</code> and track clicks via
              <code>bidr.io</code>.
            </p>
            <pre><code>&lt;img src="https://srv.carbonads.net/example.png" /&gt;</code></pre>
          </main>`,
        kept: [
          ["h1", "How third-party ads work"],
          ["p", "srv.carbonads.net"],
          ["p", "bidr.io"],
          ["pre code", "srv.carbonads.net"],
        ],
      },
    ];

    for (const { label, html, kept } of cases) {
      const $ = await sanitize(`<html><body>${html}</body></html>`);

      for (const [selector, text] of kept) {
        expect.soft($(selector).text(), `${label}: ${selector}`).toContain(text);
      }
    }
  });

  it("should drop promo chrome that sits outside the main content region", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    // Mirrors VitePress: the promo banner lives in a plain <div class="aside">
    // that no selector in the deny list matches, and renders before <main>.
    const html = `
      <html><body>
        <div class="aside">
          <a class="viteconf" href="https://example.com/conf">
            <img src="/conf.svg" alt="Conf Logo"><span>Conference 2025 View the replays</span>
          </a>
        </div>
        <main>
          <h1>Server-Side Rendering</h1>
          <p>SSR specifically refers to front-end frameworks that support running the same application in Node.js, pre-rendering it to HTML, and finally hydrating it on the client.</p>
        </main>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    const $ = context.dom;
    expect($).toBeDefined();
    expect($?.("body").text()).not.toContain("Conference 2025");
    expect($?.("a.viteconf").length).toBe(0);
    expect($?.("h1").text()).toBe("Server-Side Rendering");
    expect($?.("body").text()).toContain("SSR specifically refers");
  });

  it("should keep every declared region when a page declares several", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    // Multiple <main> elements are invalid but common in generated markup —
    // a stub from a layout template beside the real one. Keeping only the
    // richest costs a few characters of chrome here, but on a page whose
    // second region is a real section it silently dropped the whole thing,
    // so both are kept and the chrome is tolerated.
    const html = `
      <html><body>
        <main class="stub"><p>Menu</p></main>
        <main class="real">
          <h1>Deployment</h1>
          <p>Build the site, upload the output directory to your host, and point the domain at it. The generated files are fully static and need no runtime.</p>
        </main>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    const $ = context.dom;
    expect($?.("main.real").length).toBe(1);
    expect($?.("body").text()).toContain("Build the site");
    // Everything outside the declared regions is still gone.
    expect($?.("body").children().toArray()).toHaveLength(2);
  });

  it("should not drop a second content region of comparable size", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    // Two co-equal regions score exactly at the ratio floor when only the
    // winner is measured, so the guard could not catch this: one whole region
    // was discarded with nothing above debug logging to say so.
    const html = `
      <html><body>
        <main id="guide"><p>Guide prose about configuring the widget factory properly.</p></main>
        <main id="api"><p>API reference prose listing every exported helper function.</p></main>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    const text = context.dom?.("body").text() ?? "";
    expect(text).toContain("widget factory");
    expect(text).toContain("exported helper");
  });

  it("should not duplicate a region nested inside another region", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    // Nested <main> elements, not <main> around role=main: the candidate set is
    // `$("main")` whenever any exists, so a nested role=main is never a
    // candidate and would not exercise the guard at all.
    const html = `
      <html><body>
        <main><main><p>Configure the deployment target before building the site output.</p></main></main>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    const text = context.dom?.("body").text() ?? "";
    expect(text.split("Configure the deployment target")).toHaveLength(2);
  });

  it("should fall back to role=main when the page has no main element", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    const html = `
      <html><body>
        <div class="fork-ribbon"><a href="https://example.com/repo">Fork me on GitHub</a></div>
        <div role="main">
          <h1>Quickstart</h1>
          <p>Eager to get started? This page gives a good introduction to the library and how to install it before diving into the rest of the documentation.</p>
        </div>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    const $ = context.dom;
    expect($?.("body").text()).not.toContain("Fork me on GitHub");
    expect($?.("body").text()).toContain("Eager to get started");
  });

  it("should keep the full body when the main region holds little of the text", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    // Some pages mark a small shell as <main> while the prose lives beside it.
    const html = `
      <html><body>
        <main><p>Loading…</p></main>
        <div class="content">
          <h1>Configuration</h1>
          <p>Every option below can be set from the command line, from the environment, or from a configuration file, and the precedence between those three sources is fixed.</p>
        </div>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    const $ = context.dom;
    expect($?.("body").text()).toContain("Every option below");
    expect($?.("body").text()).toContain("Loading");
  });

  it("should leave content untouched when the page declares no main region", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    const html = `
      <html><body>
        <div class="doc"><h1>Title</h1><p>Body text that has no declared main region around it.</p></div>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    const $ = context.dom;
    expect($?.("div.doc").length).toBe(1);
    expect($?.("body").text()).toContain("no declared main region");
  });

  it("should scope a pretty-printed page whose indentation outnumbers its text", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    // Generated markup is often deeply indented, and removing a chrome element
    // leaves its surrounding whitespace node behind — outside <main>. Counting
    // that raw whitespace as content deflates the region's share and can push
    // a dominant <main> under the floor, so the banner survives.
    const gap = "\n          ".repeat(20);
    const html = `
      <html><body>
        <div class="aside">${gap}
          <a class="sponsor" href="https://example.com/sponsor">Sponsor</a>${gap}
        </div>${gap}
        <main>
          <h1>Configuration reference</h1>
        </main>${gap}
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    const $ = context.dom;
    expect($?.("body").text()).not.toContain("Sponsor");
    expect($?.("h1").text()).toBe("Configuration reference");
  });
});
