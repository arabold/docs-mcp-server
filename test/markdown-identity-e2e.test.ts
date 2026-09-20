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
});
