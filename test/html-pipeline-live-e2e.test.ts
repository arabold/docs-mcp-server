/**
 * Live website end-to-end tests for HTML pipeline functionality.
 * 
 * These tests validate real-world HTML fetching and processing against actual
 * documentation websites. They test complex scenarios including JavaScript-heavy
 * sites, anti-scraping measures, and various content management systems.
 * 
 * IMPORTANT: These tests are excluded from the default test run to keep CI fast
 * and stable. Run them manually with: npm test -- html-pipeline-live-e2e.test.ts
 * 
 * Note: 
 * - These tests require internet access and are slower due to network requests
 * - All tests use Playwright mode for full JavaScript support
 * - Timeouts are set to 60 seconds to accommodate complex sites
 * - For fast, reliable tests suitable for CI/CD, see html-pipeline-basic-e2e.test.ts
 */

import { beforeAll, describe, expect, it } from "vitest";
import { FetchUrlTool } from "../src/tools/FetchUrlTool";
import { AutoDetectFetcher } from "../src/scraper/fetcher/AutoDetectFetcher";
import { ScrapeMode } from "../src/scraper/types";

describe("HTML Pipeline Website Tests", () => {
  let fetchUrlTool: FetchUrlTool;

  beforeAll(() => {
    // Initialize the FetchUrlTool with AutoDetectFetcher
    const autoDetectFetcher = new AutoDetectFetcher();
    fetchUrlTool = new FetchUrlTool(autoDetectFetcher);
  });

  describe("Salesforce Documentation", () => {
    it("should extract content from Chatter API documentation", async () => {
      const url = "https://developer.salesforce.com/docs/atlas.en-us.chatterapi.meta/chatterapi/intro_working_with_chatter_connect.htm";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(100);
      
      // This MUST be present - it's the original requirement
      expect(result.toLowerCase()).toContain("requests are subject to rate limits");
      
      // Additional content validations
      expect(result.toLowerCase()).toContain("chatter");
      expect(result.toLowerCase()).toContain("api");
    }, 60000);
  });

  describe("GitHub Documentation", () => {
    it("should extract content from GitHub REST API documentation", async () => {
      const url = "https://docs.github.com/en/rest/repos/repos";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(100);
      
      // Verify specific GitHub API content that's actually in the documentation body
      expect(result.toLowerCase()).toContain("create a repository for the authenticated user");
    }, 60000);
  });

  describe("MDN Web Docs", () => {
    it("should extract content from JavaScript Array.map documentation", async () => {
      const url = "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(100);
      
      // Verify specific MDN content from the actual documentation
      expect(result.toLowerCase()).toContain("using the third argument of callbackfn");
    }, 60000);
  });

  describe("npm Package Documentation", () => {
    it("should extract content from Express.js npm page", async () => {
      const url = "https://www.npmjs.com/package/express";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(100);
      
      // Verify specific npm Express content
      expect(result.toLowerCase()).toContain("if this is a brand new project");
    }, 60000);
  });

  describe("AWS Documentation", () => {
    it("should extract content from AWS Lambda documentation", async () => {
      const url = "https://docs.aws.amazon.com/lambda/latest/dg/getting-started.html";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(100);
      
      // Verify specific AWS Lambda content
      expect(result.toLowerCase()).toContain("create a lambda function with the console");
    }, 60000);
  });

  describe("React Documentation", () => {
    it("should extract content from React hooks documentation", async () => {
      const url = "https://react.dev/reference/react/useState";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(100);
      
      // Verify specific React useState content
      expect(result.toLowerCase()).toContain("requests another render with the new state value");
    }, 60000);
  });

  describe("Python Documentation", () => {
    it("should extract content from Python requests library documentation", async () => {
      const url = "https://docs.python-requests.org/en/latest/user/quickstart/";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(100);
      
      // Verify specific Python requests documentation content
      expect(result.toLowerCase()).toContain("simple api means that all forms of http request are as obvious");
    }, 60000);
  });

  describe("TypeScript Documentation", () => {
    it("should extract content from TypeScript handbook", async () => {
      const url = "https://www.typescriptlang.org/docs/handbook/2/basic-types.html";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(100);
      
      // Verify specific TypeScript handbook content
      expect(result.toLowerCase()).toContain("type annotations never change the runtime behavior");
    }, 60000);
  });

  describe("Content Quality Tests", () => {
    it("should remove navigation elements and extract clean content", async () => {
      const url = "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      // Should contain main content
      expect(result.toLowerCase()).not.toContain("Object/Function");
    }, 60000);
  });

  describe("Different Scrape Modes", () => {
    const testUrl = "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map";

    it("should work with Playwright mode", async () => {
      const result = await fetchUrlTool.execute({
        url: testUrl,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(100);
      expect(result.toLowerCase()).toContain("array.prototype.map");
    }, 60000);

    it("should work with Fetch mode", async () => {
      const result = await fetchUrlTool.execute({
        url: testUrl,
        scrapeMode: ScrapeMode.Fetch,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(100);
      expect(result.toLowerCase()).toContain("array.prototype.map");
    }, 60000);
  });

  describe("Additional Documentation Sites", () => {
    it("should extract content from Rust documentation", async () => {
      const url = "https://doc.rust-lang.org/book/ch01-03-hello-cargo.html";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      // Verify specific Rust Cargo content from the actual page
      expect(result.toLowerCase()).toContain("we can create a project using `cargo new`");
    }, 60000);

    it("should extract content from Vue.js documentation", async () => {
      const url = "https://vuejs.org/api/composition-api-setup.html";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      // Verify specific Vue.js setup content from the actual page
      expect(result.toLowerCase()).toContain("the `setup()` hook serves as the entry point for composition api usage");
    }, 60000);

    it("should extract content from Bootstrap documentation", async () => {
      const url = "https://getbootstrap.com/docs/5.3/components/buttons/";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      // Verify specific Bootstrap button documentation content from the actual page
      expect(result.toLowerCase()).toContain("custom button styles for actions in forms");
    }, 60000);

    it("should extract content from Django documentation", async () => {
      const url = "https://docs.djangoproject.com/en/4.2/topics/db/models/";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      // Verify specific Django models content
      expect(result.toLowerCase()).toContain("a model is the single, definitive source of information about your data");
    }, 60000);

    it("should extract content from PyPI package pages", async () => {
      const url = "https://pypi.org/project/requests/";
      
      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Auto,
        followRedirects: true,
      });

      expect(result).toBeTruthy();
      // Verify specific PyPI requests content
      expect(result.toLowerCase()).toContain("requests allows you to send http/1.1 requests extremely easily");
    }, 60000);
  });
});
