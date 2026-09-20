/**
 * End-to-end tests for the unprocessable-content gates.
 *
 * The `unprocessable-content-filtering` capability defines two gates: a
 * queue-time filter that rejects binary-media links before any request is made,
 * and a fetch-time filter that aborts a response whose served `Content-Type` no
 * pipeline can read. `capability.test.ts` covers the predicate in isolation;
 * these tests cover the properties that only a whole-pipeline run can show —
 * that no request is issued for a filtered link, that a skip stores nothing, and
 * that skips stay out of the failure-rate accounting so an asset-heavy site does
 * not abort a scrape in which every page that was read succeeded.
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
import { type AppConfig, loadConfig } from "../src/utils/config";

const TEST_BASE_URL = "http://assets-docs.example.com";
const TEST_LIBRARY = "assets-lib";
const TEST_VERSION = "1.0.0";

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

describe("Unprocessable content gates E2E", () => {
  let docService: DocumentManagementService;
  let pipelineManager: PipelineManager;
  let eventBus: EventBusService;
  let appConfig: AppConfig;
  let progressEvents: Array<{ outcome: PageOutcome; currentUrl: string }>;
  /** Every path nock was actually asked for, so we can prove a link was never fetched. */
  let requestedPaths: string[];

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
    requestedPaths = [];
    nock.emitter.removeAllListeners("no match");
    nock.emitter.on("no match", (req: { path?: string }) => {
      // An unmocked request would otherwise fail silently as a fetch error;
      // recording it makes "no request was issued" provable either way.
      if (req?.path) requestedPaths.push(req.path);
    });
    mockLlmsTxtMisses();
  });

  afterEach(async () => {
    await pipelineManager.stop();
    await docService.shutdown();
    nock.emitter.removeAllListeners("no match");
    nock.cleanAll();
  });

  /** Registers a nock scope that records every path it serves. */
  function recordingScope() {
    return nock(TEST_BASE_URL).on("request", (req: { path?: string }) => {
      if (req?.path) requestedPaths.push(req.path);
    });
  }

  async function runScrape(options: Partial<ScraperOptions> = {}) {
    const jobId = await pipelineManager.enqueueScrapeJob(TEST_LIBRARY, TEST_VERSION, {
      url: `${TEST_BASE_URL}/`,
      library: TEST_LIBRARY,
      version: TEST_VERSION,
      maxPages: 100,
      maxDepth: 3,
      ...options,
    } satisfies ScraperOptions);
    await pipelineManager.waitForJobCompletion(jobId).catch(() => {
      // Some cases end in failure by design; assertions read the job record.
    });
    return await pipelineManager.getJob(jobId);
  }

  it("never requests a binary-media link rejected at queue time", async () => {
    // The image is linked but never mocked. If the queue-time gate let it
    // through, the request would show up in requestedPaths via the "no match"
    // listener, so the assertion fails loudly rather than passing by accident.
    recordingScope()
      .get("/")
      .reply(200, hubPage(["/guide", "/assets/diagram.png"]), {
        "Content-Type": "text/html",
      })
      .get("/guide")
      .reply(200, leafPage("Guide"), { "Content-Type": "text/html" });

    const job = await runScrape();

    expect(job?.status).toBe(PipelineJobStatus.COMPLETED);
    expect(requestedPaths).toContain("/");
    expect(requestedPaths).toContain("/guide");
    expect(requestedPaths).not.toContain("/assets/diagram.png");

    // Rejected at queue time means it never became an item at all, so it has
    // no outcome event — distinct from a fetch-time skip, which does.
    expect(progressEvents.map((e) => e.currentUrl)).not.toContain(
      `${TEST_BASE_URL}/assets/diagram.png`,
    );
    expect(progressEvents).toHaveLength(2);
  }, 30000);

  it("aborts an extensionless URL that serves an image and stores nothing", async () => {
    // No extension, so only the served Content-Type can decide: this is the
    // fetch-time gate, and it must report the item as skipped rather than
    // storing it or failing it.
    recordingScope()
      .get("/")
      .reply(200, hubPage(["/guide", "/chart"]), { "Content-Type": "text/html" })
      .get("/guide")
      .reply(200, leafPage("Guide"), { "Content-Type": "text/html" })
      .get("/chart")
      .reply(200, Buffer.from("\x89PNG\r\n\x1a\n binary payload"), {
        "Content-Type": "image/png",
      });

    const job = await runScrape();

    expect(job?.status).toBe(PipelineJobStatus.COMPLETED);
    // The request was made — the gate can only act once headers arrive.
    expect(requestedPaths).toContain("/chart");

    const skipped = progressEvents.filter((e) => e.outcome === PageOutcome.Skipped);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].currentUrl).toBe(`${TEST_BASE_URL}/chart`);

    // No page was stored for it, and it was not recorded as a failure.
    const versionId = await docService.ensureVersion({
      library: TEST_LIBRARY,
      version: TEST_VERSION,
    });
    const pages = await docService.getPagesByVersionId(versionId);
    expect(pages.map((p) => p.url)).not.toContain(`${TEST_BASE_URL}/chart`);
    expect(pages.map((p) => p.url).sort()).toEqual(
      [`${TEST_BASE_URL}/`, `${TEST_BASE_URL}/guide`].sort(),
    );
  }, 30000);

  it("does not let an asset-heavy site trip the failure threshold", async () => {
    // The motivating scenario: many skips, no genuine failures. With skips
    // counted as failures this would abort well before the queue drained.
    const assetLinks = Array.from({ length: 12 }, (_, i) => `/asset${i}`);
    const pageLinks = ["/one", "/two"];
    const scope = recordingScope()
      .get("/")
      .reply(200, hubPage([...pageLinks, ...assetLinks]), {
        "Content-Type": "text/html",
      });
    for (const link of pageLinks) {
      scope.get(link).reply(200, leafPage(link), { "Content-Type": "text/html" });
    }
    for (const link of assetLinks) {
      // Extensionless, so each one reaches the fetch-time gate.
      scope.get(link).reply(200, Buffer.from("binary"), {
        "Content-Type": "application/octet-stream",
      });
    }

    // Default threshold aborts above 50% failures; 12 of 14 items are skips.
    appConfig.scraper.abortOnFailureRate = 0.5;

    const job = await runScrape();

    expect(job?.status).toBe(PipelineJobStatus.COMPLETED);
    expect(job?.error).toBeNull();

    const skipped = progressEvents.filter((e) => e.outcome === PageOutcome.Skipped);
    expect(skipped).toHaveLength(12);

    // Every page that could be read was read: root plus the two real pages.
    const versionId = await docService.ensureVersion({
      library: TEST_LIBRARY,
      version: TEST_VERSION,
    });
    const pages = await docService.getPagesByVersionId(versionId);
    expect(pages).toHaveLength(3);
  }, 60000);

  it("fails loudly when the requested root itself is unprocessable", async () => {
    // A skip is silent for a child page, but the URL the user actually asked
    // for must not fail silently.
    recordingScope()
      .get("/")
      .reply(200, Buffer.from("binary payload"), {
        "Content-Type": "application/octet-stream",
      });

    const job = await runScrape();

    expect(job?.status).toBe(PipelineJobStatus.FAILED);
    const message = job?.error?.message ?? job?.errorMessage ?? "";
    expect(message).toMatch(/content type/i);
    expect(message).toContain(`${TEST_BASE_URL}/`);
  }, 30000);

  it("admits a script extension the mime package resolves to application/*", async () => {
    // `.ps` resolves to application/postscript, which is not binary media, so
    // the queue-time gate must defer to the served Content-Type rather than
    // rejecting the link on its extension.
    recordingScope()
      .get("/")
      .reply(200, hubPage(["/Guess/guess.ps"]), { "Content-Type": "text/html" })
      .get("/Guess/guess.ps")
      .reply(200, "#!/bin/sh\necho hello\n", { "Content-Type": "text/plain" });

    const job = await runScrape();

    expect(job?.status).toBe(PipelineJobStatus.COMPLETED);
    // The decisive assertion: the request happened, so the extension alone did
    // not discard it.
    expect(requestedPaths).toContain("/Guess/guess.ps");

    const versionId = await docService.ensureVersion({
      library: TEST_LIBRARY,
      version: TEST_VERSION,
    });
    const pages = await docService.getPagesByVersionId(versionId);
    expect(pages.map((p) => p.url)).toContain(`${TEST_BASE_URL}/Guess/guess.ps`);
  }, 30000);
});
