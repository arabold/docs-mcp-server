/**
 * Indexes the benchmark corpus through the real scraping pipeline.
 */

import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { EventBusService } from "../../src/events";
import { PipelineManager } from "../../src/pipeline/PipelineManager";
import { PipelineJobStatus } from "../../src/pipeline/types";
import { ScrapeMode } from "../../src/scraper/types";
import { DocumentManagementService } from "../../src/store/DocumentManagementService";
import {
  type AppConfig,
  isVectorDimensionExplicit,
  markVectorDimensionSource,
} from "../../src/utils/config";
import type { CorpusCheckout } from "./corpus";
import { STABLE_CORPUS_URL } from "./paths";

/** Upper bounds that keep every file of a checkout in scope. */
const SCRAPE_LIMITS = { maxPages: 5000, maxDepth: 20 } as const;

/**
 * Copies a configuration, keeping whether its vector dimension was set
 * explicitly (a marker `structuredClone` would drop).
 *
 * @param config The configuration to copy; not modified.
 */
export function cloneConfig(config: AppConfig): AppConfig {
  return markVectorDimensionSource(
    structuredClone(config),
    isVectorDimensionExplicit(config),
  );
}

/**
 * The configuration the benchmark indexes and searches with: the given one,
 * with the store in `storeDir` and local file access limited to the corpus.
 *
 * @param config The run's configuration; not modified.
 * @param storeDir Directory of the benchmark's store.
 * @param corpusDir Directory holding the corpus checkouts.
 */
export function benchmarkConfig(
  config: AppConfig,
  storeDir: string,
  corpusDir: string,
): AppConfig {
  const result = cloneConfig(config);
  result.app.storePath = storeDir;
  result.scraper.security.fileAccess.mode = "allowedRoots";
  result.scraper.security.fileAccess.allowedRoots = [corpusDir];
  // One page at a time, so chunks get the same row ids on every run. Search
  // breaks score ties by row order, so concurrent indexing would let timing
  // (a slow embedding request, say) change the ranking.
  result.scraper.maxConcurrency = 1;
  return result;
}

/**
 * Indexes every checkout as one library into a fresh store, one library and
 * one page at a time, so a run's row ids and therefore its tie-breaking never
 * depend on timing.
 *
 * Page URLs are then moved under {@link STABLE_CORPUS_URL}, in the store and
 * in its full-text index, so search results do not depend on where the cache
 * lives. Embedding inputs get the same rewrite from the embedding cache.
 *
 * @param checkouts The corpus checkouts.
 * @param corpusDir Directory holding the checkouts.
 * @param config A configuration from {@link benchmarkConfig}.
 * @returns Path of the store's database file.
 * @throws Error naming the library when its scrape job does not complete.
 */
export async function indexCorpus(
  checkouts: CorpusCheckout[],
  corpusDir: string,
  config: AppConfig,
): Promise<string> {
  const storeDir = config.app.storePath;
  rmSync(storeDir, { recursive: true, force: true });
  mkdirSync(storeDir, { recursive: true });

  const eventBus = new EventBusService();
  const docService = new DocumentManagementService(eventBus, config);
  await docService.initialize();
  const pipelineManager = new PipelineManager(docService, eventBus, {
    interruptedJobs: "fail",
    appConfig: config,
  });
  await pipelineManager.start();
  try {
    for (const checkout of checkouts) {
      const library = checkout.source.library;
      const jobId = await pipelineManager.enqueueScrapeJob(library, "", {
        url: pathToFileURL(checkout.directory).href,
        library,
        version: "",
        scrapeMode: ScrapeMode.Fetch,
        ...SCRAPE_LIMITS,
      });
      await pipelineManager.waitForJobCompletion(jobId).catch(() => {});
      const job = await pipelineManager.getJob(jobId);
      if (job?.status !== PipelineJobStatus.COMPLETED) {
        throw new Error(
          `Indexing "${library}" ended as ${job?.status ?? "unknown"}: ${job?.error?.message ?? "no error recorded"}`,
        );
      }
    }
  } finally {
    await pipelineManager.stop();
    await docService.shutdown();
  }
  const dbPath = path.join(storeDir, "documents.db");
  relocateCorpusUrls(dbPath, corpusDir);
  return dbPath;
}

/** Rewrites page URLs under the corpus directory to {@link STABLE_CORPUS_URL}. */
function relocateCorpusUrls(dbPath: string, corpusDir: string): void {
  const actual = pathToFileURL(corpusDir).href;
  const db = new Database(dbPath);
  sqliteVec.load(db);
  try {
    const args = [STABLE_CORPUS_URL, actual.length + 1, actual.length, actual] as const;
    db.transaction(() => {
      for (const table of ["pages", "documents_fts"]) {
        db.prepare(
          `UPDATE ${table} SET url = ? || substr(url, ?) WHERE substr(url, 1, ?) = ?`,
        ).run(...args);
      }
    })();
  } finally {
    db.close();
  }
}
