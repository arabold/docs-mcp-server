/**
 * End-to-end tests for scrape progress counter semantics.
 *
 * The `scrape-progress-reporting` capability defines four counters and an
 * invariant relating them. Unit tests pin the arithmetic inside
 * `BaseScraperStrategy`; these tests cover what only a whole-pipeline run can
 * show: that the numbers a real crawl produces survive the trip through
 * `PipelineManager` into the job record, and that the value an MCP client reads
 * back after completion is the value the scraper computed.
 *
 * Uses nock to mock HTTP responses and an in-memory database.
 */

import nock from "nock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBusService, EventType } from "../src/events";
import { PipelineManager } from "../src/pipeline/PipelineManager";
import { PipelineJobStatus } from "../src/pipeline/types";
import { PageOutcome, type ScraperOptions } from "../src/scraper/types";
import { DocumentManagementService } from "../src/store/DocumentManagementService";
import { GetJobInfoTool } from "../src/tools/GetJobInfoTool";
import { type AppConfig, loadConfig } from "../src/utils/config";

const TEST_BASE_URL = "http://progress-docs.example.com";
const TEST_LIBRARY = "progress-lib";
const TEST_VERSION = "1.0.0";

/**
 * Builds an HTML page linking to each of `links`, so a crawl fans out
 * predictably from the root.
 */
function hubPage(links: string[]): string {
  const anchors = links.map((href) => `<a href="${href}">${href}</a>`).join("");
  return `<html><body><h1>Hub</h1>${anchors}</body></html>`;
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

function leafPage(title: string): string {
  return `<html><body><h1>${title}</h1><p>Body text for ${title}.</p></body></html>`;
}

describe("Scrape progress counters E2E", () => {
  let docService: DocumentManagementService;
  let pipelineManager: PipelineManager;
  let eventBus: EventBusService;
  let appConfig: AppConfig;
  /** Every progress event the run emitted, in order. */
  let progressEvents: Array<{
    pagesScraped: number;
    totalPages: number;
    totalDiscovered: number;
    pagesIndexed: number;
    outcome: PageOutcome;
    currentUrl: string;
  }>;

  beforeEach(async () => {
    appConfig = loadConfig();
    appConfig.app.storePath = ":memory:";
    appConfig.app.embeddingModel = ""; // counters are independent of embeddings
    appConfig.scraper.security.network.allowPrivateNetworks = true;
    // One worker keeps the event order deterministic, which matters for the
    // monotonicity assertions below.
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
        pagesScraped: progress.pagesScraped,
        totalPages: progress.totalPages,
        totalDiscovered: progress.totalDiscovered,
        pagesIndexed: progress.pagesIndexed,
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

  /** Runs a scrape to completion and returns the finished job record. */
  async function runScrape(options: Partial<ScraperOptions>) {
    const jobId = await pipelineManager.enqueueScrapeJob(TEST_LIBRARY, TEST_VERSION, {
      url: `${TEST_BASE_URL}/`,
      library: TEST_LIBRARY,
      version: TEST_VERSION,
      maxPages: 100,
      maxDepth: 3,
      ...options,
    } satisfies ScraperOptions);
    await pipelineManager.waitForJobCompletion(jobId);
    const job = await pipelineManager.getJob(jobId);
    if (!job) throw new Error(`job ${jobId} vanished after completion`);
    return job;
  }

  const lastEvent = () => progressEvents[progressEvents.length - 1];

  it("converges pagesScraped on totalPages when the queue drains", async () => {
    nock(TEST_BASE_URL)
      .get("/")
      .reply(200, hubPage(["/a", "/b", "/c"]), { "Content-Type": "text/html" })
      .get("/a")
      .reply(200, leafPage("A"), { "Content-Type": "text/html" })
      .get("/b")
      .reply(200, leafPage("B"), { "Content-Type": "text/html" })
      .get("/c")
      .reply(200, leafPage("C"), { "Content-Type": "text/html" });

    const job = await runScrape({});

    expect(job.status).toBe(PipelineJobStatus.COMPLETED);

    // Root plus three leaves, every one of them stored.
    const final = lastEvent();
    expect(final.pagesScraped).toBe(4);
    expect(final.totalPages).toBe(4);
    expect(final.pagesIndexed).toBe(4);
    expect(final.totalDiscovered).toBe(4);

    // The point of the invariant: the fraction reads 100%, not 4 of 100.
    expect(final.pagesScraped / final.totalPages).toBe(1);
    expect(final.totalPages).not.toBe(100);
  }, 30000);

  it("counts non-content outcomes in pagesScraped but not pagesIndexed", async () => {
    // Two pages store content, one 404s. All three are processed.
    nock(TEST_BASE_URL)
      .get("/")
      .reply(200, hubPage(["/kept", "/gone"]), { "Content-Type": "text/html" })
      .get("/kept")
      .reply(200, leafPage("Kept"), { "Content-Type": "text/html" })
      .get("/gone")
      .reply(404);

    const job = await runScrape({ ignoreErrors: true });

    expect(job.status).toBe(PipelineJobStatus.COMPLETED);

    const final = lastEvent();
    expect(final.pagesScraped).toBe(3); // root + kept + gone
    expect(final.pagesIndexed).toBe(2); // root + kept
    expect(final.totalPages).toBe(3);

    // The 404 emitted its own event naming the outcome, rather than advancing
    // the count silently.
    const absent = progressEvents.filter((e) => e.outcome === PageOutcome.Absent);
    expect(absent).toHaveLength(1);
    expect(absent[0].currentUrl).toBe(`${TEST_BASE_URL}/gone`);

    // Every queued item reached exactly one outcome.
    expect(progressEvents).toHaveLength(3);
  }, 30000);

  it("bounds pagesIndexed by maxPages while pagesScraped absorbs the misses", async () => {
    // Six links: three store content, three 404. With maxPages 3, the crawl
    // must keep going past the misses until three pages have actually indexed.
    const scope = nock(TEST_BASE_URL)
      .get("/")
      .reply(200, hubPage(["/miss1", "/hit1", "/miss2", "/hit2", "/miss3"]), {
        "Content-Type": "text/html",
      });
    for (const name of ["hit1", "hit2"]) {
      scope.get(`/${name}`).reply(200, leafPage(name), { "Content-Type": "text/html" });
    }
    for (const name of ["miss1", "miss2", "miss3"]) {
      scope.get(`/${name}`).reply(404);
    }

    const job = await runScrape({ maxPages: 3, ignoreErrors: true });

    expect(job.status).toBe(PipelineJobStatus.COMPLETED);

    const final = lastEvent();
    // Root + hit1 + hit2 produce content and exhaust the budget of 3.
    expect(final.pagesIndexed).toBe(3);
    expect(final.pagesIndexed).toBeLessThanOrEqual(3);
    // The 404s were processed but did not consume the budget, so more items
    // were scraped than indexed.
    expect(final.pagesScraped).toBeGreaterThan(final.pagesIndexed);
    // The denominator tracked the extra work rather than staying at maxPages,
    // so the fraction still reads 100% at the end.
    expect(final.totalPages).toBe(final.pagesScraped);
    // totalDiscovered counts admissions, unbounded by the limit.
    expect(final.totalDiscovered).toBe(6);
  }, 30000);

  it("never reports pagesScraped above totalPages at any point", async () => {
    const links = Array.from({ length: 8 }, (_, i) => `/p${i}`);
    const scope = nock(TEST_BASE_URL)
      .get("/")
      .reply(200, hubPage(links), { "Content-Type": "text/html" });
    for (const [i, link] of links.entries()) {
      // Alternate stored and missing so the clamp is exercised mid-crawl.
      if (i % 2 === 0) {
        scope.get(link).reply(200, leafPage(link), { "Content-Type": "text/html" });
      } else {
        scope.get(link).reply(404);
      }
    }

    await runScrape({ maxPages: 3, ignoreErrors: true });

    expect(progressEvents.length).toBeGreaterThan(0);
    for (const event of progressEvents) {
      expect(event.pagesScraped).toBeLessThanOrEqual(event.totalPages);
      expect(event.pagesIndexed).toBeLessThanOrEqual(event.pagesScraped);
      expect(event.totalPages).toBeLessThanOrEqual(event.totalDiscovered);
    }

    // pagesScraped advances by exactly one per event, never skipping or
    // repeating — the "every item reaches exactly one outcome" rule.
    const scraped = progressEvents.map((e) => e.pagesScraped);
    expect(scraped).toEqual(scraped.map((_, i) => i + 1));
  }, 30000);

  it("persists all three counters on the job record for later reads", async () => {
    nock(TEST_BASE_URL)
      .get("/")
      .reply(200, hubPage(["/one", "/two"]), { "Content-Type": "text/html" })
      .get("/one")
      .reply(200, leafPage("One"), { "Content-Type": "text/html" })
      .get("/two")
      .reply(404);

    const job = await runScrape({ ignoreErrors: true });
    const final = lastEvent();

    // The persisted columns carry the values the crawl ended on, rather than
    // being live-only or reconstructed from a different source.
    expect(job.progressPages).toBe(final.pagesScraped);
    expect(job.progressMaxPages).toBe(final.totalPages);
    expect(job.progressPagesIndexed).toBe(final.pagesIndexed);

    // And an MCP client reading the job back sees the same numbers. This is the
    // link the unit tests cannot cover: `progressPagesIndexed` has to survive
    // the write to the job record and the read back through the tool layer.
    const { job: jobInfo } = await new GetJobInfoTool(pipelineManager).execute({
      jobId: job.id,
    });
    expect(jobInfo.progress).toBeDefined();
    expect(jobInfo.progress?.pages).toBe(final.pagesScraped);
    expect(jobInfo.progress?.totalPages).toBe(final.totalPages);
    expect(jobInfo.progress?.pagesIndexed).toBe(final.pagesIndexed);
    // Not null — a completed crawl that indexed pages must never read as unknown.
    expect(jobInfo.progress?.pagesIndexed).not.toBeNull();
  }, 30000);

  it("does not adjust a cancelled job's counters to look complete", async () => {
    // A slow hub with many children: cancelling mid-crawl leaves queued items
    // unprocessed, and the counters must show that rather than being squared up.
    const links = Array.from({ length: 12 }, (_, i) => `/slow${i}`);
    const scope = nock(TEST_BASE_URL)
      .get("/")
      .reply(200, hubPage(links), { "Content-Type": "text/html" });
    for (const link of links) {
      scope
        .get(link)
        .delay(200)
        .reply(200, leafPage(link), { "Content-Type": "text/html" });
    }

    const jobId = await pipelineManager.enqueueScrapeJob(TEST_LIBRARY, TEST_VERSION, {
      url: `${TEST_BASE_URL}/`,
      library: TEST_LIBRARY,
      version: TEST_VERSION,
      maxPages: 100,
      maxDepth: 3,
    } satisfies ScraperOptions);

    // Cancel once the crawl has discovered the children and processed a few.
    await new Promise<void>((resolve) => {
      const stop = eventBus.on(EventType.JOB_PROGRESS, ({ progress }) => {
        if (progress.pagesScraped >= 3) {
          stop();
          resolve();
        }
      });
    });
    await pipelineManager.cancelJob(jobId);
    await pipelineManager.waitForJobCompletion(jobId).catch(() => {
      // Cancellation surfaces as a rejection; the job record is what we assert on.
    });

    const job = await pipelineManager.getJob(jobId);
    expect(job?.status).toBe(PipelineJobStatus.CANCELLED);

    const final = lastEvent();
    expect(final.pagesScraped).toBeLessThan(final.totalPages);
    expect(final.pagesScraped / final.totalPages).toBeLessThan(1);
  }, 30000);
});
