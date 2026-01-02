import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("Configuration Loading E2E", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-mcp-config-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function runConfigCommand(args: string[], env: NodeJS.ProcessEnv = {}): Promise<any> {
    const projectRoot = path.resolve(import.meta.dirname, "..");
    const entryPoint = path.join(projectRoot, "src", "index.ts");

    const testEnv = { ...process.env, ...env };
    delete testEnv.VITEST_WORKER_ID;

    // Global options must come before the subcommand
    const finalArgs = ["vite-node", entryPoint, ...args, "config"];

    return new Promise((resolve, reject) => {
      const proc = spawn("npx", finalArgs, {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: testEnv,
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
        if (code !== 0) {
          reject(new Error(`Command failed with code ${code}\nStderr: ${stderr}`));
        } else {
          try {
            resolve(JSON.parse(stdout));
          } catch (e) {
            reject(new Error(`Failed to parse JSON output: ${stdout}`));
          }
        }
      });
    });
  }

  it("should load default configuration", async () => {
    const config = await runConfigCommand([]);
    expect(config.app.telemetryEnabled).toBe(true); // Default
  });

  it("should load configuration from --config flag", async () => {
    const configPath = path.join(tempDir, "custom-config.yaml");
    await fs.writeFile(configPath, "telemetry:\n  enabled: false\n");

    const config = await runConfigCommand(["--config", configPath]);
    expect(config.app.telemetryEnabled).toBe(false);
  });

  it("should load configuration from DOCS_MCP_CONFIG env var", async () => {
    const configPath = path.join(tempDir, "env-config.yaml");
    await fs.writeFile(configPath, "telemetry:\n  enabled: false\n");

    const config = await runConfigCommand([], { DOCS_MCP_CONFIG: configPath });
    expect(config.app.telemetryEnabled).toBe(false);
  });

  it("should load configuration from storage directory", async () => {
    const storePath = path.join(tempDir, "store");
    await fs.mkdir(storePath);
    const configPath = path.join(storePath, "config.yaml");
    await fs.writeFile(configPath, "telemetry:\n  enabled: false\n");

    const config = await runConfigCommand(["--store-path", storePath]);
    expect(config.app.telemetryEnabled).toBe(false);
  });
});
