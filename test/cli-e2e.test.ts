import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EventBusService } from "../src/events";
import { DocumentManagementService } from "../src/store/DocumentManagementService";
import { loadConfig } from "../src/utils/config";
import { getCliCommand, writeTestConfig } from "./test-helpers";

describe("CLI E2E", () => {
  const projectRoot = path.resolve(import.meta.dirname, "..");

  async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const { cmd, args: cliArgs } = getCliCommand();
      const proc = spawn(cmd, [...cliArgs, ...args], {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, VITEST_WORKER_ID: undefined },
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
    const fixtureUrl = `file://${path.join(projectRoot, "test", "fixtures", "html.html")}`;
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
});
