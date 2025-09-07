/**
 * Basic end-to-end tests for HTML pipeline functionality.
 * 
 * These tests validate core functionality using reliable test endpoints (httpbin.org)
 * and are designed to be fast and stable for CI/CD environments. They test the
 * fundamental capabilities without relying on external websites that might change.
 * 
 * For comprehensive real-world website testing, see html-pipeline-websites-e2e.test.ts
 */

import { beforeAll, describe, expect, it } from "vitest";
import { FetchUrlTool } from "../src/tools/FetchUrlTool";
import { HttpFetcher } from "../src/scraper/fetcher/HttpFetcher";
import { FileFetcher } from "../src/scraper/fetcher/FileFetcher";
import { ScrapeMode } from "../src/scraper/types";

describe("HTML Pipeline Basic Tests", () => {
  let fetchUrlTool: FetchUrlTool;

  beforeAll(() => {
    const httpFetcher = new HttpFetcher();
    const fileFetcher = new FileFetcher();
    fetchUrlTool = new FetchUrlTool(httpFetcher, fileFetcher);
  });

  describe("Core Functionality", () => {
    it("should fetch and process a simple HTTP page", async () => {
      // Use httpbin.org for reliable testing - it returns Moby Dick content
      const url = "https://httpbin.org/html";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(10);
      
      // httpbin.org/html returns Moby Dick content, check for that instead
      expect(result.toLowerCase()).toContain("herman melville");
    }, 30000);

    it("should process JSON content gracefully", async () => {
      const url = "https://httpbin.org/json";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      // JSON should be returned as text
      expect(result).toContain("{");
    }, 30000);

    it("should handle redirects", async () => {
      const url = "https://httpbin.org/redirect/1";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    }, 30000);
  });

  describe("Error Handling", () => {
    it("should handle 404 errors", async () => {
      const url = "https://httpbin.org/status/404";
      
      await expect(fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      })).rejects.toThrow();
    }, 30000);

    it("should handle malformed URLs", async () => {
      const url = "not-a-url";
      
      await expect(fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      })).rejects.toThrow();
    }, 10000);

    it("should handle non-existent domains", async () => {
      const url = "https://this-domain-definitely-does-not-exist-12345.com";
      
      await expect(fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      })).rejects.toThrow();
    }, 30000);
  });

  describe("Different Content Types", () => {
    it("should handle XML content", async () => {
      const url = "https://httpbin.org/xml";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result).toContain("<");
    }, 30000);

    it("should handle robots.txt files", async () => {
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

  describe("Custom Headers", () => {
    it("should respect custom headers", async () => {
      const url = "https://httpbin.org/headers";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
        headers: {
          "X-Test-Header": "test-value",
        },
      });

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      // The response should include our custom header
      expect(result).toContain("X-Test-Header");
      expect(result).toContain("test-value");
    }, 30000);
  });

  describe("Performance Validation", () => {
    it("should complete simple requests within reasonable time", async () => {
      const startTime = Date.now();
      const url = "https://httpbin.org/html";
      
      await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Fetch, // Use faster mode for performance test
        followRedirects: true,
      });

      const duration = Date.now() - startTime;
      // Should complete within 10 seconds for a simple page
      expect(duration).toBeLessThan(10000);
    }, 15000);
  });
});
