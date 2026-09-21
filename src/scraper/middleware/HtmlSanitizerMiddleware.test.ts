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
          <img src="https://sp.analytics.yahoo.com/spp.pl?a=abc" />
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
    expect(context.dom('img[src*="analytics.yahoo.com"]').length).toBe(0);
    expect(context.dom("h1").text()).toBe("HMR API");
    expect(context.dom("p").text()).toContain("Real documentation content");
    expect(context.errors).toHaveLength(0);
  });

  it("should keep prose links to the Carbon Ads apex domain", async () => {
    // Regression: the click-redirect host (srv.carbonads.net) is the ad-only
    // host; the apex (carbonads.net) is the human-facing landing page that a
    // docs page discussing monetization might legitimately link to.
    const middleware = new HtmlSanitizerMiddleware();
    const html = `
      <html><body>
        <main>
          <h1>How we fund this project</h1>
          <p>
            We monetize via
            <a href="https://carbonads.net/">Carbon Ads</a> — see their site
            for advertiser information.
          </p>
        </main>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    if (!context.dom) throw new Error("DOM not defined");
    expect(context.dom('a[href="https://carbonads.net/"]').length).toBe(1);
    expect(context.dom("p").text()).toContain("Carbon Ads");
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
        <main>
          <h1>Page Title</h1>
          <span class="sr-only">Search</span>
        </main>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    if (!context.dom) throw new Error("DOM not defined");
    expect(context.dom("a.sr-only").length).toBe(0);
    expect(context.dom("a.skip-link").length).toBe(0);
    expect(context.dom('[aria-label="breadcrumb"]').length).toBe(0);
    expect(context.dom('[itemtype*="BreadcrumbList"]').length).toBe(0);
    // The sr-only rule is scoped to <a>, so an icon-button's label survives.
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

  it("should preserve text rather than emptying a page when exclusions remove everything", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    // The caller's selector matches the only element carrying visible text.
    // Emptying the page here would index a blank document; the extractor is
    // expected to fall back to the pre-sanitization body instead.
    const html = `
      <html><body>
        <div class="everything">
          <h1>Installation</h1>
          <p>Install the package with your package manager of choice, then add the plugin to your configuration file.</p>
        </div>
      </body></html>`;
    const context = createMockContext(html, "http://example.com", {
      excludeSelectors: [".everything"],
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    const $ = context.dom;
    expect($?.("body").text().trim()).not.toBe("");
    expect($?.("body").text()).toContain("Install the package");
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
