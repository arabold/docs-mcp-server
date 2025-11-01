/**
 * End-to-end tests for the refresh pipeline functionality.
 *
 * These tests validate that the refresh feature correctly handles:
 * - Page deletions (404 responses)
 * - Page updates (200 responses with new content)
 * - Unchanged pages (304 responses)
 * - Graceful error handling for broken links during normal scraping
 *
 * Uses nock to mock HTTP responses and an in-memory database for testing.
 */

import nock from "nock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PipelineManager } from "../src/pipeline/PipelineManager";
import { ScraperService } from "../src/scraper/ScraperService";
import type { ScraperOptions } from "../src/scraper/types";
import { DocumentManagementService } from "../src/store/DocumentManagementService";
import { DocumentStore } from "../src/store/DocumentStore";
import type { StoreSearchResult } from "../src/store/types";
import { ScraperRegistry } from "../src/scraper";

describe("Refresh Pipeline E2E Tests", () => {
  let docService: DocumentManagementService;
  let scraperService: ScraperService;
  let pipelineManager: PipelineManager;

  const TEST_BASE_URL = "http://test-docs.example.com";
  const TEST_LIBRARY = "test-lib";
  const TEST_VERSION = "1.0.0";

  beforeEach(async () => {
    // Initialize in-memory store and services
    // DocumentManagementService creates its own DocumentStore internally
    docService = new DocumentManagementService(":memory:", null);
    await docService.initialize();
    const registry = new ScraperRegistry();
    scraperService = new ScraperService(registry);
    pipelineManager = new PipelineManager(docService, 3, { recoverJobs: false });
    await pipelineManager.start();

    // Clear any previous nock mocks
    nock.cleanAll();
  });

  afterEach(async () => {
    // Cleanup
    await pipelineManager.stop();
    await docService.shutdown();
    nock.cleanAll();
  });

  describe("Refresh Scenarios", () => {
    it("should delete documents when a page returns 404 during refresh", async () => {
      // Setup: Mock initial two-page site
      nock(TEST_BASE_URL)
        .get("/")
        .reply(200, "<html><body><h1>Home</h1><a href='/page1'>Page 1</a><a href='/page2'>Page 2</a></body></html>", {
          "Content-Type": "text/html",
          ETag: '"home-v1"',
        })
        .get("/page1")
        .reply(200, "<html><body><h1>Page 1</h1><p>Content of page 1</p></body></html>", {
          "Content-Type": "text/html",
          ETag: '"page1-v1"',
        })
        .get("/page2")
        .reply(200, "<html><body><h1>Page 2</h1><p>Content of page 2</p></body></html>", {
          "Content-Type": "text/html",
          ETag: '"page2-v1"',
        });

      // Initial scrape
      const initialJobId = await pipelineManager.enqueueScrapeJob(TEST_LIBRARY, TEST_VERSION, {
        url: `${TEST_BASE_URL}/`,
        library: TEST_LIBRARY,
        version: TEST_VERSION,
        maxPages: 10,
        maxDepth: 2,
      } satisfies ScraperOptions);

      // Wait for job to complete
      await pipelineManager.waitForJobCompletion(initialJobId);

      // Verify all pages were indexed
      const initialSearch = await docService.searchStore(TEST_LIBRARY, TEST_VERSION, "page", 10);
      expect(initialSearch.length).toBeGreaterThan(0);

      // Get page IDs for verification
      const pages = await docService.getPagesByVersionId(
        await docService.ensureVersion({ library: TEST_LIBRARY, version: TEST_VERSION }),
      );
      expect(pages.length).toBe(3); // home, page1, page2

      const page2 = pages.find((p) => p.url === `${TEST_BASE_URL}/page2`);
      expect(page2).toBeDefined();
      const page2Id = page2!.id;

      // Setup: Mock refresh with page2 deleted (404)
      // Enable nock logging to see what requests are made
      nock(TEST_BASE_URL)
        .get("/")
        .matchHeader("if-none-match", '"home-v1"')
        .reply(304, undefined, { ETag: '"home-v1"' }) // Unchanged
        .get("/page1")
        .matchHeader("if-none-match", '"page1-v1"')
        .reply(304, undefined, { ETag: '"page1-v1"' }) // Unchanged
        .get("/page2")
        .matchHeader("if-none-match", '"page2-v1"')
        .reply(404); // Deleted!

      // Execute refresh
      const refreshJobId = await pipelineManager.enqueueRefreshJob(TEST_LIBRARY, TEST_VERSION);
      await pipelineManager.waitForJobCompletion(refreshJobId);

      // Verify page2 documents were deleted by checking if we can still find page2 content
      // Use a unique phrase that only appears in page2 to avoid false positives from keyword matching
      const page2Search = await docService.searchStore(TEST_LIBRARY, TEST_VERSION, "Content of page", 10);
      const hasPage2Content = page2Search.some((r: StoreSearchResult) => 
        r.url === `${TEST_BASE_URL}/page2`
      );
      expect(hasPage2Content).toBe(false);

      // Verify page1 documents still exist
      const page1Search = await docService.searchStore(TEST_LIBRARY, TEST_VERSION, "Content of page 1", 10);
      expect(page1Search.length).toBeGreaterThan(0);
    }, 30000);

    it("should update documents when a page has changed content during refresh", async () => {
      const originalContent = "Original content version 1";
      const updatedContent = "Updated content version 2";

      // Setup: Mock initial site
      nock(TEST_BASE_URL)
        .get("/")
        .reply(
          200,
          `<html><body><h1>Home</h1><a href='/page1'>Page 1</a></body></html>`,
          {
            "Content-Type": "text/html",
            ETag: '"home-v1"',
          },
        )
        .get("/page1")
        .reply(
          200,
          `<html><body><h1>Page 1</h1><p>${originalContent}</p></body></html>`,
          {
            "Content-Type": "text/html",
            ETag: '"page1-v1"',
          },
        );

      // Initial scrape
      const initialJobId = await pipelineManager.enqueueScrapeJob(TEST_LIBRARY, TEST_VERSION, {
        url: `${TEST_BASE_URL}/`,
        library: TEST_LIBRARY,
        version: TEST_VERSION,
        maxPages: 10,
        maxDepth: 2,
      } satisfies ScraperOptions);

      await pipelineManager.waitForJobCompletion(initialJobId);

      // Verify original content is indexed
      const initialSearch = await docService.searchStore(
        TEST_LIBRARY,
        TEST_VERSION,
        "original content",
        10,
      );
      expect(initialSearch.length).toBeGreaterThan(0);
      expect(initialSearch[0].content).toContain(originalContent);

      // Setup: Mock refresh with updated page1 content
      nock(TEST_BASE_URL)
        .get("/")
        .reply(304, undefined, { ETag: '"home-v1"' }) // Unchanged
        .get("/page1")
        .reply(
          200,
          `<html><body><h1>Page 1</h1><p>${updatedContent}</p></body></html>`,
          {
            "Content-Type": "text/html",
            ETag: '"page1-v2"', // New ETag indicates change
          },
        );

      // Execute refresh
      const refreshJobId = await pipelineManager.enqueueRefreshJob(TEST_LIBRARY, TEST_VERSION);
      await pipelineManager.waitForJobCompletion(refreshJobId);

      // Verify updated content is now indexed
      const updatedSearch = await docService.searchStore(
        TEST_LIBRARY,
        TEST_VERSION,
        "updated content",
        10,
      );
      expect(updatedSearch.length).toBeGreaterThan(0);
      expect(updatedSearch[0].content).toContain(updatedContent);

      // Verify old content is no longer indexed
      const oldSearch = await docService.searchStore(
        TEST_LIBRARY,
        TEST_VERSION,
        "original content",
        10,
      );
      const hasOldContent = oldSearch.some((r: StoreSearchResult) => r.content.includes(originalContent));
      expect(hasOldContent).toBe(false);
    }, 30000);

    it("should skip processing when pages return 304 Not Modified", async () => {
      // Setup: Mock initial site
      nock(TEST_BASE_URL)
        .get("/")
        .reply(200, "<html><body><h1>Home</h1><a href='/page1'>Page 1</a></body></html>", {
          "Content-Type": "text/html",
          ETag: '"home-v1"',
        })
        .get("/page1")
        .reply(200, "<html><body><h1>Page 1</h1><p>Stable content</p></body></html>", {
          "Content-Type": "text/html",
          ETag: '"page1-v1"',
        });

      // Initial scrape
      const initialJobId = await pipelineManager.enqueueScrapeJob(TEST_LIBRARY, TEST_VERSION, {
        url: `${TEST_BASE_URL}/`,
        library: TEST_LIBRARY,
        version: TEST_VERSION,
        maxPages: 10,
        maxDepth: 2,
      } satisfies ScraperOptions);

      await pipelineManager.waitForJobCompletion(initialJobId);

      // Get initial document count
      const versionId = await docService.ensureVersion({
        library: TEST_LIBRARY,
        version: TEST_VERSION,
      });
      const initialPages = await docService.getPagesByVersionId(versionId);
      const initialPageCount = initialPages.length;

      // Setup: Mock refresh with all 304 responses
      nock(TEST_BASE_URL)
        .get("/")
        .reply(304, undefined, { ETag: '"home-v1"' })
        .get("/page1")
        .reply(304, undefined, { ETag: '"page1-v1"' });

      // Execute refresh
      const refreshJobId = await pipelineManager.enqueueRefreshJob(TEST_LIBRARY, TEST_VERSION);
      await pipelineManager.waitForJobCompletion(refreshJobId);

      // Verify page count hasn't changed
      const finalPages = await docService.getPagesByVersionId(versionId);
      expect(finalPages.length).toBe(initialPageCount);

      // Verify content is still accessible
      const search = await docService.searchStore(TEST_LIBRARY, TEST_VERSION, "stable", 10);
      expect(search.length).toBeGreaterThan(0);
    }, 30000);

    it("should discover and index new pages during refresh", async () => {
      // Setup: Mock initial site with 2 pages
      nock(TEST_BASE_URL)
        .get("/")
        .reply(200, "<html><body><h1>Home</h1><a href='/page1'>Page 1</a></body></html>", {
          "Content-Type": "text/html",
          ETag: '"home-v1"',
        })
        .get("/page1")
        .reply(200, "<html><body><h1>Page 1</h1><p>Original page</p></body></html>", {
          "Content-Type": "text/html",
          ETag: '"page1-v1"',
        });

      // Initial scrape
      const initialJobId = await pipelineManager.enqueueScrapeJob(TEST_LIBRARY, TEST_VERSION, {
        url: `${TEST_BASE_URL}/`,
        library: TEST_LIBRARY,
        version: TEST_VERSION,
        maxPages: 10,
        maxDepth: 2,
      } satisfies ScraperOptions);

      await pipelineManager.waitForJobCompletion(initialJobId);

      // Verify initial page count
      const versionId = await docService.ensureVersion({
        library: TEST_LIBRARY,
        version: TEST_VERSION,
      });
      const initialPages = await docService.getPagesByVersionId(versionId);
      expect(initialPages.length).toBe(2); // home, page1

      // Setup: Mock refresh where home page now links to a new page2
      nock(TEST_BASE_URL)
        .get("/")
        .reply(
          200,
          "<html><body><h1>Home</h1><a href='/page1'>Page 1</a><a href='/page2'>Page 2</a></body></html>",
          {
            "Content-Type": "text/html",
            ETag: '"home-v2"', // Changed ETag
          },
        )
        .get("/page1")
        .reply(304, undefined, { ETag: '"page1-v1"' }) // Unchanged
        .get("/page2")
        .reply(200, "<html><body><h1>Page 2</h1><p>Newly added page</p></body></html>", {
          "Content-Type": "text/html",
          ETag: '"page2-v1"',
        });

      // Execute refresh
      const refreshJobId = await pipelineManager.enqueueRefreshJob(TEST_LIBRARY, TEST_VERSION);
      await pipelineManager.waitForJobCompletion(refreshJobId);

      // Verify new page was discovered and indexed
      const finalPages = await docService.getPagesByVersionId(versionId);
      expect(finalPages.length).toBe(3); // home, page1, page2

      const page2 = finalPages.find((p) => p.url === `${TEST_BASE_URL}/page2`);
      expect(page2).toBeDefined();

      // Verify new page content is searchable
      const search = await docService.searchStore(TEST_LIBRARY, TEST_VERSION, "newly added", 10);
      expect(search.length).toBeGreaterThan(0);
    }, 30000);
  });

  describe("Standard Scrape Error Handling", () => {
    it("should gracefully handle 404 errors for broken links during normal scraping", async () => {
      // Setup: Mock site with a broken link
      nock(TEST_BASE_URL)
        .get("/")
        .reply(
          200,
          "<html><body><h1>Home</h1><a href='/valid-page'>Valid</a><a href='/broken-link'>Broken</a></body></html>",
          {
            "Content-Type": "text/html",
            ETag: '"home-v1"',
          },
        )
        .get("/valid-page")
        .reply(200, "<html><body><h1>Valid Page</h1><p>This page exists</p></body></html>", {
          "Content-Type": "text/html",
          ETag: '"valid-v1"',
        })
        .get("/broken-link")
        .reply(404); // Broken link!

      // Execute scrape
      const jobId = await pipelineManager.enqueueScrapeJob(TEST_LIBRARY, TEST_VERSION, {
        url: `${TEST_BASE_URL}/`,
        library: TEST_LIBRARY,
        version: TEST_VERSION,
        maxPages: 10,
        maxDepth: 2,
      } satisfies ScraperOptions);

      // Should complete successfully despite the 404
      await pipelineManager.waitForJobCompletion(jobId);

      const job = await pipelineManager.getJob(jobId);
      expect(job?.status).toBe("completed");

      // Verify valid pages were indexed
      const versionId = await docService.ensureVersion({
        library: TEST_LIBRARY,
        version: TEST_VERSION,
      });
      const pages = await docService.getPagesByVersionId(versionId);

      // Should have home and valid-page, but NOT broken-link
      expect(pages.length).toBe(2);
      const urls = pages.map((p) => p.url);
      expect(urls).toContain(`${TEST_BASE_URL}/`);
      expect(urls).toContain(`${TEST_BASE_URL}/valid-page`);
      expect(urls).not.toContain(`${TEST_BASE_URL}/broken-link`);

      // Verify valid page content is searchable
      const search = await docService.searchStore(TEST_LIBRARY, TEST_VERSION, "exists", 10);
      expect(search.length).toBeGreaterThan(0);
    }, 30000);

    it("should continue scraping after encountering multiple 404 errors", async () => {
      // Setup: Mock site with multiple broken links interspersed with valid ones
      nock(TEST_BASE_URL)
        .get("/")
        .reply(
          200,
          "<html><body><h1>Home</h1><a href='/page1'>P1</a><a href='/404-1'>404</a><a href='/page2'>P2</a><a href='/404-2'>404</a></body></html>",
          {
            "Content-Type": "text/html",
            ETag: '"home-v1"',
          },
        )
        .get("/page1")
        .reply(200, "<html><body><h1>Page 1</h1></body></html>", {
          "Content-Type": "text/html",
          ETag: '"page1-v1"',
        })
        .get("/404-1")
        .reply(404)
        .get("/page2")
        .reply(200, "<html><body><h1>Page 2</h1></body></html>", {
          "Content-Type": "text/html",
          ETag: '"page2-v1"',
        })
        .get("/404-2")
        .reply(404);

      // Execute scrape
      const jobId = await pipelineManager.enqueueScrapeJob(TEST_LIBRARY, TEST_VERSION, {
        url: `${TEST_BASE_URL}/`,
        library: TEST_LIBRARY,
        version: TEST_VERSION,
        maxPages: 10,
        maxDepth: 2,
      } satisfies ScraperOptions);

      await pipelineManager.waitForJobCompletion(jobId);

      // Verify all valid pages were indexed despite multiple 404s
      const versionId = await docService.ensureVersion({
        library: TEST_LIBRARY,
        version: TEST_VERSION,
      });
      const pages = await docService.getPagesByVersionId(versionId);

      expect(pages.length).toBe(3); // home, page1, page2
      const urls = pages.map((p) => p.url);
      expect(urls).toContain(`${TEST_BASE_URL}/`);
      expect(urls).toContain(`${TEST_BASE_URL}/page1`);
      expect(urls).toContain(`${TEST_BASE_URL}/page2`);
    }, 30000);
  });
});
