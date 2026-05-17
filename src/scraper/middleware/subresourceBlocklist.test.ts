import { describe, expect, it } from "vitest";
import { isBlockedSubresource, SUBRESOURCE_BLOCKLIST } from "./subresourceBlocklist";

describe("isBlockedSubresource", () => {
  describe("hostname matching", () => {
    it("matches an exact host", () => {
      const result = isBlockedSubresource("https://google-analytics.com/collect");
      expect(result).toEqual({ blocked: true, category: "Analytics" });
    });

    it("matches a subdomain", () => {
      const result = isBlockedSubresource(
        "https://www.google-analytics.com/analytics.js",
      );
      expect(result).toEqual({ blocked: true, category: "Analytics" });
    });

    it("matches a deeper subdomain", () => {
      const result = isBlockedSubresource(
        "https://region1.events.hotjar.com/api/v2/client",
      );
      expect(result).toEqual({ blocked: true, category: "Session Replay" });
    });

    it("does not match a substring across the label boundary", () => {
      expect(isBlockedSubresource("https://evil-google-analytics.com/x.js")).toEqual({
        blocked: false,
      });
    });

    it("does not match an unrelated host that ends similarly", () => {
      expect(isBlockedSubresource("https://myanalytics.com/x.js")).toEqual({
        blocked: false,
      });
    });

    it("ignores port number on the request URL", () => {
      expect(isBlockedSubresource("https://google-analytics.com:8443/collect")).toEqual({
        blocked: true,
        category: "Analytics",
      });
    });
  });

  describe("path-prefix matching", () => {
    it("blocks YouTube embed runtime under the prefix", () => {
      expect(
        isBlockedSubresource(
          "https://www.youtube-nocookie.com/s/_/ytembeds/_/js/k=ytembeds.base.en_US.x/am=AAAAIA/d=1",
        ),
      ).toEqual({ blocked: true, category: "Social Embed" });
    });

    it("does NOT block the YouTube embed document path", () => {
      expect(
        isBlockedSubresource("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"),
      ).toEqual({ blocked: false });
    });

    it("does NOT block a sibling path on the same host", () => {
      expect(
        isBlockedSubresource("https://www.youtube-nocookie.com/something/else.js"),
      ).toEqual({ blocked: false });
    });
  });

  describe("inputs that should not be blocked", () => {
    it("returns false for invalid URLs", () => {
      expect(isBlockedSubresource("not a url")).toEqual({ blocked: false });
      expect(isBlockedSubresource("")).toEqual({ blocked: false });
    });

    it("does not block advertising-network domains", () => {
      // Documented exclusion: blocking ad networks risks anti-adblock detection.
      for (const url of [
        "https://googleads.g.doubleclick.net/pagead/ads",
        "https://www.googlesyndication.com/pagead/js/adsbygoogle.js",
        "https://googleadservices.com/pagead/conversion.js",
        "https://www.googletagservices.com/tag/js/gpt.js",
      ]) {
        expect(isBlockedSubresource(url)).toEqual({ blocked: false });
      }
    });

    it("does not block generic CDN libraries", () => {
      // Documented exclusion: pages legitimately fetch Mermaid/KaTeX/etc.
      for (const url of [
        "https://unpkg.com/mermaid@11/dist/mermaid.min.js",
        "https://cdn.jsdelivr.net/npm/katex@0.16.0/dist/katex.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js",
        "https://cdn.skypack.dev/preact",
        "https://esm.sh/react",
      ]) {
        expect(isBlockedSubresource(url)).toEqual({ blocked: false });
      }
    });

    it("does not block first-party documentation hosts", () => {
      for (const url of [
        "https://fastapi.tiangolo.com/search/search_index.json",
        "https://docs.python.org/3/library/typing.html",
        "https://example.com/script.js",
      ]) {
        expect(isBlockedSubresource(url)).toEqual({ blocked: false });
      }
    });
  });

  describe("blocklist invariants", () => {
    it("contains between 20 and 60 entries", () => {
      expect(SUBRESOURCE_BLOCKLIST.length).toBeGreaterThanOrEqual(20);
      expect(SUBRESOURCE_BLOCKLIST.length).toBeLessThanOrEqual(60);
    });

    it("classifies every entry under one of the five categories", () => {
      const allowedCategories = new Set([
        "Analytics",
        "Session Replay",
        "Chat Widget",
        "Captcha",
        "Social Embed",
      ]);
      for (const entry of SUBRESOURCE_BLOCKLIST) {
        expect(allowedCategories.has(entry.category)).toBe(true);
      }
    });

    it("never includes an advertising-network host", () => {
      // Sanity check that protects the documented anti-adblock posture.
      const forbiddenSubstrings = [
        "doubleclick",
        "googlesyndication",
        "googleadservices",
        "googletagservices",
      ];
      for (const entry of SUBRESOURCE_BLOCKLIST) {
        for (const banned of forbiddenSubstrings) {
          expect(entry.host).not.toContain(banned);
        }
      }
    });
  });
});
