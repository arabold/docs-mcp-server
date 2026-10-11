import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventBusService } from "../src/events";
import { createApiClient } from "../src/services/apiClient";
import { DocumentManagementService } from "../src/store/DocumentManagementService";
import { loadConfig } from "../src/utils/config";
import {
  createTcpProxy,
  getCliCommand,
  getFreePort,
  startRunningSlowJob,
  startSlowSite,
  startWorker,
  stopChildProcess,
  writeTestConfig,
} from "./test-helpers";

describe("CLI E2E", () => {
  const projectRoot = path.resolve(import.meta.dirname, "..");
  const fixtureUrl = `file://${path.join(projectRoot, "test", "fixtures", "html.html")}`;

  /** The status and progress lines a scrape printed. */
  function progressLines(output: string): string[] {
    return output.split("\n").filter((line) => /[🚀📄] Scraping /u.test(line));
  }

  /** Run the CLI; with `timeoutMs`, kill it after that long and report exit code 1. */
  async function runCli(
    args: string[],
    timeoutMs?: number,
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const { cmd, args: cliArgs } = getCliCommand();
      const proc = spawn(cmd, [...cliArgs, ...args], {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, VITEST_WORKER_ID: undefined },
        timeout: timeoutMs,
        killSignal: "SIGKILL",
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        resolve({ code: code ?? 1, stdout, stderr });
      });

      proc.on("error", (err) => {
        reject(err);
      });
    });
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
      const config = loadConfig({}, { configPath });
      config.app.storePath = storePath;
      const docService = new DocumentManagementService(new EventBusService(), config);
      await docService.initialize();
      await docService.ensureVersion({ library: "React", version: "" });
      await docService.shutdown();

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

    /**
     * Scrapes `url` as `library`, through the worker at `serverUrl` or, with
     * `{ storePath }`, locally, showing diagnostics.
     */
    function scrape(
      library: string,
      target: { serverUrl: string } | { storePath: string } = { serverUrl: workerUrl },
      url = fixtureUrl,
    ) {
      const backendArgs =
        "serverUrl" in target
          ? ["--server-url", target.serverUrl]
          : ["--store-path", target.storePath];
      // --verbose: without a terminal the CLI shows errors only. The cap turns
      // a client that never returns into a failed assertion instead of a test
      // timeout that leaves the CLI process behind.
      return runCli(
        ["scrape", library, url, ...backendArgs, "--config", configPath, "--verbose"],
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
  });
});
