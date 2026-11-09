import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeEnvironment } from "../../utils/env";
import { resolveGitHubAuth } from "./github-auth";

// Mock child_process
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

// Mock util.promisify to return our mocked exec
vi.mock("node:util", async () => {
  const actual = await vi.importActual("node:util");
  return {
    ...actual,
    promisify: vi.fn((_fn: unknown) => {
      // Return a mock async version of exec
      return async (command: string, _options?: { timeout?: number }) => {
        const { exec } = await import("node:child_process");
        return new Promise((resolve, reject) => {
          (exec as unknown as Mock)(
            command,
            _options,
            (error: Error | null, stdout: string) => {
              if (error) reject(error);
              else resolve({ stdout, stderr: "" });
            },
          );
        });
      };
    }),
  };
});

describe("resolveGitHubAuth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  /** Makes the mocked `gh auth token` call fail or print the given output. */
  async function mockGhCli(error: Error | null, stdout: string): Promise<void> {
    const { exec } = await import("node:child_process");
    (exec as unknown as Mock).mockImplementation(
      (
        _cmd: string,
        _opts: unknown,
        callback: (err: Error | null, stdout: string) => void,
      ) => {
        callback(error, stdout);
      },
    );
  }

  it("keeps an explicit Authorization header in any case, with the other headers", async () => {
    process.env.GITHUB_TOKEN = "github-token-value";
    const cases: Array<{ label: string; headers: Record<string, string> }> = [
      { label: "Authorization", headers: { Authorization: "Bearer explicit-token" } },
      {
        label: "lowercase authorization",
        headers: { authorization: "Bearer explicit-token" },
      },
      {
        label: "Authorization with another header",
        headers: { Authorization: "Bearer explicit-token", "X-Custom-Header": "value" },
      },
    ];

    for (const { label, headers } of cases) {
      expect.soft(await resolveGitHubAuth({ ...headers }), label).toEqual(headers);
    }
  });

  it("uses GITHUB_TOKEN before GH_TOKEN and keeps the other headers", async () => {
    const cases: Array<{
      label: string;
      env: { GITHUB_TOKEN?: string; GH_TOKEN?: string };
      headers?: Record<string, string>;
      expected: Record<string, string>;
    }> = [
      {
        label: "GITHUB_TOKEN alone",
        env: { GITHUB_TOKEN: "github-token-value" },
        expected: { Authorization: "Bearer github-token-value" },
      },
      {
        label: "GITHUB_TOKEN with another header",
        env: { GITHUB_TOKEN: "github-token-value" },
        headers: { "X-Custom-Header": "value" },
        expected: {
          Authorization: "Bearer github-token-value",
          "X-Custom-Header": "value",
        },
      },
      {
        label: "GITHUB_TOKEN and GH_TOKEN",
        env: { GITHUB_TOKEN: "github-token-value", GH_TOKEN: "gh-token-value" },
        expected: { Authorization: "Bearer github-token-value" },
      },
      {
        label: "GH_TOKEN alone",
        env: { GH_TOKEN: "gh-token-value" },
        expected: { Authorization: "Bearer gh-token-value" },
      },
    ];

    for (const { label, env, headers, expected } of cases) {
      process.env = { ...originalEnv, ...env };
      if (!env.GITHUB_TOKEN) delete process.env.GITHUB_TOKEN;
      if (!env.GH_TOKEN) delete process.env.GH_TOKEN;
      expect.soft(await resolveGitHubAuth(headers), label).toEqual(expected);
    }
  });

  it("uses the sanitized value of either token variable", async () => {
    for (const variable of ["GITHUB_TOKEN", "GH_TOKEN"] as const) {
      process.env = { ...originalEnv };
      delete process.env.GITHUB_TOKEN;
      delete process.env.GH_TOKEN;
      process.env[variable] = '"ghp_test_token"';
      sanitizeEnvironment(process.env);

      expect
        .soft(await resolveGitHubAuth(), variable)
        .toEqual({ Authorization: "Bearer ghp_test_token" });
    }
  });

  it("should call gh CLI when no env vars are set", async () => {
    await mockGhCli(null, "cli-token-value\n");

    const result = await resolveGitHubAuth();

    expect(result).toEqual({ Authorization: "Bearer cli-token-value" });
  });

  it("returns the original headers when no token is available", async () => {
    const cases: Array<{
      label: string;
      error: Error | null;
      stdout: string;
      headers?: Record<string, string>;
      expected: Record<string, string>;
    }> = [
      {
        label: "gh is not installed",
        error: new Error("gh: command not found"),
        stdout: "",
        expected: {},
      },
      { label: "gh prints nothing", error: null, stdout: "", expected: {} },
      {
        label: "gh is not authenticated",
        error: new Error("not authenticated"),
        stdout: "",
        expected: {},
      },
      {
        label: "gh is not authenticated, with another header",
        error: new Error("not authenticated"),
        stdout: "",
        headers: { "X-Custom-Header": "value" },
        expected: { "X-Custom-Header": "value" },
      },
    ];

    for (const { label, error, stdout, headers, expected } of cases) {
      await mockGhCli(error, stdout);
      expect.soft(await resolveGitHubAuth(headers), label).toEqual(expected);
    }
  });
});
