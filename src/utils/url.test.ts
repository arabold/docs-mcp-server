import { describe, expect, it, vi } from "vitest";
import {
  type UrlNormalizerOptions,
  hasSameDomain,
  hasSameHostname,
  isSubpath,
  normalizeUrl,
} from "./url";

vi.mock("./logger");

describe("URL normalization", () => {
  describe("default behavior", () => {
    it("should preserve query parameters", () => {
      expect(normalizeUrl("https://example.com/api?version=1.0")).toBe(
        "https://example.com/api?version=1.0",
      );
    });

    it("should remove hash fragments", () => {
      expect(normalizeUrl("https://example.com/page#section")).toBe(
        "https://example.com/page",
      );
    });

    it("should remove trailing slashes", () => {
      expect(normalizeUrl("https://example.com/page/")).toBe("https://example.com/page");
    });

    it("should convert to lowercase", () => {
      expect(normalizeUrl("https://example.com/PAGE")).toBe("https://example.com/page");
    });
  });

  describe("individual options", () => {
    it("should keep hash fragments when removeHash is false", () => {
      expect(
        normalizeUrl("https://example.com/page#section", { removeHash: false }),
      ).toBe("https://example.com/page#section");
    });

    it("should keep trailing slashes when removeTrailingSlash is false", () => {
      expect(
        normalizeUrl("https://example.com/page/", {
          removeTrailingSlash: false,
        }),
      ).toBe("https://example.com/page/");
    });

    it("should preserve case when ignoreCase is false", () => {
      expect(
        normalizeUrl("https://example.com/PATH/TO/PAGE", { ignoreCase: false }),
      ).toBe("https://example.com/PATH/TO/PAGE");
    });

    it("should remove query parameters when removeQuery is true", () => {
      expect(
        normalizeUrl("https://example.com/api?version=1.0", {
          removeQuery: true,
        }),
      ).toBe("https://example.com/api");
    });
  });

  describe("edge cases", () => {
    it("should handle invalid URLs gracefully", () => {
      const invalidUrl = "not-a-url";
      expect(normalizeUrl(invalidUrl)).toBe(invalidUrl);
    });

    it("should handle URLs with multiple query parameters", () => {
      expect(normalizeUrl("https://example.com/api?v=1&format=json")).toBe(
        "https://example.com/api?v=1&format=json",
      );
    });

    it("should handle URLs with both hash and query", () => {
      expect(normalizeUrl("https://example.com/path?query=1#section")).toBe(
        "https://example.com/path?query=1",
      );
    });

    it("should handle malformed hash and query combinations", () => {
      expect(normalizeUrl("https://example.com/path#hash?query=1")).toBe(
        "https://example.com/path",
      );
    });
  });

  describe("index file removal", () => {
    it("should remove index files by default", () => {
      expect(normalizeUrl("https://example.com/path/index.html")).toBe(
        "https://example.com/path",
      );
      expect(normalizeUrl("https://example.com/path/index.htm")).toBe(
        "https://example.com/path",
      );
      expect(normalizeUrl("https://example.com/path/index.asp")).toBe(
        "https://example.com/path",
      );
      expect(normalizeUrl("https://example.com/path/index.php")).toBe(
        "https://example.com/path",
      );
      expect(normalizeUrl("https://example.com/path/index.jsp")).toBe(
        "https://example.com/path",
      );
    });

    it("should preserve index files when removeIndex is false", () => {
      const opts = { removeIndex: false };
      expect(normalizeUrl("https://example.com/path/index.html", opts)).toBe(
        "https://example.com/path/index.html",
      );
    });

    it("should preserve paths containing 'index' as part of another word", () => {
      expect(normalizeUrl("https://example.com/reindex/page")).toBe(
        "https://example.com/reindex/page",
      );
    });

    it("should preserve query parameters when removing index files", () => {
      expect(normalizeUrl("https://example.com/path/index.html?param=1")).toBe(
        "https://example.com/path?param=1",
      );
    });
  });
});

describe("URL comparison utilities", () => {
  describe("hasSameHostname", () => {
    it("should return true for exact same hostname", () => {
      const urlA = new URL("https://example.com/path/to/page");
      const urlB = new URL("https://example.com/different/path");
      expect(hasSameHostname(urlA, urlB)).toBe(true);
    });

    it("should return true for same hostname with different case", () => {
      const urlA = new URL("https://example.com/path");
      const urlB = new URL("https://example.com/path");
      expect(hasSameHostname(urlA, urlB)).toBe(true);
    });

    it("should return false for different subdomains", () => {
      const urlA = new URL("https://docs.example.com/path");
      const urlB = new URL("https://api.example.com/path");
      expect(hasSameHostname(urlA, urlB)).toBe(false);
    });

    it("should return false for different domains", () => {
      const urlA = new URL("https://example.com/path");
      const urlB = new URL("https://example.org/path");
      expect(hasSameHostname(urlA, urlB)).toBe(false);
    });
  });

  describe("hasSameDomain", () => {
    it("should return true for exact same domain", () => {
      const urlA = new URL("https://example.com/path");
      const urlB = new URL("https://example.com/different");
      expect(hasSameDomain(urlA, urlB)).toBe(true);
    });

    it("should return true for different subdomains of same domain", () => {
      const urlA = new URL("https://docs.example.com/path");
      const urlB = new URL("https://api.example.com/path");
      expect(hasSameDomain(urlA, urlB)).toBe(true);
    });

    it("should handle domain with public suffix correctly", () => {
      const urlA = new URL("https://example.co.uk/path");
      const urlB = new URL("https://docs.example.co.uk/path");
      expect(hasSameDomain(urlA, urlB)).toBe(true);
    });

    it("should return false for different domains", () => {
      const urlA = new URL("https://example.com/path");
      const urlB = new URL("https://different.org/path");
      expect(hasSameDomain(urlA, urlB)).toBe(false);
    });
  });

  describe("isSubpath", () => {
    it("should return true when target is exactly under base path", () => {
      const baseUrl = new URL("https://example.com/docs/");
      const targetUrl = new URL("https://example.com/docs/getting-started");
      expect(isSubpath(baseUrl, targetUrl)).toBe(true);
    });

    it("should return true when target is deeply nested under base path", () => {
      const baseUrl = new URL("https://example.com/docs/");
      const targetUrl = new URL("https://example.com/docs/tutorials/advanced/topic");
      expect(isSubpath(baseUrl, targetUrl)).toBe(true);
    });

    it("should return false when target is not under base path", () => {
      const baseUrl = new URL("https://example.com/docs/");
      const targetUrl = new URL("https://example.com/api/endpoint");
      expect(isSubpath(baseUrl, targetUrl)).toBe(false);
    });

    it("should handle trailing slashes correctly", () => {
      const baseUrl = new URL("https://example.com/docs"); // no trailing slash
      const targetUrl = new URL("https://example.com/docs/page");
      expect(isSubpath(baseUrl, targetUrl)).toBe(true);
    });

    it("should not match partial path segments", () => {
      const baseUrl = new URL("https://example.com/doc/");
      const targetUrl = new URL("https://example.com/docs/page"); // 'doc' vs 'docs'
      expect(isSubpath(baseUrl, targetUrl)).toBe(false);
    });
  });
});
