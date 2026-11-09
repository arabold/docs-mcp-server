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
import { interruptedAfterMs } from "../src/pipeline/PipelineManager";
import { createApiClient } from "../src/services/apiClient";
import {
  HTML_FIXTURE_URL,
  runCli,
  startRunningSlowJob,
  startSlowSite,
  startWeb,
  startWorker,
  stopChildProcess,
  withStore,
  writeTestConfig,
} from "./test-helpers";

const JOB_HEARTBEAT_MS = 200;

/** The status and error message of a library's only version, as stored. */
function storedVersion(storePath: string, library: string) {
  return withStore(storePath, async (store) => {
    const libraries = await store.listLibraries();
    return libraries.find((entry) => entry.library === library)?.versions[0];
  });
}

describe("Interrupted jobs on a shared store", () => {
  let storePath: string;
  let configPath: string;
  let site: Awaited<ReturnType<typeof startSlowSite>>;
  const processes: ChildProcess[] = [];

  const crashedVersion = () => storedVersion(storePath, "crashed");

  /**
   * Starts a worker, has it scrape three slow pages as `crashed@1.0`, and kills
   * it with SIGKILL once the first page is stored, as a crash would.
   */
  async function crashDuringScrape(): Promise<void> {
    const worker = await startWorker(storePath, configPath);
    processes.push(worker.process);
    const { api, close } = createApiClient(worker.url, { subscriptions: false });
    try {
      const jobId = await startRunningSlowJob(api, site.url, "crashed", "1.0", 3);
      await vi.waitFor(
        async () => {
          const job = await api.getJob.query({ id: jobId });
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
    expect((await crashedVersion())?.status).toBe("running");
  }

  /** Waits until the next server has marked the crashed version failed. */
  async function expectCrashedVersionFailed(): Promise<void> {
    await vi.waitFor(
      async () =>
        expect(await crashedVersion()).toMatchObject({
          status: "failed",
          errorMessage: "Job interrupted",
        }),
      { timeout: 30_000, interval: 200 },
    );
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
    for (const child of processes.splice(0)) await stopChildProcess(child);
    await site.close();
    rmSync(storePath, { recursive: true, force: true });
  });

  it("scrapes the version again to the end when the next worker recovers jobs", async () => {
    await crashDuringScrape();

    const restarted = await startWorker(storePath, configPath);
    processes.push(restarted.process);

    await vi.waitFor(async () => expect((await crashedVersion())?.status).toBe("completed"), {
      timeout: 30_000,
      interval: 200,
    });
    expect((await crashedVersion())?.counts.uniqueUrls).toBe(3);
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
    expect((await crashedVersion())?.status).toBe("running");

    const restarted = await startWorker(storePath, configPath);
    processes.push(restarted.process);
    await vi.waitFor(async () => expect((await crashedVersion())?.status).toBe("completed"), {
      timeout: 30_000,
      interval: 200,
    });
  }, 90_000);

  it("marks the version failed when the next worker does not recover jobs", async () => {
    await crashDuringScrape();

    const restarted = await startWorker(storePath, configPath, ["--no-resume"]);
    processes.push(restarted.process);

    await expectCrashedVersionFailed();
  }, 90_000);

  it("marks the version failed when web starts on the store", async () => {
    await crashDuringScrape();

    processes.push((await startWeb(storePath, configPath)).process);

    await expectCrashedVersionFailed();
  }, 90_000);

  it("leaves the job of a live worker running when web starts on the store", async () => {
    // The first page never arrives within the test, so the job writes nothing
    // after it starts and only its heartbeat shows that it is alive
    const hangingSite = await startSlowSite(120_000);
    const worker = await startWorker(storePath, configPath);
    processes.push(worker.process);
    const { api, close } = createApiClient(worker.url, { subscriptions: false });
    try {
      const jobId = await startRunningSlowJob(api, hangingSite.url, "busy", "1.0");

      processes.push((await startWeb(storePath, configPath)).process);
      // Past the bound after which web decides on the version it found running
      await sleep(interruptedAfterMs(JOB_HEARTBEAT_MS) + 1000);

      expect((await storedVersion(storePath, "busy"))?.status).toBe("running");
      expect((await api.getJob.query({ id: jobId }))?.status).toBe("running");
    } finally {
      close();
      await hangingSite.close();
    }
  }, 90_000);
});
