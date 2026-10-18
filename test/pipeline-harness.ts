/**
 * A real indexing pipeline for the crawl E2E suites.
 *
 * Each test gets a fresh `PipelineManager` and `DocumentManagementService` over
 * an in-memory store, configured so a crawl against a mock site is fast and
 * deterministic. The harness runs scrapes and refreshes to completion, records
 * the progress events they emit, and reads back what the store holds, so tests
 * assert on what a user of the server would see.
 */

import { afterEach, beforeEach } from "vitest";
import { EventBusService, EventType } from "../src/events";
import { PipelineManager } from "../src/pipeline/PipelineManager";
import { type PipelineJob, PipelineJobStatus } from "../src/pipeline/types";
import { type PageOutcome, ScrapeMode, type ScraperOptions } from "../src/scraper/types";
import { DocumentManagementService } from "../src/store/DocumentManagementService";
import {
  LibraryNotFoundInStoreError,
  VersionNotFoundInStoreError,
} from "../src/store/errors";
import type { StoreSearchResult } from "../src/store/types";
import { type AppConfig, loadConfig } from "../src/utils/config";

/** One progress event, as the job emitted it. */
export interface ProgressRecord {
  jobId: string;
  outcome: PageOutcome;
  currentUrl: string;
  pagesScraped: number;
  totalPages: number;
  totalDiscovered: number;
  pagesIndexed: number;
}

/** A stored page record. */
export interface StoredPage {
  id: number;
  url: string;
  etag: string | null;
  depth: number | null;
  content_url: string | null;
}

/** Scrape options for one run; anything left out comes from the defaults. */
export type ScrapeRequest = Partial<Omit<ScraperOptions, "library" | "version">>;

/** Options for {@link usePipelineHarness}. */
export interface PipelineHarnessOptions {
  /** The library every job indexes into. */
  library: string;
  /** The version every job indexes into. */
  version: string;
  /** Scrape options applied to every `scrape()` unless the call overrides them. */
  defaults?: ScrapeRequest;
}

/** The pipeline under test. See {@link usePipelineHarness}. */
export interface PipelineHarness {
  /** The configuration of the current test's services. Changes apply to the next job. */
  readonly config: AppConfig;
  /** The current test's pipeline manager. */
  readonly pipelineManager: PipelineManager;
  /** The current test's document service. */
  readonly docService: DocumentManagementService;
  /** Progress events of the most recently started job, in order. */
  readonly events: readonly ProgressRecord[];
  /** Starts a scrape and returns its job ID without waiting for it. */
  enqueueScrape(request?: ScrapeRequest): Promise<string>;
  /** Waits for a job to end, however it ends, and returns its final record. */
  finish(jobId: string): Promise<PipelineJob>;
  /** Runs a scrape to its end and returns the job record. Never throws for a failed job. */
  scrape(request?: ScrapeRequest): Promise<PipelineJob>;
  /** Runs a refresh of the version to its end and returns the job record. */
  refresh(): Promise<PipelineJob>;
  /** URLs of the stored pages, sorted. */
  storedUrls(): Promise<string[]>;
  /** The stored record for `url`, or undefined. */
  storedPage(url: string): Promise<StoredPage | undefined>;
  /** The stored chunks of `url`, joined; empty when the page holds no content. */
  contentOf(url: string): Promise<string>;
  /** Searches the version the way a client would. */
  search(query: string, limit?: number): Promise<StoreSearchResult[]>;
  /** The outcome the most recent job reported for `url`, if any. */
  outcomeOf(url: string): PageOutcome | undefined;
}

const FINAL_STATUSES = new Set([
  PipelineJobStatus.COMPLETED,
  PipelineJobStatus.FAILED,
  PipelineJobStatus.CANCELLED,
]);

/**
 * Builds a fresh pipeline for every test in the enclosing suite.
 *
 * Call it at describe level. Before each test it loads the configuration (the
 * test environment points `DOCS_MCP_CONFIG` at a file that never exists, so
 * this is the built-in defaults), then sets an in-memory store, no embeddings,
 * one worker, no fetch retries and Fetch mode, and allows private networks so
 * the access policy never resolves the mock hosts through DNS. After each test
 * it cancels any job still running and shuts the services down. A test that
 * needs other settings changes `config` before starting a job.
 *
 * @param options The library and version to index into, and optional defaults.
 * @returns The harness, valid inside tests and hooks.
 */
export function usePipelineHarness(options: PipelineHarnessOptions): PipelineHarness {
  const { library, version } = options;
  let current:
    | {
        config: AppConfig;
        pipelineManager: PipelineManager;
        docService: DocumentManagementService;
      }
    | undefined;
  const jobIds: string[] = [];
  const allEvents: ProgressRecord[] = [];
  /** Events of the most recently started job; filtered so no ordering can mix runs. */
  const events = (): ProgressRecord[] =>
    allEvents.filter((event) => event.jobId === jobIds[jobIds.length - 1]);

  const active = () => {
    if (!current) throw new Error("The pipeline harness is only available inside a test");
    return current;
  };

  beforeEach(async () => {
    const config = loadConfig();
    config.app.storePath = ":memory:";
    config.app.embeddingModel = "";
    config.scraper.maxConcurrency = 1;
    config.scraper.fetcher.maxRetries = 0;
    config.scraper.security.network.allowPrivateNetworks = true;

    const eventBus = new EventBusService();
    const docService = new DocumentManagementService(eventBus, config);
    await docService.initialize();
    const pipelineManager = new PipelineManager(docService, eventBus, {
      interruptedJobs: "fail",
      appConfig: config,
    });
    await pipelineManager.start();

    jobIds.length = 0;
    allEvents.length = 0;
    eventBus.on(EventType.JOB_PROGRESS, ({ job, progress }) => {
      allEvents.push({
        jobId: job.id,
        outcome: progress.outcome,
        currentUrl: progress.currentUrl,
        pagesScraped: progress.pagesScraped,
        totalPages: progress.totalPages,
        totalDiscovered: progress.totalDiscovered,
        pagesIndexed: progress.pagesIndexed,
      });
    });
    current = { config, pipelineManager, docService };
  });

  afterEach(async () => {
    const services = current;
    current = undefined;
    if (!services) return;
    try {
      for (const jobId of jobIds) {
        const job = await services.pipelineManager.getJob(jobId);
        if (job && !FINAL_STATUSES.has(job.status)) {
          await services.pipelineManager.cancelJob(jobId);
          await services.pipelineManager.waitForJobCompletion(jobId).catch(() => {});
        }
      }
    } finally {
      await services.pipelineManager.stop();
      await services.docService.shutdown();
    }
  });

  const harness: PipelineHarness = {
    get config() {
      return active().config;
    },
    get pipelineManager() {
      return active().pipelineManager;
    },
    get docService() {
      return active().docService;
    },
    get events() {
      return events();
    },
    async enqueueScrape(request = {}) {
      const scrapeOptions = {
        url: "",
        maxPages: 100,
        maxDepth: 3,
        scrapeMode: ScrapeMode.Fetch,
        ...options.defaults,
        ...request,
        library,
        version,
      } satisfies ScraperOptions;
      return track(
        await active().pipelineManager.enqueueScrapeJob(library, version, scrapeOptions),
      );
    },
    async finish(jobId) {
      const { pipelineManager } = active();
      await pipelineManager.waitForJobCompletion(jobId).catch(() => {
        // A failed job rejects; its record is what tests assert on.
      });
      const job = await pipelineManager.getJob(jobId);
      if (!job) throw new Error(`Job ${jobId} vanished after it ended`);
      return job;
    },
    async scrape(request) {
      return harness.finish(await harness.enqueueScrape(request));
    },
    async refresh() {
      const jobId = track(
        await active().pipelineManager.enqueueRefreshJob(library, version),
      );
      return harness.finish(jobId);
    },
    async storedUrls() {
      return (await pages()).map((page) => page.url).sort();
    },
    async storedPage(url) {
      return (await pages()).find((page) => page.url === url);
    },
    async contentOf(url) {
      const { chunks } = await active().docService.listVersionChunks(
        { library, version },
        { limit: 10_000 },
      );
      return chunks
        .filter((chunk) => chunk.url === url)
        .map((chunk) => chunk.content)
        .join("\n");
    },
    async search(query, limit = 10) {
      return active().docService.searchStore(library, version, query, limit);
    },
    outcomeOf(url) {
      return events()
        .reverse()
        .find((event) => event.currentUrl === url)?.outcome;
    },
  };

  /** Records a job so teardown can cancel it and `events` can follow it. */
  function track(jobId: string): string {
    jobIds.push(jobId);
    return jobId;
  }

  /**
   * Reads the stored pages without creating the version, which would make the
   * next scrape of it an overwrite the store refuses.
   */
  async function pages(): Promise<StoredPage[]> {
    const { docService } = active();
    try {
      const { versionId } = await docService.requireVersion({ library, version });
      return docService.getPagesByVersionId(versionId);
    } catch (error) {
      if (
        error instanceof LibraryNotFoundInStoreError ||
        error instanceof VersionNotFoundInStoreError
      ) {
        return [];
      }
      throw error;
    }
  }

  return harness;
}
