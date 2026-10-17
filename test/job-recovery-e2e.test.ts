/**
 * E2E test for jobs a worker leaves unfinished when it crashes.
 *
 * Spawns a worker, starts a scrape of a slow local site, kills the worker with
 * SIGKILL mid-scrape, and starts a new worker on the same store. With job
 * recovery (the worker's default) the new worker scrapes the version again to
 * the end; with `--no-resume` it marks the version failed.
 */

import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrapeMode, type ScraperOptions } from "../src/scraper/types";
import { createApiClient } from "../src/services/apiClient";
import {
  startSlowSite,
  startWorker,
  stopChildProcess,
  withStore,
  writeTestConfig,
} from "./test-helpers";

describe("Jobs a crashed worker leaves unfinished", () => {
  let storePath: string;
  let configPath: string;
  let site: Awaited<ReturnType<typeof startSlowSite>>;
  const workers: ChildProcess[] = [];

  /** The status and error message of the crashed version, as stored. */
  function storedVersion() {
    return withStore(storePath, async (store) => {
      const [library] = await store.listLibraries();
      return library?.versions[0];
    });
  }

  /**
   * Starts a worker, has it scrape three slow pages as `crashed@1.0`, and kills
   * it with SIGKILL once the first page is stored, as a crash would.
   */
  async function crashDuringScrape(): Promise<void> {
    const worker = await startWorker(storePath, configPath);
    workers.push(worker.process);
    const { api, close } = createApiClient(worker.url, { subscriptions: false });
    try {
      const options = {
        url: site.url,
        library: "crashed",
        version: "1.0",
        scrapeMode: ScrapeMode.Fetch,
        maxConcurrency: 1,
        maxPages: 3,
        maxDepth: 10,
      } as ScraperOptions;
      const { jobId } = await api.enqueueScrapeJob.mutate({
        library: "crashed",
        version: "1.0",
        options,
      });
      await vi.waitFor(
        async () => {
          const job = await api.getJob.query({ id: jobId });
          expect(job?.status).toBe("running");
          expect(job?.progressPages ?? 0).toBeGreaterThanOrEqual(1);
        },
        { timeout: 30_000, interval: 100 },
      );
    } finally {
      close();
    }
    const exited = once(worker.process, "exit");
    worker.process.kill("SIGKILL");
    await exited;
    expect((await storedVersion())?.status).toBe("running");
  }

  beforeEach(async () => {
    storePath = mkdtempSync(path.join(tmpdir(), "job-recovery-e2e-"));
    configPath = writeTestConfig(storePath, { allowPrivateNetworks: true });
    site = await startSlowSite(300);
  });

  afterEach(async () => {
    for (const worker of workers.splice(0)) await stopChildProcess(worker);
    await site.close();
    rmSync(storePath, { recursive: true, force: true });
  });

  it("scrapes the version again to the end when the next worker recovers jobs", async () => {
    await crashDuringScrape();

    const restarted = await startWorker(storePath, configPath);
    workers.push(restarted.process);

    await vi.waitFor(async () => expect((await storedVersion())?.status).toBe("completed"), {
      timeout: 30_000,
      interval: 200,
    });
    expect((await storedVersion())?.counts.uniqueUrls).toBe(3);
  }, 90_000);

  it("marks the version failed when the next worker does not recover jobs", async () => {
    await crashDuringScrape();

    const restarted = await startWorker(storePath, configPath, ["--no-resume"]);
    workers.push(restarted.process);

    expect(await storedVersion()).toMatchObject({
      status: "failed",
      errorMessage: "Job interrupted",
    });
  }, 90_000);
});
