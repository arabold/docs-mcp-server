/**
 * End-to-end tests for Markdown variant page identity.
 *
 * A published Markdown file is a representation of a page, not a page of its
 * own. Sites express that in two incompatible ways: some list canonical URLs in
 * `llms.txt` and serve a `.md` alongside each, others list the `.md` URLs
 * directly. Indexed naively the second shape stores every page under a `.md`
 * URL, and a site reachable both ways stores each document twice.
 *
 * These tests drive whole crawls against mock sites of each shape, because the
 * property at stake — one document, one identity, whichever route reached it —
 * only exists across a crawl. Unit tests cover the rule itself.
 */

import nock from "nock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBusService } from "../src/events";
import { PipelineManager } from "../src/pipeline/PipelineManager";
import { PipelineJobStatus } from "../src/pipeline/types";
import { ScrapeMode, type ScraperOptions } from "../src/scraper/types";
import { DocumentManagementService } from "../src/store/DocumentManagementService";
import { type AppConfig, loadConfig } from "../src/utils/config";

const TEST_BASE_URL = "http://md-docs.example.com";
const TEST_LIBRARY = "md-lib";
const TEST_VERSION = "1.0.0";

describe("Markdown variant identity E2E", () => {
  let docService: DocumentManagementService;
  let pipelineManager: PipelineManager;
  let appConfig: AppConfig;

  beforeEach(async () => {
    appConfig = loadConfig();
    appConfig.app.storePath = ":memory:";
    appConfig.app.embeddingModel = "";
    appConfig.scraper.security.network.allowPrivateNetworks = true;
    appConfig.scraper.maxConcurrency = 1;

    const eventBus = new EventBusService();
    docService = new DocumentManagementService(eventBus, appConfig);
    await docService.initialize();
    pipelineManager = new PipelineManager(docService, eventBus, {
      recoverJobs: false,
      appConfig,
    });
    await pipelineManager.start();

    nock.cleanAll();
  });

  afterEach(async () => {
    await pipelineManager.stop();
    await docService.shutdown();
    nock.cleanAll();
  });

  async function runScrape(options: Partial<ScraperOptions> = {}) {
    const jobId = await pipelineManager.enqueueScrapeJob(TEST_LIBRARY, TEST_VERSION, {
      url: `${TEST_BASE_URL}/`,
      library: TEST_LIBRARY,
      version: TEST_VERSION,
      maxPages: 100,
      maxDepth: 3,
      scrapeMode: ScrapeMode.Fetch,
      ...options,
    } satisfies ScraperOptions);
    await pipelineManager.waitForJobCompletion(jobId);
    return await pipelineManager.getJob(jobId);
  }

  async function storedUrls(): Promise<string[]> {
    const versionId = await docService.ensureVersion({
      library: TEST_LIBRARY,
      version: TEST_VERSION,
    });
    const pages = await docService.getPagesByVersionId(versionId);
    return pages.map((p) => p.url).sort();
  }

  it("records pages under canonical URLs when llms.txt lists .md entries", async () => {
    // The react.dev shape: every llms.txt entry names a .md URL.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(
        200,
        `# Docs\n\n- [Guide](${TEST_BASE_URL}/guide.md)\n- [API](${TEST_BASE_URL}/api.md)\n`,
        { "Content-Type": "text/plain" },
      )
      .get("/")
      .reply(200, "<html><body><h1>Home</h1><p>Welcome to the docs.</p></body></html>", {
        "Content-Type": "text/html",
      })
      .get("/guide.md")
      .reply(200, "# Guide\n\nHow to use the thing.", { "Content-Type": "text/markdown" })
      .get("/api.md")
      .reply(200, "# API\n\nReference material.", { "Content-Type": "text/markdown" });

    expect((await runScrape())?.status).toBe(PipelineJobStatus.COMPLETED);

    const urls = await storedUrls();
    expect(urls).toContain(`${TEST_BASE_URL}/guide`);
    expect(urls).toContain(`${TEST_BASE_URL}/api`);
    expect(urls.filter((u) => u.endsWith(".md"))).toEqual([]);
  }, 30000);

  it("indexes one page when both representations are reachable", async () => {
    // The vite.dev shape: llms.txt names .md URLs and the HTML pages are also
    // crawlable, so each document is reachable by two routes.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(200, `# Docs\n\n- [Guide](${TEST_BASE_URL}/guide.md)\n`, {
        "Content-Type": "text/plain",
      })
      .get("/")
      .reply(
        200,
        `<html><body><h1>Home</h1><a href="${TEST_BASE_URL}/guide">Guide</a></body></html>`,
        { "Content-Type": "text/html" },
      )
      .get("/guide.md")
      .reply(200, "# Guide\n\nMarkdown body.", { "Content-Type": "text/markdown" })
      .get("/guide")
      .reply(
        200,
        "<html><body><h1>Guide</h1><p>HTML body.</p></body></html>",
        { "Content-Type": "text/html" },
      );

    expect((await runScrape())?.status).toBe(PipelineJobStatus.COMPLETED);

    const urls = await storedUrls();
    // One identity, reached twice.
    expect(urls.filter((u) => u === `${TEST_BASE_URL}/guide`)).toHaveLength(1);
    expect(urls.filter((u) => u.endsWith(".md"))).toEqual([]);

    // And the Markdown representation is the one kept, whichever arrived last.
    const results = await docService.searchStore(
      TEST_LIBRARY,
      TEST_VERSION,
      "body",
      10,
    );
    const guide = results.filter((r) => r.url === `${TEST_BASE_URL}/guide`);
    expect(guide.length).toBeGreaterThan(0);
    expect(guide.some((r) => r.content?.includes("Markdown body"))).toBe(true);
    expect(guide.some((r) => r.content?.includes("HTML body"))).toBe(false);
  }, 30000);

  it("keeps a .md URL that serves HTML under its own identity", async () => {
    // A server ignoring the extension must not have its response folded onto a
    // canonical URL it does not serve.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(404)
      .get("/")
      .reply(
        200,
        `<html><body><h1>Home</h1><a href="${TEST_BASE_URL}/stale.md">Stale</a></body></html>`,
        { "Content-Type": "text/html" },
      )
      .get("/stale.md")
      .reply(200, "<html><body><h1>Soft 404</h1><p>No such document.</p></body></html>", {
        "Content-Type": "text/html",
      });

    expect((await runScrape())?.status).toBe(PipelineJobStatus.COMPLETED);

    const urls = await storedUrls();
    expect(urls).toContain(`${TEST_BASE_URL}/stale.md`);
    expect(urls).not.toContain(`${TEST_BASE_URL}/stale`);
  }, 30000);

  it("refreshes the representation the content came from, not the identity", async () => {
    // The identity is an assertion about where the page lives; the retrieval
    // location is a fact about where its bytes came from. Refreshing the former
    // fetches a different representation and leaves the stored one stale.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(200, `# Docs\n\n- [Guide](${TEST_BASE_URL}/guide.md)\n`, {
        "Content-Type": "text/plain",
      })
      .get("/")
      .reply(200, "<html><body><h1>Home</h1><p>hi</p></body></html>", {
        "Content-Type": "text/html",
      })
      .get("/guide.md")
      .reply(200, "# Guide\n\nOriginal markdown body.", {
        "Content-Type": "text/markdown",
        ETag: '"md-v1"',
      });

    expect((await runScrape())?.status).toBe(PipelineJobStatus.COMPLETED);
    expect(await storedUrls()).toContain(`${TEST_BASE_URL}/guide`);

    // Only the markdown representation is mocked for the refresh. A refresh that
    // asked for the identity would find nothing and fail the assertions below.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(404)
      .get("/")
      .reply(200, "<html><body><h1>Home</h1><p>hi</p></body></html>", {
        "Content-Type": "text/html",
      })
      .get("/guide.md")
      .matchHeader("if-none-match", '"md-v1"')
      .reply(200, "# Guide\n\nUpdated markdown body.", {
        "Content-Type": "text/markdown",
        ETag: '"md-v2"',
      });

    const refreshId = await pipelineManager.enqueueRefreshJob(TEST_LIBRARY, TEST_VERSION);
    await pipelineManager.waitForJobCompletion(refreshId);

    // The page updated rather than freezing at what it was first indexed with.
    const results = await docService.searchStore(TEST_LIBRARY, TEST_VERSION, "body", 10);
    const guide = results.filter((r) => r.url === `${TEST_BASE_URL}/guide`);
    expect(guide.some((r) => r.content?.includes("Updated markdown body"))).toBe(true);
    expect(guide.some((r) => r.content?.includes("Original markdown body"))).toBe(false);
  }, 30000);

  it("sends a stored validator back to the resource that issued it", async () => {
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(200, `# Docs\n\n- [Guide](${TEST_BASE_URL}/guide.md)\n`, {
        "Content-Type": "text/plain",
      })
      .get("/")
      .reply(200, "<html><body><h1>Home</h1><p>hi</p></body></html>", {
        "Content-Type": "text/html",
      })
      .get("/guide.md")
      .reply(200, "# Guide\n\nBody.", {
        "Content-Type": "text/markdown",
        ETag: '"md-v1"',
      });

    expect((await runScrape())?.status).toBe(PipelineJobStatus.COMPLETED);

    // The interceptor only matches when the markdown resource's own validator
    // arrives on a request for that resource.
    const conditional = nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(404)
      .get("/")
      .reply(200, "<html><body><h1>Home</h1><p>hi</p></body></html>", {
        "Content-Type": "text/html",
      })
      .get("/guide.md")
      .matchHeader("if-none-match", '"md-v1"')
      .reply(304, undefined, { ETag: '"md-v1"' });

    const refreshId = await pipelineManager.enqueueRefreshJob(TEST_LIBRARY, TEST_VERSION);
    await pipelineManager.waitForJobCompletion(refreshId);

    expect(conditional.isDone()).toBe(true);
  }, 30000);

  it("refreshes a page with no separate retrieval location unchanged", async () => {
    // The common case must keep working: no llms.txt, no markdown variant.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(404)
      .get("/")
      .reply(200, "<html><body><h1>Home</h1><p>Original text.</p></body></html>", {
        "Content-Type": "text/html",
        ETag: '"html-v1"',
      });

    expect((await runScrape())?.status).toBe(PipelineJobStatus.COMPLETED);

    const refreshed = nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(404)
      .get("/")
      .matchHeader("if-none-match", '"html-v1"')
      .reply(200, "<html><body><h1>Home</h1><p>Updated text.</p></body></html>", {
        "Content-Type": "text/html",
        ETag: '"html-v2"',
      });

    const refreshId = await pipelineManager.enqueueRefreshJob(TEST_LIBRARY, TEST_VERSION);
    await pipelineManager.waitForJobCompletion(refreshId);

    expect(refreshed.isDone()).toBe(true);
    const results = await docService.searchStore(TEST_LIBRARY, TEST_VERSION, "text", 10);
    expect(results.some((r) => r.content?.includes("Updated text"))).toBe(true);
  }, 30000);
});
