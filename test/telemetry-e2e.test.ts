/**
 * E2E tests for telemetry configuration.
 *
 * These tests verify that the DOCS_MCP_TELEMETRY environment variable
 * correctly controls telemetry behavior. We parse debug logs to verify
 * the telemetry state since the actual PostHog API key is not available
 * in test environments.
 *
 * Expected log messages:
 * - "Telemetry disabled (user preference)" - when DOCS_MCP_TELEMETRY=false
 * - "Telemetry disabled (no API key configured)" - when enabled but no API key
 *
 * This specifically tests the fix for GitHub issue #306.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getCliCommand } from "./test-helpers";

describe("Telemetry E2E", () => {
  const projectRoot = path.resolve(import.meta.dirname, "..");

  /**
   * Run the CLI with specific environment variables and capture output.
   * Uses LOG_LEVEL=debug to capture telemetry initialization messages.
   * Uses the 'list' command since --help exits before middleware runs.
   */
  async function runCliWithEnv(
    args: string[],
    env: Record<string, string>,
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const { cmd, args: cliArgs } = getCliCommand();
      const proc = spawn(cmd, [...cliArgs, ...args], {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          // Remove VITEST_WORKER_ID so logger outputs to console
          VITEST_WORKER_ID: undefined,
          // Enable debug logging to see telemetry messages
          LOG_LEVEL: "debug",
          // Apply test-specific environment
          ...env,
        },
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

  it("should log 'user preference' when DOCS_MCP_TELEMETRY=false", async () => {
    // Use 'list' command which fully initializes the app including telemetry
    const { stdout, stderr } = await runCliWithEnv(["list"], {
      DOCS_MCP_TELEMETRY: "false",
    });

    // Combine output since debug logs may go to either stream
    const output = stdout + stderr;

    // Should indicate telemetry was disabled by user preference
    expect(output).toContain("Telemetry disabled (user preference)");
    // Should NOT say "no API key" since user explicitly disabled it
    expect(output).not.toContain("Telemetry disabled (no API key configured)");
  });

  it("should log 'no API key' when DOCS_MCP_TELEMETRY=true but no API key", async () => {
    // Run with telemetry explicitly enabled (but no POSTHOG key in test env)
    const { stdout, stderr } = await runCliWithEnv(["list"], {
      DOCS_MCP_TELEMETRY: "true",
    });

    const output = stdout + stderr;

    // Should indicate telemetry disabled due to missing API key, not user preference
    expect(output).toContain("Telemetry disabled (no API key configured)");
    // Should NOT say "user preference" since user wanted it enabled
    expect(output).not.toContain("Telemetry disabled (user preference)");
  });

  it("should respect --no-telemetry CLI flag", async () => {
    const { stdout, stderr } = await runCliWithEnv(["--no-telemetry", "list"], {
      // Don't set env var - let CLI flag control it
    });

    const output = stdout + stderr;

    // CLI flag should result in "user preference" message
    expect(output).toContain("Telemetry disabled (user preference)");
  });

  it("should respect --telemetry=false CLI flag", async () => {
    const { stdout, stderr } = await runCliWithEnv(["--telemetry=false", "list"], {});

    const output = stdout + stderr;

    expect(output).toContain("Telemetry disabled (user preference)");
  });
});
