import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import type { ScraperOptions } from "../types";
import { HtmlDefuddleMiddleware } from "./HtmlDefuddleMiddleware";
import type { MiddlewareContext } from "./types";

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

// Defuddle requires a recognisable article structure with enough body text to
// score the main element above the boilerplate. Padding the article with
// repeated lorem ipsum gives it the word count it expects.
const lorem =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " +
  "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";

const articleHtml = (extra = "") => `
  <!doctype html>
  <html lang="en">
    <head><title>Test Article</title></head>
    <body>
      <nav class="site-nav"><a href="/">Home</a><a href="/about">About</a></nav>
      <header class="site-header">Site banner</header>
      <aside class="sidebar">Related links sidebar</aside>
      <main>
        <article>
          <h1>Test Article</h1>
          <p>${lorem.repeat(15)}</p>
          <p>${lorem.repeat(15)}</p>
          <p>${lorem.repeat(15)}</p>
          ${extra}
        </article>
      </main>
      <footer class="site-footer">Copyright 2026 footer</footer>
    </body>
  </html>`;

describe("HtmlDefuddleMiddleware", () => {
  it("removes nav/footer/sidebar boilerplate but keeps article body", async () => {
    const middleware = new HtmlDefuddleMiddleware();
    const context = createMockContext(articleHtml());
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.errors).toHaveLength(0);
    expect(context.dom).toBeDefined();
    const $ = context.dom;
    if (!$) throw new Error("DOM not defined");

    expect($("nav").length).toBe(0);
    expect($(".site-header").length).toBe(0);
    expect($(".sidebar").length).toBe(0);
    expect($(".site-footer").length).toBe(0);
    expect($("body").text()).toContain("Lorem ipsum");
  });

  it("respects excludeSelectors (applied to the source DOM before extraction)", async () => {
    const middleware = new HtmlDefuddleMiddleware();
    const context = createMockContext(
      articleHtml('<div class="remove-me">Drop this</div>'),
      undefined,
      { excludeSelectors: [".remove-me"] },
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.errors).toHaveLength(0);
    const $ = context.dom;
    if (!$) throw new Error("DOM not defined");

    expect($(".remove-me").length).toBe(0);
    expect($("body").text()).not.toContain("Drop this");
    expect($("body").text()).toContain("Lorem ipsum");
  });

  it("falls back to the original DOM when extraction would empty the page", async () => {
    const middleware = new HtmlDefuddleMiddleware({ minTextRetentionRatio: 0.99 });
    const context = createMockContext(articleHtml());
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    const $ = context.dom;
    if (!$) throw new Error("DOM not defined");

    // Original boilerplate is still there because we reverted.
    expect($("nav").length).toBeGreaterThan(0);
    expect($(".site-footer").length).toBeGreaterThan(0);
  });

  it("skips processing if context.dom is missing", async () => {
    const middleware = new HtmlDefuddleMiddleware();
    const context = createMockContext();
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.errors).toHaveLength(0);
    expect(context.dom).toBeUndefined();
  });

  it("populates context.title when not already set", async () => {
    const middleware = new HtmlDefuddleMiddleware();
    const context = createMockContext(articleHtml());
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(context.title).toBeTruthy();
    expect(context.title).toContain("Test Article");
  });

  it("triggers fallback when extracted body is only script content (Next.js hydration)", async () => {
    // Regression for the failure mode where Defuddle returns a body whose
    // only "content" is a `<script>` blob (e.g. Next.js `__next_f`
    // hydration). The textual length of the script's children would inflate
    // the retention ratio so the safety net never tripped, then post-strip
    // we'd be left with an effectively empty DOM. With the post-strip
    // measurement, the ratio should now reflect the empty page and fall
    // back to the original DOM.
    const middleware = new HtmlDefuddleMiddleware();
    const hugeScriptPayload = "x".repeat(200_000);
    const html = `
      <!doctype html>
      <html><head><title>Test</title></head>
      <body>
        <article>
          <h1>Test Article</h1>
          <p>${lorem.repeat(20)}</p>
          <script>self.__next_f=[${JSON.stringify(hugeScriptPayload)}]</script>
        </article>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    const $ = context.dom;
    if (!$) throw new Error("DOM not defined");

    // The hydration payload must not survive into the final DOM, regardless
    // of which path executed (extraction or fallback).
    expect($("body").text()).not.toContain(hugeScriptPayload);
    expect($("script").length).toBe(0);
  });

  it("propagates language hints from highlighter wrapper divs to <code>", async () => {
    const middleware = new HtmlDefuddleMiddleware();
    // python.org / Sphinx pattern: language is on a wrapper div.
    const html = `
      <!doctype html>
      <html><head><title>Sphinx-style</title></head>
      <body>
        <main><article>
          <h1>Sphinx-style</h1>
          <p>${lorem.repeat(15)}</p>
          <div class="highlight-python3 notranslate"><div class="highlight">
            <pre><span class="kn">import</span> json</pre>
          </div></div>
          <p>${lorem.repeat(15)}</p>
        </article></main>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    const $ = context.dom;
    if (!$) throw new Error("DOM not defined");
    // Defuddle unwraps the highlight divs but our pre-pass copied the
    // language onto <code> so it survives.
    const codeClass = $("pre code").attr("class") ?? "";
    expect(codeClass).toMatch(/language-python3/);
  });
});
