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

  describe("against a worker", () => {
    let storePath: string;
    let configPath: string;
    let worker: ChildProcess | undefined;
    let workerUrl: string;

    beforeAll(async () => {
      storePath = mkdtempSync(path.join(tmpdir(), "cli-e2e-worker-"));
      configPath = writeTestConfig(storePath, { allowPrivateNetworks: true });
      const started = await startWorker(storePath, configPath);
      worker = started.process;
      workerUrl = started.url;
    }, 60_000);

    afterAll(async () => {
      await stopChildProcess(worker);
      rmSync(storePath, { recursive: true, force: true });
    });

    /** Scrapes the fixture as `library` through `serverUrl`, showing diagnostics. */
    function scrapeRemotely(library: string, serverUrl = workerUrl) {
      // --verbose: without a terminal the CLI shows errors only. The cap turns
      // a client that never returns into a failed assertion instead of a test
      // timeout that leaves the CLI process behind.
      return runCli(
        [
          "scrape",
          library,
          fixtureUrl,
          "--server-url",
          serverUrl,
          "--config",
          configPath,
          "--verbose",
        ],
        40_000,
      );
    }

    it("returns from scrape --server-url once the worker finishes the job", async () => {
      const result = await scrapeRemotely("React");

      const output = `${result.stdout}${result.stderr}`;
      expect(result.code, output).toBe(0);
      expect(result.stdout).toContain("Successfully scraped 1 pages");
      expect(progressLines(output)).toEqual([
        expect.stringContaining("🚀 Scraping React..."),
        expect.stringContaining("📄 Scraping React: 1/1 pages"),
      ]);
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

        const result = await scrapeRemotely("Blocked", `http://127.0.0.1:${port}/api`);

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
      const site = await startSlowSite();
      const { api, close } = createApiClient(workerUrl, { subscriptions: false });
      try {
        const jobId = await startRunningSlowJob(api, site.url, "Other", null);

        const result = await scrapeRemotely("Mine");

        const output = `${result.stdout}${result.stderr}`;
        expect(result.code, output).toBe(0);
        const lines = progressLines(output);
        expect(lines.length).toBeGreaterThan(0);
        expect(lines.every((line) => line.includes("Scraping Mine"))).toBe(true);
        await api.cancelJob.mutate({ id: jobId });
      } finally {
        close();
        await site.close();
      }
    }, 60_000);
  });
});
