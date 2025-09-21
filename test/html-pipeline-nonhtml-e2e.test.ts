/**
 * End-to-end tests for handling non-HTML content that should not use Playwright.
 * 
 * These tests ensure that text/plain and other non-HTML content types are handled
 * properly without triggering Playwright rendering, which can cause hangs.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { FetchUrlTool } from "../src/tools/FetchUrlTool";
import { HttpFetcher } from "../src/scraper/fetcher/HttpFetcher";
import { FileFetcher } from "../src/scraper/fetcher/FileFetcher";
import { ScrapeMode } from "../src/scraper/types";

describe("HTML Pipeline Non-HTML Content Tests", () => {
  let fetchUrlTool: FetchUrlTool;

  beforeAll(() => {
    const httpFetcher = new HttpFetcher();
    const fileFetcher = new FileFetcher();
    fetchUrlTool = new FetchUrlTool(httpFetcher, fileFetcher);
  });

  describe("Plain Text Content", () => {
    it("should handle text/plain content without hanging", async () => {
      // This URL serves content with Content-Type: text/plain, which was causing hangs
      const url = "https://raw.githubusercontent.com/9001/copyparty/hovudstraum/contrib/index.html";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(10);
      
      // The content should be the HTML content, but processed as plain text
      expect(result.toLowerCase()).toContain("html");
      expect(result.toLowerCase()).toContain("copyparty");
    }, 30000);

    it("should handle robots.txt content (text/plain)", async () => {
      const url = "https://httpbin.org/robots.txt";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.toLowerCase()).toContain("user-agent");
    }, 30000);
  });

  describe("Different Scrape Modes with Text Content", () => {
    it("should handle text/plain with ScrapeMode.Fetch", async () => {
      const url = "https://httpbin.org/robots.txt";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Fetch,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.toLowerCase()).toContain("user-agent");
    }, 15000);

    it("should handle text/plain with ScrapeMode.Playwright (should not hang)", async () => {
      const url = "https://httpbin.org/robots.txt";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Playwright,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.toLowerCase()).toContain("user-agent");
    }, 30000);
  });
});
