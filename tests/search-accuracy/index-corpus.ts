/**
 * Indexes the benchmark corpus through the real scraping pipeline.
 */

import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { EventBusService } from "../../src/events";
import { PipelineManager } from "../../src/pipeline/PipelineManager";
import { PipelineJobStatus } from "../../src/pipeline/types";
import { ScrapeMode } from "../../src/scraper/types";
import { DocumentManagementService } from "../../src/store/DocumentManagementService";
import type { AppConfig } from "../../src/utils/config";
import type { CorpusCheckout } from "./corpus";

/** Upper bounds that keep every file of a checkout in scope. */
const SCRAPE_LIMITS = { maxPages: 5000, maxDepth: 20 } as const;

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
  const result = structuredClone(config);
  result.app.storePath = storeDir;
  result.scraper.security.fileAccess.mode = "allowedRoots";
  result.scraper.security.fileAccess.allowedRoots = [corpusDir];
  return result;
}

/**
 * Indexes every checkout as one library into a fresh store.
 *
 * @param checkouts The corpus checkouts.
 * @param config A configuration from {@link benchmarkConfig}.
 * @returns Path of the store's database file.
 * @throws Error naming the library when its scrape job does not complete.
 */
export async function indexCorpus(
  checkouts: CorpusCheckout[],
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
    const jobs = await Promise.all(
      checkouts.map(async (checkout) => ({
        library: checkout.source.library,
        jobId: await pipelineManager.enqueueScrapeJob(checkout.source.library, "", {
          url: pathToFileURL(checkout.directory).href,
          library: checkout.source.library,
          version: "",
          scrapeMode: ScrapeMode.Fetch,
          ...SCRAPE_LIMITS,
        }),
      })),
    );
    for (const { library, jobId } of jobs) {
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
  return path.join(storeDir, "documents.db");
}
