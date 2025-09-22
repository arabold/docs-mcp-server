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
    const $ = cheerio.load(htmlContent);
    const options: ScraperOptions = {
      url: source,
      library: "test-library",
      version: "1.0.0",
    };
    return {
      content: htmlContent,
      source,
      metadata: {},
      links: [],
      errors: [],
      options,
      dom: $,
    };
  };

  describe("process", () => {
    it("should skip normalization when no DOM is available", async () => {
      const options: ScraperOptions = {
        url: "https://example.com",
        library: "test-library",
        version: "1.0.0",
      };
      const context: MiddlewareContext = {
        content: "<p>test</p>",
        source: "https://example.com",
        metadata: {},
        links: [],
        errors: [],
        options,
      };

      let nextCalled = false;
      await middleware.process(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(context.errors).toHaveLength(0);
    });

    it("should handle processing errors gracefully", async () => {
      const context = createContext("<img src='test.jpg'>");
      // Intentionally break the DOM to cause an error
      context.dom = null as any;

      let nextCalled = false;
      await middleware.process(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });
  });

  describe("image URL normalization", () => {
    it("should convert relative image URLs to absolute URLs", async () => {
      const context = createContext(
        `
        <div>
          <img src="image1.jpg" alt="Image 1">
          <img src="/images/image2.png" alt="Image 2">
          <img src="./relative/image3.gif" alt="Image 3">
          <img src="../parent/image4.svg" alt="Image 4">
        </div>
      `,
        "https://example.com/docs/page.html",
      );

      await middleware.process(context, async () => {});

      const $ = context.dom!;
      const images = $("img");

      expect($(images[0]).attr("src")).toBe("https://example.com/docs/image1.jpg");
      expect($(images[1]).attr("src")).toBe("https://example.com/images/image2.png");
      expect($(images[2]).attr("src")).toBe(
        "https://example.com/docs/relative/image3.gif",
      );
      expect($(images[3]).attr("src")).toBe("https://example.com/parent/image4.svg");
    });

    it("should leave absolute image URLs unchanged", async () => {
      const context = createContext(`
        <div>
          <img src="https://cdn.example.com/image1.jpg" alt="Image 1">
          <img src="http://other.com/image2.png" alt="Image 2">
        </div>
      `);

      await middleware.process(context, async () => {});

      const $ = context.dom!;
      const images = $("img");

      expect($(images[0]).attr("src")).toBe("https://cdn.example.com/image1.jpg");
      expect($(images[1]).attr("src")).toBe("http://other.com/image2.png");
    });

    it("should handle images without src attribute", async () => {
      const context = createContext(`
        <div>
          <img alt="No source">
          <img src="" alt="Empty source">
        </div>
      `);

      await middleware.process(context, async () => {});

      const $ = context.dom!;
      const images = $("img");

      expect($(images[0]).attr("src")).toBeUndefined();
      expect($(images[1]).attr("src")).toBe("");
    });

    it("should handle malformed relative URLs gracefully", async () => {
      const context = createContext(`
        <img src="::invalid::url" alt="Invalid URL">
      `);

      await middleware.process(context, async () => {});

      const $ = context.dom!;
      const img = $("img");

      // URL constructor is permissive and will resolve this as a relative path
      expect(img.attr("src")).toBe("https://example.com/::invalid::url");
    });
  });

  describe("link normalization", () => {
    it("should convert relative link URLs to absolute URLs", async () => {
      const context = createContext(
        `
        <div>
          <a href="page1.html">Page 1</a>
          <a href="/docs/page2.html">Page 2</a>
          <a href="./section/page3.html">Page 3</a>
          <a href="../other/page4.html">Page 4</a>
        </div>
      `,
        "https://example.com/docs/current.html",
      );

      await middleware.process(context, async () => {});

      const $ = context.dom!;
      const links = $("a");

      expect($(links[0]).attr("href")).toBe("https://example.com/docs/page1.html");
      expect($(links[1]).attr("href")).toBe("https://example.com/docs/page2.html");
      expect($(links[2]).attr("href")).toBe(
        "https://example.com/docs/section/page3.html",
      );
      expect($(links[3]).attr("href")).toBe("https://example.com/other/page4.html");
    });

    it("should leave absolute HTTP/HTTPS URLs unchanged", async () => {
      const context = createContext(`
        <div>
          <a href="https://external.com/page">External HTTPS</a>
          <a href="http://other.com/page">External HTTP</a>
        </div>
      `);

      await middleware.process(context, async () => {});

      const $ = context.dom!;
      const links = $("a");

      expect($(links[0]).attr("href")).toBe("https://external.com/page");
      expect($(links[1]).attr("href")).toBe("http://other.com/page");
    });

    it("should unwrap anchor links while preserving text content", async () => {
      const context = createContext(`
        <div>
          <p>See <a href="#section1">this section</a> for details.</p>
          <a href="#top">Back to top</a>
        </div>
      `);

      await middleware.process(context, async () => {});

      const $ = context.dom!;
      const html = $.html();

      expect(html).toContain("See this section for details.");
      expect(html).toContain("Back to top");
      expect(html).not.toContain('<a href="#section1">');
      expect(html).not.toContain('<a href="#top">');
    });

    it("should unwrap javascript: links while preserving text content", async () => {
      const context = createContext(`
        <div>
          <a href="javascript:alert('Hello')">Click me</a>
          <a href="javascript:void(0)">Another action</a>
        </div>
      `);

      await middleware.process(context, async () => {});

      const $ = context.dom!;
      const html = $.html();

      expect(html).toContain("Click me");
      expect(html).toContain("Another action");
      expect(html).not.toContain("javascript:");
      expect(html).not.toContain("<a href=");
    });

    it("should unwrap other non-HTTP protocol links while preserving text content", async () => {
      const context = createContext(`
        <div>
          <a href="mailto:test@example.com">Email us</a>
          <a href="tel:+1234567890">Call us</a>
          <a href="ftp://files.example.com">FTP</a>
        </div>
      `);

      await middleware.process(context, async () => {});

      const $ = context.dom!;
      const html = $.html();

      expect(html).toContain("Email us");
      expect(html).toContain("Call us");
      expect(html).toContain("FTP");
      expect(html).not.toContain("mailto:");
      expect(html).not.toContain("tel:");
      expect(html).not.toContain("ftp:");
      expect(html).not.toContain("<a href=");
    });

    it("should unwrap links without href attribute", async () => {
      const context = createContext(`
        <div>
          <a>Link without href</a>
          <a href="">Link with empty href</a>
        </div>
      `);

      await middleware.process(context, async () => {});

      const $ = context.dom!;
      const html = $.html();

      expect(html).toContain("Link without href");
      expect(html).toContain("Link with empty href");
      expect($("a")).toHaveLength(0);
    });

    it("should handle malformed relative URLs by converting them", async () => {
      const context = createContext(`
        <a href="::invalid::url">Invalid link</a>
      `);

      await middleware.process(context, async () => {});

      const $ = context.dom!;
      const links = $("a");

      // URL constructor is permissive and will resolve this as a relative path
      expect($(links[0]).attr("href")).toBe("https://example.com/::invalid::url");
      expect($("a")).toHaveLength(1);
    });
  });

  describe("complex scenarios", () => {
    it("should handle mixed content correctly", async () => {
      const context = createContext(
        `
        <div>
          <h1>Test Page</h1>
          <img src="logo.png" alt="Logo">
          <p>Check out <a href="https://external.com">this external link</a>.</p>
          <p>Or see <a href="#section">this section</a> below.</p>
          <p>Contact us via <a href="mailto:info@example.com">email</a>.</p>
          <a href="./relative/page.html">Relative page</a>
          <img src="https://cdn.example.com/banner.jpg" alt="Banner">
        </div>
      `,
        "https://example.com/docs/",
      );

      await middleware.process(context, async () => {});

      const $ = context.dom!;
      const html = $.html();

      // Images should be normalized
      expect($('img[src="https://example.com/docs/logo.png"]')).toHaveLength(1);
      expect($('img[src="https://cdn.example.com/banner.jpg"]')).toHaveLength(1);

      // External HTTP link should remain
      expect($('a[href="https://external.com"]')).toHaveLength(1);

      // Relative link should be converted
      expect($('a[href="https://example.com/docs/relative/page.html"]')).toHaveLength(1);

      // Anchor and mailto links should be unwrapped
      expect(html).toContain("this section");
      expect(html).toContain("email");
      expect(html).not.toContain('#section"');
      expect(html).not.toContain("mailto:");
    });

    it("should preserve nested elements when unwrapping links", async () => {
      const context = createContext(`
        <div>
          <a href="#test"><strong>Bold</strong> and <em>italic</em> text</a>
        </div>
      `);

      await middleware.process(context, async () => {});

      const $ = context.dom!;
      const html = $.html();

      expect(html).toContain("<strong>Bold</strong> and <em>italic</em> text");
      expect($("strong")).toHaveLength(1);
      expect($("em")).toHaveLength(1);
      expect($("a")).toHaveLength(0);
    });
  });
});
