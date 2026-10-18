import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventBusService } from "../src/events";
import { ScrapeMode } from "../src/scraper/types";
import { createApiClient } from "../src/services/apiClient";
import { openBackend } from "../src/services/backend";
import { VersionStatus } from "../src/store/types";
import { loadConfig } from "../src/utils/config";
import {
  createTcpProxy,
  getFreePort,
  HTML_FIXTURE_URL,
  runCli,
  startRunningSlowJob,
  startSlowSite,
  startWorker,
  stopChildProcess,
  withStore,
  writeTestConfig,
} from "./test-helpers";

describe("CLI E2E", () => {
  const projectRoot = path.resolve(import.meta.dirname, "..");
  const fixtureUrl = HTML_FIXTURE_URL;

  /** The status and progress lines a scrape or refresh printed. */
  function progressLines(output: string): string[] {
    return output.split("\n").filter((line) => /[🚀📄] (Scraping|Refreshing) /u.test(line));
  }

  it("should show help with --help", async () => {
    const { code, stdout } = await runCli(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Usage: docs-mcp-server <command> [options]");
    expect(stdout).toContain("Commands:");
    expect(stdout).toContain("list");
  });

  it("should show version with --version", async () => {
    const { code, stdout } = await runCli(["--version"]);
    expect(code).toBe(0);
    // Version is typically printed to stdout
    expect(stdout).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("should fail on unknown command", async () => {
    const { code, stderr } = await runCli(["unknown-command"]);
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown argument: unknown-command");
  });

  it("should fail on unknown argument", async () => {
    const { code, stderr } = await runCli(["list", "--unknown-flag"]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/Unknown argument/i);
    expect(stderr).toContain("unknown-flag");
  });

  it("reports a failing command without the help or a stack trace", async () => {
    const storePath = mkdtempSync(path.join(tmpdir(), "cli-e2e-failure-"));
    const configPath = writeTestConfig(storePath);

    try {
      const { code, stderr } = await runCli([
        "remove",
        "nolib",
        "--store-path",
        storePath,
        "--config",
        configPath,
      ]);

      expect(code).toBe(1);
      expect(stderr).toContain("❌ Failed to remove nolib: Library nolib not found in store.");
      expect(stderr).not.toContain("Options:");
      expect(stderr).not.toMatch(/^\s+at /m);
    } finally {
      rmSync(storePath, { recursive: true, force: true });
    }
  });

  it("shows the stack of a startup configuration error with --verbose", async () => {
    const storePath = mkdtempSync(path.join(tmpdir(), "cli-e2e-verbose-"));
    const configPath = path.join(storePath, "config.yaml");
    writeFileSync(configPath, 'server:\n  publicUrl: "https://example.com/docs//"\n');

    try {
      const { code, stderr } = await runCli([
        "list",
        "--verbose",
        "--store-path",
        storePath,
        "--config",
        configPath,
      ]);

      expect(code).toBe(1);
      expect(stderr).toContain("❌ Invalid configuration for server.publicUrl");
      expect(stderr).toMatch(/^\s+at loadConfig /m);
    } finally {
      rmSync(storePath, { recursive: true, force: true });
    }
  });

  it("exits with 1 when a command reports its own failure", async () => {
    const storePath = mkdtempSync(path.join(tmpdir(), "cli-e2e-exit-code-"));
    const configPath = writeTestConfig(storePath);

    try {
      const { code, stderr } = await runCli([
        "config",
        "get",
        "no.such.key",
        "--store-path",
        storePath,
        "--config",
        configPath,
      ]);

      expect(stderr).toContain("Invalid config path 'no.such.key'");
      expect(code).toBe(1);
    } finally {
      rmSync(storePath, { recursive: true, force: true });
    }
  });

  it("refuses to scrape an existing version unless --replace is given", async () => {
    const storePath = mkdtempSync(path.join(tmpdir(), "cli-e2e-replace-"));
    const configPath = writeTestConfig(storePath);
    const scrapeArgs = [
      "scrape",
      "React",
      fixtureUrl,
      "--store-path",
      storePath,
      "--config",
      configPath,
    ];

    try {
      // Seed the existing version in-process rather than with a third CLI run.
      await withStore(storePath, (store) => store.ensureVersion({ library: "React", version: "" }), {
        configPath,
      });

      const rejected = await runCli(scrapeArgs);
      expect(rejected.code).not.toBe(0);
      expect(`${rejected.stdout}${rejected.stderr}`).toContain("--replace");

      const replaced = await runCli([...scrapeArgs, "--replace"]);
      expect(replaced.code).toBe(0);
    } finally {
      rmSync(storePath, { recursive: true, force: true });
    }
    // Two CLI processes; generous for CI runners, which are several times slower
  }, 60000);

  it("leaves the jobs of another process alone when it scrapes and refreshes locally", async () => {
    const storePath = mkdtempSync(path.join(tmpdir(), "cli-e2e-leave-"));
    const configPath = writeTestConfig(storePath);
    const statusOfBusy = () =>
      withStore(storePath, async (store) => {
        const busy = (await store.listLibraries()).find((lib) => lib.library === "Busy");
        return busy?.versions[0]?.status;
      });
    const local = ["--store-path", storePath, "--config", configPath];

    try {
      // Another process (a server) is scraping Busy 1.0 in this store
      await withStore(storePath, async (store) => {
        const versionId = await store.ensureVersion({ library: "Busy", version: "1.0" });
        await store.updateVersionStatus(versionId, VersionStatus.RUNNING);
      });

      const scraped = await runCli(
        ["scrape", "Mine", fixtureUrl, ...local, "--scrape-mode", "fetch"],
        40_000,
      );
      expect(scraped.code, scraped.stderr).toBe(0);
      expect(await statusOfBusy()).toBe(VersionStatus.RUNNING);

      const refreshed = await runCli(["refresh", "Mine", ...local], 40_000);
      expect(refreshed.code, refreshed.stderr).toBe(0);
      expect(await statusOfBusy()).toBe(VersionStatus.RUNNING);
    } finally {
      rmSync(storePath, { recursive: true, force: true });
    }
    // Two CLI processes; generous for CI runners, which are several times slower
  }, 60_000);

  it("fails with the URL to check when no worker answers", async () => {
    const deadUrl = `http://127.0.0.1:${await getFreePort()}/api`;

    const result = await runCli(["list", "--server-url", deadUrl], 40_000);

    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      `Failed to connect to server at ${deadUrl}`,
    );
  }, 60_000);

  describe("against a worker", () => {
    let storePath: string;
    let configPath: string;
    let worker: ChildProcess | undefined;
    let workerUrl: string;

    beforeAll(async () => {
      storePath = mkdtempSync(path.join(tmpdir(), "cli-e2e-worker-"));
      // Room for a client's job next to another client's endless one
      configPath = writeTestConfig(storePath, { allowPrivateNetworks: true, maxConcurrency: 3 });
      const started = await startWorker(storePath, configPath);
      worker = started.process;
      workerUrl = started.url;
    }, 60_000);

    afterAll(async () => {
      await stopChildProcess(worker);
      rmSync(storePath, { recursive: true, force: true });
    });

    /** Where a command runs: on the worker at `serverUrl`, or locally on `storePath`. */
    type Target = { serverUrl: string } | { storePath: string };

    function backendArgs(target: Target): string[] {
      return "serverUrl" in target
        ? ["--server-url", target.serverUrl, "--config", configPath]
        : ["--store-path", target.storePath, "--config", configPath];
    }

    /** Scrapes `url` as `library` on `target`, showing diagnostics. */
    function scrape(library: string, target: Target = { serverUrl: workerUrl }, url = fixtureUrl) {
      // --verbose: without a terminal the CLI shows errors only. Fetch mode
      // starts no browser for the fixture. The cap turns a client that never
      // returns into a failed assertion instead of a test timeout that leaves
      // the CLI process behind.
      return runCli(
        ["scrape", library, url, ...backendArgs(target), "--scrape-mode", "fetch", "--verbose"],
        40_000,
      );
    }

    it("prints the same progress for a remote scrape as for a local one", async () => {
      const localStore = mkdtempSync(path.join(tmpdir(), "cli-e2e-local-"));
      try {
        const [remote, local] = await Promise.all([
          scrape("React"),
          scrape("React", { storePath: localStore }),
        ]);

        for (const result of [remote, local]) {
          expect(result.code, `${result.stdout}${result.stderr}`).toBe(0);
          expect(result.stdout).toContain("Successfully scraped 1 pages");
        }
        expect(progressLines(`${remote.stdout}${remote.stderr}`)).toEqual([
          "🚀 Scraping React...",
          "📄 Scraping React: 1/1 pages",
        ]);
        expect(progressLines(`${remote.stdout}${remote.stderr}`)).toEqual(
          progressLines(`${local.stdout}${local.stderr}`),
        );
      } finally {
        rmSync(localStore, { recursive: true, force: true });
      }
    }, 60_000);

    it("fails a remote scrape with the reason the worker reports", async () => {
      const missingUrl = `file://${path.join(projectRoot, "test", "fixtures", "missing.html")}`;

      const result = await scrape("Missing", { serverUrl: workerUrl }, missingUrl);

      expect(result.code).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(`Root page not found: ${missingUrl}`);
    }, 60_000);

    it("removes a version a worker is scraping, cancelling the job first", async () => {
      const site = await startSlowSite();
      const { api, close } = createApiClient(workerUrl, { subscriptions: false });
      try {
        const jobId = await startRunningSlowJob(api, site.url, "slow", "1.0");

        const result = await runCli(
          ["remove", "slow", "--version", "1.0", "--server-url", workerUrl, "--config", configPath],
          40_000,
        );

        expect(result.code, `${result.stdout}${result.stderr}`).toBe(0);
        expect((await api.getJob.query({ id: jobId }))?.status).toBe("cancelled");
        const libraries = await api.listLibraries.query();
        expect(libraries.map((l) => l.library)).not.toContain("slow");
      } finally {
        close();
        await site.close();
      }
    }, 60_000);

    it("finishes a remote scrape when the worker's live updates are blocked", async () => {
      const proxy = createTcpProxy(Number(new URL(workerUrl).port), { blockUpgrades: true });
      try {
        const port = await proxy.listen();

        const result = await scrape("Blocked", { serverUrl: `http://127.0.0.1:${port}/api` });

        const output = `${result.stdout}${result.stderr}`;
        expect(result.code, output).toBe(0);
        expect(result.stdout).toContain("Successfully scraped 1 pages");
        expect(output.split("Live job updates from the worker are unavailable")).toHaveLength(2);
        expect(progressLines(output)).toEqual([]);
      } finally {
        await proxy.cut();
      }
    }, 60_000);

    it("shows only its own job while the worker runs another client's", async () => {
      // Fast enough that the other job reports while this client's job runs
      const site = await startSlowSite(50);
      const { api, close } = createApiClient(workerUrl, { subscriptions: false });
      let otherJobId: string | undefined;
      const pagesOfOther = async () =>
        (await api.getJob.query({ id: otherJobId ?? "" }))?.progressPages ?? 0;
      try {
        otherJobId = await startRunningSlowJob(api, site.url, "Other", null);
        const pagesBefore = await pagesOfOther();

        const result = await scrape("Mine");

        const output = `${result.stdout}${result.stderr}`;
        expect(result.code, output).toBe(0);
        // The other job reported progress all through this client's run
        expect(await pagesOfOther()).toBeGreaterThan(pagesBefore);
        expect((await api.getJob.query({ id: otherJobId }))?.status).toBe("running");
        expect(progressLines(output)).toEqual([
          "🚀 Scraping Mine...",
          "📄 Scraping Mine: 1/1 pages",
        ]);
      } finally {
        if (otherJobId) await api.cancelJob.mutate({ id: otherJobId });
        close();
        await site.close();
      }
    }, 60_000);

    describe("the same remotely as locally", () => {
      let localStore: string;

      /**
       * Runs a command against the worker and, at the same time, locally on
       * `localStorePath`.
       */
      function runBoth(args: string[], localStorePath: string) {
        return Promise.all([
          runCli([...args, ...backendArgs({ serverUrl: workerUrl })], 40_000),
          runCli([...args, ...backendArgs({ storePath: localStorePath })], 40_000),
        ]);
      }

      /** Scrapes the fixture as `library@version`, on the worker or into a local store. */
      async function seed(target: Target, library: string, version: string): Promise<void> {
        const appConfig = loadConfig({}, { configPath });
        if ("storePath" in target) appConfig.app.storePath = target.storePath;
        const backend = await openBackend({
          appConfig,
          eventBus: new EventBusService(),
          serverUrl: "serverUrl" in target ? target.serverUrl : undefined,
          jobs: { interruptedJobs: "fail" },
        });
        try {
          const jobId = await backend.pipeline.enqueueScrapeJob(library, version, {
            url: fixtureUrl,
            library,
            version,
            scrapeMode: ScrapeMode.Fetch,
          });
          await backend.pipeline.waitForJobCompletion(jobId);
        } finally {
          await backend.close();
        }
      }

      beforeAll(async () => {
        localStore = mkdtempSync(path.join(tmpdir(), "cli-e2e-local-"));
        await Promise.all(
          [{ serverUrl: workerUrl }, { storePath: localStore }].map(async (target) => {
            await seed(target, "Parity", "1.2.0");
            await seed(target, "Removed", "1.0");
          }),
        );
      }, 60_000);

      afterAll(() => {
        rmSync(localStore, { recursive: true, force: true });
      });

      // The local run opens the worker's own store, so both read the same data
      it.each([
        { args: ["list"], shows: '"Parity"' },
        { args: ["search", "Parity", "blacksmith"], shows: "blacksmith" },
        { args: ["find-version", "Parity", "--version", "1.x"], shows: "1.2.0" },
      ])("$args.0 prints what a local run prints for the same store", async ({ args, shows }) => {
        const [remote, local] = await runBoth(args, storePath);

        expect(remote.code, remote.stderr).toBe(0);
        expect(local.code, local.stderr).toBe(0);
        expect(remote.stdout).toContain(shows);
        expect(remote.stdout).toBe(local.stdout);
      }, 60_000);

      it("refresh shows the same progress and summary", async () => {
        const [remote, local] = await runBoth(
          ["refresh", "Parity", "--version", "1.2.0", "--verbose"],
          localStore,
        );

        for (const result of [remote, local]) {
          expect(result.code, `${result.stdout}${result.stderr}`).toBe(0);
        }
        const summary = (stdout: string) =>
          stdout.split("\n").filter((line) => line.startsWith("Successfully refreshed"));
        expect(summary(remote.stdout)).toEqual(["Successfully refreshed 1 pages"]);
        expect(summary(remote.stdout)).toEqual(summary(local.stdout));
        expect(progressLines(`${remote.stdout}${remote.stderr}`)).toEqual([
          "🚀 Refreshing Parity v1.2.0...",
          "📄 Refreshing Parity v1.2.0: 1/1 pages",
        ]);
        expect(progressLines(`${remote.stdout}${remote.stderr}`)).toEqual(
          progressLines(`${local.stdout}${local.stderr}`),
        );
      }, 60_000);

      it("remove prints the same and removes the version from either store", async () => {
        const [remote, local] = await runBoth(["remove", "Removed", "--version", "1.0"], localStore);

        expect(remote.code, remote.stderr).toBe(0);
        expect(local.code, local.stderr).toBe(0);
        expect(remote.stdout).toContain("Removed");
        expect(remote.stdout).toBe(local.stdout);
        const { api, close } = createApiClient(workerUrl, { subscriptions: false });
        try {
          for (const libraries of [
            await api.listLibraries.query(),
            await withStore(localStore, (store) => store.listLibraries(), { configPath }),
          ]) {
            const names = libraries.map((lib) => lib.library);
            expect(names).toContain("Parity");
            expect(names).not.toContain("Removed");
          }
        } finally {
          close();
        }
      }, 60_000);

      it("compact reclaims the space a removed version left in the store it runs on", async () => {
        // A version of its own, so there is space to reclaim whatever ran before
        await Promise.all(
          [{ serverUrl: workerUrl }, { storePath: localStore }].map((target) =>
            seed(target, "Compacted", "1.0"),
          ),
        );
        for (const removed of await runBoth(["remove", "Compacted", "--version", "1.0"], localStore)) {
          expect(removed.code, removed.stderr).toBe(0);
        }
        const dbSizes = () =>
          [storePath, localStore].map((dir) => statSync(path.join(dir, "documents.db")).size);
        const before = dbSizes();

        const results = await runBoth(["compact"], localStore);

        for (const result of results) {
          expect(result.code, result.stderr).toBe(0);
          expect(result.stdout).toMatch(/^Compacted store from .+ to .+ \(reclaimed .+\)\.\n$/);
        }
        const after = dbSizes();
        expect(after[0], "the worker's documents.db").toBeLessThan(before[0]);
        expect(after[1], "the local documents.db").toBeLessThan(before[1]);
      }, 60_000);
    });
  });
});
