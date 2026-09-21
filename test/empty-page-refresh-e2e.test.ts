/**
 * End-to-end tests for how a page with no extractable content is recorded.
 *
 * The `scrape-progress-reporting` capability draws a distinction that matters
 * across refreshes: a page that is genuinely empty is recorded as empty and its
 * validator stored, while a page whose pipeline errored is left alone and its
 * validator withheld. Withholding is what keeps a transient extraction fault
 * from becoming permanent — store the etag and the next refresh answers `304`
 * and never retries.
 *
 * That is a property of a sequence of refreshes, so unit tests over a single
 * call cannot show it. These tests drive real refresh cycles against nock and
 * assert on the stored page records.
 */

import nock from "nock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBusService, EventType } from "../src/events";
import { PipelineManager } from "../src/pipeline/PipelineManager";
import { PipelineJobStatus } from "../src/pipeline/types";
import { PageOutcome, ScrapeMode, type ScraperOptions } from "../src/scraper/types";
import { DocumentManagementService } from "../src/store/DocumentManagementService";
import type { StoreSearchResult } from "../src/store/types";
import { type AppConfig, loadConfig } from "../src/utils/config";

const TEST_BASE_URL = "http://empty-docs.example.com";
const TEST_LIBRARY = "empty-lib";
const TEST_VERSION = "1.0.0";

/** A page with a distinctive phrase, so its disappearance is unambiguous. */
function populatedPage(): string {
  return "<html><body><h1>Article</h1><p>Kumquat telemetry manifesto.</p></body></html>";
}

/**
 * Answers the llms.txt probe with a 404, the way a site without one does.
 *
 * `WebScraperStrategy` probes a couple of llms.txt candidates before crawling.
 * Left unmocked they escape to the real network, where the unresolvable test
 * host costs three retries with backoff per candidate — about 14 seconds a job.
 * A persistent 404 is both faster and closer to what a real site answers.
 */
function mockLlmsTxtMisses(): void {
  nock(TEST_BASE_URL).persist().get(/llms\.txt$/).reply(404);
}

/**
 * Valid HTML that yields no extractable text: empty, but not broken.
 *
 * Deliberately carries no `<title>` — a title is extractable content, and a page
 * that has one is stored rather than recorded as empty.
 */
function structurallyEmptyPage(): string {
  return "<html><body></body></html>";
}

describe("Empty page and extraction failure refresh handling E2E", () => {
  let docService: DocumentManagementService;
  let pipelineManager: PipelineManager;
  let eventBus: EventBusService;
  let appConfig: AppConfig;
  let progressEvents: Array<{ outcome: PageOutcome; currentUrl: string }>;

  beforeEach(async () => {
    appConfig = loadConfig();
    appConfig.app.storePath = ":memory:";
    appConfig.app.embeddingModel = "";
    appConfig.scraper.security.network.allowPrivateNetworks = true;
    appConfig.scraper.maxConcurrency = 1;

    eventBus = new EventBusService();
    docService = new DocumentManagementService(eventBus, appConfig);
    await docService.initialize();

    pipelineManager = new PipelineManager(docService, eventBus, {
      recoverJobs: false,
      appConfig,
    });
    await pipelineManager.start();

    progressEvents = [];
    eventBus.on(EventType.JOB_PROGRESS, ({ progress }) => {
      progressEvents.push({
        outcome: progress.outcome,
        currentUrl: progress.currentUrl,
      });
    });

    nock.cleanAll();
    mockLlmsTxtMisses();
  });

  afterEach(async () => {
    await pipelineManager.stop();
    await docService.shutdown();
    nock.cleanAll();
  });

  async function initialScrape(options: Partial<ScraperOptions> = {}) {
    const jobId = await pipelineManager.enqueueScrapeJob(TEST_LIBRARY, TEST_VERSION, {
      url: `${TEST_BASE_URL}/article`,
      library: TEST_LIBRARY,
      version: TEST_VERSION,
      maxPages: 10,
      maxDepth: 1,
      // Plain fetch: these tests are about pipeline outcomes and validators, and
      // a headless browser adds only latency and rendering variance.
      scrapeMode: ScrapeMode.Fetch,
      ...options,
    } satisfies ScraperOptions);
    await pipelineManager.waitForJobCompletion(jobId);
    return await pipelineManager.getJob(jobId);
  }

  async function refresh() {
    const jobId = await pipelineManager.enqueueRefreshJob(TEST_LIBRARY, TEST_VERSION);
    await pipelineManager.waitForJobCompletion(jobId);
    return await pipelineManager.getJob(jobId);
  }

  /** Reads the single stored page record for the article URL. */
  async function storedArticle() {
    const versionId = await docService.ensureVersion({
      library: TEST_LIBRARY,
      version: TEST_VERSION,
    });
    const pages = await docService.getPagesByVersionId(versionId);
    return pages.find((p) => p.url === `${TEST_BASE_URL}/article`);
  }

  async function articleIsSearchable(): Promise<boolean> {
    const results = await docService.searchStore(TEST_LIBRARY, TEST_VERSION, "kumquat", 10);
    return results.some((r: StoreSearchResult) =>
      r.content?.toLowerCase().includes("kumquat"),
    );
  }

  it("records a page that became empty and stores its new etag", async () => {
    nock(TEST_BASE_URL).get("/article").reply(200, populatedPage(), {
      "Content-Type": "text/html",
      ETag: '"article-v1"',
    });

    expect((await initialScrape())?.status).toBe(PipelineJobStatus.COMPLETED);
    expect(await articleIsSearchable()).toBe(true);
    expect((await storedArticle())?.etag).toBe('"article-v1"');

    // The page is now genuinely empty: valid HTML, clean pipeline run, no text.
    nock(TEST_BASE_URL).get("/article").reply(200, structurallyEmptyPage(), {
      "Content-Type": "text/html",
      ETag: '"article-v2"',
    });

    progressEvents = [];
    expect((await refresh())?.status).toBe(PipelineJobStatus.COMPLETED);

    // The outcome is named, not inferred from a null result.
    expect(progressEvents.map((e) => e.outcome)).toContain(PageOutcome.Empty);

    // The page still exists, its old content is gone, and the validator moved
    // forward because the response was an accurate statement that it is empty.
    const page = await storedArticle();
    expect(page).toBeDefined();
    expect(await articleIsSearchable()).toBe(false);
    expect(page?.etag).toBe('"article-v2"');
  }, 60000);

  it("leaves content and etag untouched when extraction fails", async () => {
    nock(TEST_BASE_URL).get("/article").reply(200, populatedPage(), {
      "Content-Type": "text/html",
      ETag: '"article-v1"',
    });

    expect((await initialScrape())?.status).toBe(PipelineJobStatus.COMPLETED);
    expect(await articleIsSearchable()).toBe(true);

    // The refresh serves something the document pipeline will accept by type
    // and then fail to parse: an errored run, not an empty one.
    nock(TEST_BASE_URL)
      .get("/article")
      .reply(200, Buffer.from("%PDF-1.4 not actually a pdf at all"), {
        "Content-Type": "application/pdf",
        ETag: '"article-v2-broken"',
      });

    progressEvents = [];
    expect((await refresh())?.status).toBe(PipelineJobStatus.COMPLETED);

    // We learned nothing about the page, so nothing about it changed.
    expect(await articleIsSearchable()).toBe(true);
    const page = await storedArticle();
    expect(page?.etag).toBe('"article-v1"');
  }, 60000);

  it("retries on the next refresh after a withheld etag, restoring content", async () => {
    nock(TEST_BASE_URL).get("/article").reply(200, populatedPage(), {
      "Content-Type": "text/html",
      ETag: '"article-v1"',
    });
    expect((await initialScrape())?.status).toBe(PipelineJobStatus.COMPLETED);

    // Refresh 1: transient extraction failure. The etag is withheld, so the
    // stored validator stays at v1 even though the server has moved on.
    nock(TEST_BASE_URL)
      .get("/article")
      .reply(200, Buffer.from("%PDF-1.4 not actually a pdf at all"), {
        "Content-Type": "application/pdf",
        ETag: '"article-v2-broken"',
      });
    expect((await refresh())?.status).toBe(PipelineJobStatus.COMPLETED);
    expect((await storedArticle())?.etag).toBe('"article-v1"');

    // Refresh 2: the conditional request still carries v1, so the server has no
    // reason to answer 304 — the fault gets retried rather than being frozen in
    // place. Had the broken etag been stored, this interceptor would not match.
    const recovered = nock(TEST_BASE_URL)
      .get("/article")
      .matchHeader("if-none-match", '"article-v1"')
      .reply(
        200,
        "<html><body><h1>Article</h1><p>Kumquat telemetry manifesto, restored.</p></body></html>",
        { "Content-Type": "text/html", ETag: '"article-v3"' },
      );

    expect((await refresh())?.status).toBe(PipelineJobStatus.COMPLETED);
    expect(recovered.isDone()).toBe(true);

    // Content is back and the validator has finally advanced.
    expect(await articleIsSearchable()).toBe(true);
    expect((await storedArticle())?.etag).toBe('"article-v3"');
  }, 90000);

  it("keeps an empty page empty across a 304 refresh", async () => {
    // A page recorded as empty carries a validator, so subsequent refreshes
    // cost one conditional request and write nothing.
    nock(TEST_BASE_URL).get("/article").reply(200, structurallyEmptyPage(), {
      "Content-Type": "text/html",
      ETag: '"empty-v1"',
    });

    expect((await initialScrape())?.status).toBe(PipelineJobStatus.COMPLETED);
    const afterScrape = await storedArticle();
    expect(afterScrape).toBeDefined();
    expect(afterScrape?.etag).toBe('"empty-v1"');
    expect(await articleIsSearchable()).toBe(false);

    const unchanged = nock(TEST_BASE_URL)
      .get("/article")
      .matchHeader("if-none-match", '"empty-v1"')
      .reply(304, undefined, { ETag: '"empty-v1"' });

    progressEvents = [];
    expect((await refresh())?.status).toBe(PipelineJobStatus.COMPLETED);
    expect(unchanged.isDone()).toBe(true);

    // Unchanged, not empty — the two outcomes stay distinguishable.
    expect(progressEvents.map((e) => e.outcome)).toContain(PageOutcome.Unchanged);
    expect((await storedArticle())?.etag).toBe('"empty-v1"');
    expect(await articleIsSearchable()).toBe(false);
  }, 60000);
});
