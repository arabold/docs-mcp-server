/**
 * E2E test for jobs a process leaves unfinished when it crashes, and for jobs
 * another live process still runs.
 *
 * Spawns a worker, starts a scrape of a slow local site, kills the worker with
 * SIGKILL mid-scrape, and starts a new server on the same store. With job
 * recovery (the worker's default) the new worker scrapes the version again to
 * the end; with `--no-resume`, or as `web`, it marks the version failed. A
 * local `scrape` that runs on the store in between leaves the crashed job to
 * the next worker. A `web` started beside a worker that is still scraping
 * leaves that job running.
 *
 * Every process marks its running jobs alive every 200 ms, so a server finds a
 * crashed job about two seconds after the crash.
 */

import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrapeMode, type ScraperOptions } from "../src/scraper/types";
import { createApiClient } from "../src/services/apiClient";
import {
  getFreePort,
  HTML_FIXTURE_URL,
  runCli,
  startCliServer,
  startSlowSite,
  startWorker,
  stopChildProcess,
  withStore,
  writeTestConfig,
} from "./test-helpers";

const JOB_HEARTBEAT_MS = 200;
/** How long a server waits before it treats a recently written job as crashed. */
const INTERRUPTED_AFTER_MS = 4 * JOB_HEARTBEAT_MS + 1000;

/**
 * Starts `web` on a store without a worker URL, so it runs its own pipeline
 * and handles the jobs it finds interrupted.
 */
async function startWeb(storePath: string, configPath: string): Promise<ChildProcess> {
  const web = await startCliServer(
    [
      "web",
      "--host",
      "127.0.0.1",
      "--port",
      String(await getFreePort()),
      "--store-path",
      storePath,
      "--config",
      configPath,
    ],
    { LOG_LEVEL: "info" },
  );
  return web.process;
}

describe("Jobs a crashed worker leaves unfinished", () => {
  let storePath: string;
  let configPath: string;
  let site: Awaited<ReturnType<typeof startSlowSite>>;
  const workers: ChildProcess[] = [];

  /** The status and error message of a library's version, as stored. */
  function storedVersion(library = "crashed") {
    return withStore(storePath, async (store) => {
      const libraries = await store.listLibraries();
      return libraries.find((entry) => entry.library === library)?.versions[0];
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
    configPath = writeTestConfig(storePath, {
      allowPrivateNetworks: true,
      jobHeartbeatMs: JOB_HEARTBEAT_MS,
    });
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

  it("leaves the crashed job to the next worker when a local scrape runs first", async () => {
    await crashDuringScrape();

    const scraped = await runCli(
      [
        "scrape",
        "other",
        HTML_FIXTURE_URL,
        "--store-path",
        storePath,
        "--config",
        configPath,
        "--scrape-mode",
        "fetch",
      ],
      40_000,
    );
    expect(scraped.code, scraped.stderr).toBe(0);
    expect((await storedVersion())?.status).toBe("running");

    const restarted = await startWorker(storePath, configPath);
    workers.push(restarted.process);
    await vi.waitFor(async () => expect((await storedVersion())?.status).toBe("completed"), {
      timeout: 30_000,
      interval: 200,
    });
  }, 90_000);

  it("marks the version failed when the next worker does not recover jobs", async () => {
    await crashDuringScrape();

    const restarted = await startWorker(storePath, configPath, ["--no-resume"]);
    workers.push(restarted.process);

    await vi.waitFor(
      async () =>
        expect(await storedVersion()).toMatchObject({
          status: "failed",
          errorMessage: "Job interrupted",
        }),
      { timeout: 30_000, interval: 200 },
    );
  }, 90_000);

  it("marks the version failed when web starts on the store", async () => {
    await crashDuringScrape();

    workers.push(await startWeb(storePath, configPath));

    await vi.waitFor(
      async () =>
        expect(await storedVersion()).toMatchObject({
          status: "failed",
          errorMessage: "Job interrupted",
        }),
      { timeout: 30_000, interval: 200 },
    );
  }, 90_000);
});

describe("Jobs another live process runs", () => {
  let storePath: string;
  let site: Awaited<ReturnType<typeof startSlowSite>>;
  const processes: ChildProcess[] = [];

  beforeEach(async () => {
    storePath = mkdtempSync(path.join(tmpdir(), "job-recovery-e2e-live-"));
    // Pages slower than the time a server waits, so only the worker's
    // heartbeat, not its page writes, keeps the version alive meanwhile
    site = await startSlowSite(INTERRUPTED_AFTER_MS + 700);
  });

  afterEach(async () => {
    for (const child of processes.splice(0)) await stopChildProcess(child);
    await site.close();
    rmSync(storePath, { recursive: true, force: true });
  });

  it("leaves the worker's job running when web starts on the store", async () => {
    const configPath = writeTestConfig(storePath, {
      allowPrivateNetworks: true,
      jobHeartbeatMs: JOB_HEARTBEAT_MS,
    });
    const worker = await startWorker(storePath, configPath);
    processes.push(worker.process);
    const { api, close } = createApiClient(worker.url, { subscriptions: false });
    try {
      const options = {
        url: site.url,
        library: "busy",
        version: "1.0",
        scrapeMode: ScrapeMode.Fetch,
        maxConcurrency: 1,
        maxPages: 3,
        maxDepth: 10,
      } as ScraperOptions;
      const { jobId } = await api.enqueueScrapeJob.mutate({
        library: "busy",
        version: "1.0",
        options,
      });
      await vi.waitFor(
        async () => expect((await api.getJob.query({ id: jobId }))?.status).toBe("running"),
        { timeout: 30_000, interval: 100 },
      );

      processes.push(await startWeb(storePath, configPath));
      // Past the time web waits before it decides on the running version
      await sleep(INTERRUPTED_AFTER_MS + 1000);
      const versionMeanwhile = await withStore(storePath, async (store) =>
        (await store.listLibraries()).find((entry) => entry.library === "busy"),
      );
      expect(versionMeanwhile?.versions[0]?.status).toBe("running");

      await vi.waitFor(
        async () => expect((await api.getJob.query({ id: jobId }))?.status).toBe("completed"),
        { timeout: 30_000, interval: 200 },
      );
    } finally {
      close();
    }
  }, 90_000);
});
