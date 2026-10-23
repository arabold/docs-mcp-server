import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import type { ScraperOptions } from "../types";
import { HtmlNormalizationMiddleware } from "./HtmlNormalizationMiddleware";
import type { MiddlewareContext } from "./types";

describe("HtmlNormalizationMiddleware", () => {
  const middleware = new HtmlNormalizationMiddleware();

  const createContext = (
    htmlContent: string,
    source = "https://example.com/page",
  ): MiddlewareContext => {
    const options: ScraperOptions = {
      url: source,
      library: "test-library",
      version: "1.0.0",
    };
    return {
      content: htmlContent,
      contentType: "text/html",
      source,
      links: [],
      errors: [],
      options,
      dom: cheerio.load(htmlContent),
    };
  };

  /** Runs the middleware on the HTML and returns the normalized DOM. */
  async function normalize(html: string, source?: string): Promise<cheerio.CheerioAPI> {
    const context = createContext(html, source);
    await middleware.process(context, async () => {});
    expect(context.errors).toEqual([]);
    if (!context.dom) throw new Error("the middleware dropped the DOM");
    return context.dom;
  }

  it("should skip normalization when no DOM is available", async () => {
    const context: MiddlewareContext = {
      ...createContext("<p>test</p>"),
      dom: undefined,
    };

    let nextCalled = false;
    await middleware.process(context, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(context.errors).toHaveLength(0);
  });

  it("resolves image and link URLs against the page URL", async () => {
    const cases: Array<{
      label: string;
      tag: "img" | "a";
      value: string;
      source: string;
      expected: string;
    }> = [
      {
        label: "relative image",
        tag: "img",
        value: "image1.jpg",
        source: "https://example.com/docs/page.html",
        expected: "https://example.com/docs/image1.jpg",
      },
      {
        label: "root-relative image",
        tag: "img",
        value: "/images/image2.png",
        source: "https://example.com/docs/page.html",
        expected: "https://example.com/images/image2.png",
      },
      {
        label: "dot-relative image",
        tag: "img",
        value: "./relative/image3.gif",
        source: "https://example.com/docs/page.html",
        expected: "https://example.com/docs/relative/image3.gif",
      },
      {
        label: "parent-relative image",
        tag: "img",
        value: "../parent/image4.svg",
        source: "https://example.com/docs/page.html",
        expected: "https://example.com/parent/image4.svg",
      },
      {
        label: "absolute HTTPS image",
        tag: "img",
        value: "https://cdn.example.com/image1.jpg",
        source: "https://example.com/page",
        expected: "https://cdn.example.com/image1.jpg",
      },
      {
        label: "absolute HTTP image",
        tag: "img",
        value: "http://other.com/image2.png",
        source: "https://example.com/page",
        expected: "http://other.com/image2.png",
      },
      {
        // The URL constructor is permissive and resolves this as a relative path.
        label: "malformed image URL",
        tag: "img",
        value: "::invalid::url",
        source: "https://example.com/page",
        expected: "https://example.com/::invalid::url",
      },
      {
        label: "relative link",
        tag: "a",
        value: "page1.html",
        source: "https://example.com/docs/current.html",
        expected: "https://example.com/docs/page1.html",
      },
      {
        label: "root-relative link",
        tag: "a",
        value: "/docs/page2.html",
        source: "https://example.com/docs/current.html",
        expected: "https://example.com/docs/page2.html",
      },
      {
        label: "dot-relative link",
        tag: "a",
        value: "./section/page3.html",
        source: "https://example.com/docs/current.html",
        expected: "https://example.com/docs/section/page3.html",
      },
      {
        label: "parent-relative link",
        tag: "a",
        value: "../other/page4.html",
        source: "https://example.com/docs/current.html",
        expected: "https://example.com/other/page4.html",
      },
      {
        label: "absolute HTTPS link",
        tag: "a",
        value: "https://external.com/page",
        source: "https://example.com/page",
        expected: "https://external.com/page",
      },
      {
        label: "absolute HTTP link",
        tag: "a",
        value: "http://other.com/page",
        source: "https://example.com/page",
        expected: "http://other.com/page",
      },
      {
        // The URL constructor is permissive; the link is resolved, not unwrapped.
        label: "malformed link URL",
        tag: "a",
        value: "::invalid::url",
        source: "https://example.com/page",
        expected: "https://example.com/::invalid::url",
      },
    ];

    for (const { label, tag, value, source, expected } of cases) {
      const html =
        tag === "img"
          ? `<img src="${value}" alt="Image">`
          : `<a href="${value}">Link</a>`;

      const $ = await normalize(html, source);

      expect.soft($(tag).attr(tag === "img" ? "src" : "href"), label).toBe(expected);
    }
  });

  it("removes images without a source and tracking pixels, and keeps other images", async () => {
    const cases: Array<{ src: string | null; kept: boolean }> = [
      { src: null, kept: false },
      { src: "", kept: false },
      { src: "https://d.adroll.com/cm/pixel.gif", kept: false },
      { src: "https://bat.bing.com/action/0?ti=123", kept: false },
      { src: "https://analytics.twitter.com/1/i/adsct?bci=4", kept: false },
      { src: "https://analytics.twitter.com/1/i/adsct", kept: false },
      { src: "https://pixel.rubiconproject.com/tap.php?nid=5578", kept: false },
      { src: "https://dsum-sec.casalemedia.com/rum?cm_dsp_id=18", kept: false },
      { src: "https://partners.tremorhub.com/sync?UIDM=abc123", kept: false },
      { src: "https://id.rlcdn.com/464526.gif", kept: false },
      // Tracking hosts match case-insensitively.
      { src: "https://D.ADROLL.COM/pixel.gif", kept: false },
      { src: "https://Analytics.Twitter.com/track", kept: false },
      { src: "logo.png", kept: true },
      { src: "content-image.jpg", kept: true },
      { src: "https://cdn.example.com/banner.jpg", kept: true },
      // Paths that contain tracking keywords on hosts that do not track.
      { src: "https://cdn.example.com/adroll-logo.png", kept: true },
      { src: "https://images.site.com/pixel-art.png", kept: true },
      {
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        kept: true,
      },
      {
        src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E",
        kept: true,
      },
      { src: "data:image/png;base64,abc123", kept: true },
    ];

    for (const { src, kept } of cases) {
      const html = src === null ? '<img alt="Image">' : `<img src="${src}" alt="Image">`;

      const $ = await normalize(html);

      expect.soft($("img").length, String(src)).toBe(kept ? 1 : 0);
    }
  });

  it("unwraps links that do not lead to a web page and keeps their content", async () => {
    const cases: Array<{ label: string; anchor: string; inner: string }> = [
      { label: "fragment", anchor: '<a href="#section1">', inner: "this section" },
      { label: "top fragment", anchor: '<a href="#top">', inner: "Back to top" },
      {
        label: "javascript: call",
        anchor: `<a href="javascript:alert('Hello')">`,
        inner: "Click me",
      },
      {
        label: "javascript: void",
        anchor: '<a href="javascript:void(0)">',
        inner: "Another action",
      },
      {
        label: "mailto:",
        anchor: '<a href="mailto:test@example.com">',
        inner: "Email us",
      },
      { label: "tel:", anchor: '<a href="tel:+1234567890">', inner: "Call us" },
      { label: "ftp:", anchor: '<a href="ftp://files.example.com">', inner: "FTP" },
      { label: "missing href", anchor: "<a>", inner: "Link without href" },
      { label: "empty href", anchor: '<a href="">', inner: "Link with empty href" },
      {
        label: "nested formatting",
        anchor: '<a href="#test">',
        inner: "<strong>Bold</strong> and <em>italic</em> text",
      },
    ];

    for (const { label, anchor, inner } of cases) {
      const $ = await normalize(`<p>See ${anchor}${inner}</a> for details.</p>`);

      expect.soft($("a").length, label).toBe(0);
      expect.soft($("p").html(), label).toBe(`See ${inner} for details.`);
    }
  });

  it("simplifies a single div or paragraph wrapper inside a link", async () => {
    const cases: Array<{ label: string; html: string; expected: string }> = [
      {
        // Adjacent inline children get a space so their text does not run together.
        label: "div of spans",
        html: `<a href="/reference/react/useDeferredValue">
          <div><span>Previous</span><span>useDeferredValue</span></div>
        </a>`,
        expected: "<span>Previous</span> <span>useDeferredValue</span>",
      },
      {
        label: "paragraph",
        html: '<a href="/docs"><p>Read docs</p></a>',
        expected: "Read docs",
      },
      {
        label: "div with inline formatting",
        html: '<a href="/docs"><div><strong>Bold</strong> and <em>italic</em></div></a>',
        expected: "<strong>Bold</strong> and <em>italic</em>",
      },
    ];

    for (const { label, html, expected } of cases) {
      const $ = await normalize(html);

      expect.soft($("a").html()?.trim(), label).toBe(expected);
    }
  });

  it("keeps link wrappers that hold an image or several blocks", async () => {
    const cases: Array<{ label: string; html: string; expected: string }> = [
      {
        label: "image wrapper",
        html: '<a href="/image"><div><img src="hero.png" alt="Hero"></div></a>',
        expected: '<div><img src="https://example.com/hero.png" alt="Hero"></div>',
      },
      {
        label: "several blocks",
        html: '<a href="/two"><div>One</div><div>Two</div></a>',
        expected: "<div>One</div><div>Two</div>",
      },
    ];

    for (const { label, html, expected } of cases) {
      const $ = await normalize(html);

      expect.soft($("a").html(), label).toBe(expected);
    }
  });
});
