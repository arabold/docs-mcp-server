/**
 * E2E test for a web server that hands its jobs to a remote worker.
 *
 * Spawns a worker and a `web --server-url` coordinator that reaches it through
 * a TCP proxy, so the test can drop and restore the connection while the
 * worker keeps running. Checks what the coordinator's users see: the health
 * report while the connection is up, down and back, that views are told to
 * refetch once it returns and live job updates flow again, and that removing a
 * version cancels the worker's job.
 */

import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EventType } from "../src/events";
import type { PipelineJob } from "../src/pipeline/types";
import { ScrapeMode } from "../src/scraper/types";
import { createApiClient } from "../src/services/apiClient";
import {
  createTcpProxy,
  getFreePort,
  HTML_FIXTURE_URL,
  startCliServer,
  startRunningSlowJob,
  startSlowSite,
  startWorker,
  stopChildProcess,
  writeTestConfig,
} from "./test-helpers";

describe("Web server in front of a remote worker", () => {
  const fixtureUrl = HTML_FIXTURE_URL;
  let storePath: string;
  let worker: ChildProcess | undefined;
  let coordinator: ChildProcess | undefined;
  let proxy: ReturnType<typeof createTcpProxy>;
  let proxyPort: number;
  let workerApiUrl: string;
  let coordinatorApiUrl: string;

  beforeAll(async () => {
    storePath = mkdtempSync(path.join(tmpdir(), "remote-worker-e2e-"));
    const configPath = writeTestConfig(storePath, { allowPrivateNetworks: true });

    const startedWorker = await startWorker(storePath, configPath);
    worker = startedWorker.process;
    workerApiUrl = startedWorker.url;

    proxy = createTcpProxy(Number(new URL(workerApiUrl).port));
    proxyPort = await proxy.listen();

    const startedCoordinator = await startCliServer(
      [
        "web",
        "--host",
        "127.0.0.1",
        "--port",
        String(await getFreePort()),
        "--server-url",
        `http://127.0.0.1:${proxyPort}/api`,
        "--config",
        configPath,
      ],
      { LOG_LEVEL: "info" },
    );
    coordinator = startedCoordinator.process;
    coordinatorApiUrl = `${startedCoordinator.url}/api`;
  }, 90_000);

  afterAll(async () => {
    await stopChildProcess(coordinator);
    await proxy?.cut();
    await stopChildProcess(worker);
    rmSync(storePath, { recursive: true, force: true });
  });

  it("reports the worker connection truthfully and catches up after it returns", async () => {
    const coordinatorClient = createApiClient(coordinatorApiUrl, { subscriptions: true });
    const workerClient = createApiClient(workerApiUrl, { subscriptions: false });
    const expectConnected = async (connected: boolean) =>
      expect((await coordinatorClient.api.getSystemHealth.query()).worker).toMatchObject({
        mode: "remote",
        connected,
      });
    const scrapeOnWorker = async (library: string) => {
      const { jobId } = await workerClient.api.enqueueScrapeJob.mutate({
        library,
        version: null,
        options: { url: fixtureUrl, library, version: "", scrapeMode: ScrapeMode.Fetch },
      });
      return jobId;
    };

    const listChanges: number[] = [];
    const statusChanges: PipelineJob[] = [];
    const subscription = coordinatorClient.api.events.subscribe.subscribe(
      { events: [EventType.JOB_LIST_CHANGE, EventType.JOB_STATUS_CHANGE] },
      {
        onData: (event) => {
          if (event.type === EventType.JOB_LIST_CHANGE) listChanges.push(Date.now());
          if (event.type === EventType.JOB_STATUS_CHANGE) {
            statusChanges.push(event.payload as PipelineJob);
          }
        },
      },
    );

    try {
      await vi.waitFor(() => expectConnected(true), { timeout: 30_000, interval: 200 });

      await proxy.cut();
      await vi.waitFor(() => expectConnected(false), { timeout: 30_000, interval: 200 });

      // A job runs to the end on the worker while the coordinator cannot hear it
      const missedJobId = await scrapeOnWorker("outage");
      await vi.waitFor(
        async () =>
          expect((await workerClient.api.getJob.query({ id: missedJobId }))?.status).toBe(
            "completed",
          ),
        { timeout: 30_000, interval: 200 },
      );

      const restoredAt = Date.now();
      await proxy.listen(proxyPort);
      await vi.waitFor(() => expectConnected(true), { timeout: 60_000, interval: 200 });
      await vi.waitFor(() => expect(listChanges.some((at) => at >= restoredAt)).toBe(true), {
        timeout: 10_000,
        interval: 200,
      });

      // Live updates reach the coordinator's views again
      const laterJobId = await scrapeOnWorker("after-outage");
      await vi.waitFor(
        () =>
          expect(statusChanges).toContainEqual(
            expect.objectContaining({ id: laterJobId, status: "completed" }),
          ),
        { timeout: 30_000, interval: 200 },
      );
    } finally {
      subscription.unsubscribe();
      coordinatorClient.close();
      workerClient.close();
      // The next test reaches the worker through the proxy too
      await proxy.listen(proxyPort);
    }
    // The tRPC client backs off up to several seconds between reconnects; CI runs slower
  }, 150_000);

  it("cancels the worker's job when the web UI removes its version", async () => {
    const site = await startSlowSite();
    const coordinatorClient = createApiClient(coordinatorApiUrl, { subscriptions: false });
    const workerClient = createApiClient(workerApiUrl, { subscriptions: false });
    try {
      const jobId = await startRunningSlowJob(workerClient.api, site.url, "webremove", "1.0");

      await coordinatorClient.api.removeDocs.mutate({ library: "webremove", version: "1.0" });

      expect((await workerClient.api.getJob.query({ id: jobId }))?.status).toBe("cancelled");
      const libraries = await coordinatorClient.api.listLibraries.query();
      expect(libraries.map((l) => l.library)).not.toContain("webremove");
    } finally {
      coordinatorClient.close();
      workerClient.close();
      await site.close();
    }
  }, 90_000);
});
