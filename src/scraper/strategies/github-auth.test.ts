import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  describe("explicit Authorization header", () => {
    it("should return explicit Authorization header unchanged", async () => {
      const headers = { Authorization: "Bearer explicit-token" };
      const result = await resolveGitHubAuth(headers);

      expect(result).toEqual({ Authorization: "Bearer explicit-token" });
    });

    it("should handle case-insensitive authorization header", async () => {
      const headers = { authorization: "Bearer explicit-token" };
      const result = await resolveGitHubAuth(headers);

      expect(result).toEqual({ authorization: "Bearer explicit-token" });
    });

    it("should preserve other headers when Authorization is present", async () => {
      const headers = {
        Authorization: "Bearer explicit-token",
        "X-Custom-Header": "value",
      };
      const result = await resolveGitHubAuth(headers);

      expect(result).toEqual({
        Authorization: "Bearer explicit-token",
        "X-Custom-Header": "value",
      });
    });
  });

  describe("GITHUB_TOKEN environment variable", () => {
    it("should use GITHUB_TOKEN when no explicit header", async () => {
      process.env.GITHUB_TOKEN = "github-token-value";

      const result = await resolveGitHubAuth();

      expect(result).toEqual({ Authorization: "Bearer github-token-value" });
    });

    it("should use GITHUB_TOKEN with existing non-auth headers", async () => {
      process.env.GITHUB_TOKEN = "github-token-value";
      const headers = { "X-Custom-Header": "value" };

      const result = await resolveGitHubAuth(headers);

      expect(result).toEqual({
        Authorization: "Bearer github-token-value",
        "X-Custom-Header": "value",
      });
    });

    it("should prefer GITHUB_TOKEN over GH_TOKEN", async () => {
      process.env.GITHUB_TOKEN = "github-token-value";
      process.env.GH_TOKEN = "gh-token-value";

      const result = await resolveGitHubAuth();

      expect(result).toEqual({ Authorization: "Bearer github-token-value" });
    });
  });

  describe("GH_TOKEN environment variable", () => {
    it("should use GH_TOKEN as fallback when GITHUB_TOKEN not set", async () => {
      process.env.GH_TOKEN = "gh-token-value";

      const result = await resolveGitHubAuth();

      expect(result).toEqual({ Authorization: "Bearer gh-token-value" });
    });
  });

  describe("gh CLI fallback", () => {
    it("should call gh CLI when no env vars are set", async () => {
      const { exec } = await import("node:child_process");
      (exec as any).mockImplementation(
        (
          _cmd: string,
          _opts: unknown,
          callback: (err: Error | null, stdout: string) => void,
        ) => {
          callback(null, "cli-token-value\n");
        },
      );

      const result = await resolveGitHubAuth();

      expect(result).toEqual({ Authorization: "Bearer cli-token-value" });
    });

    it("should return empty object when gh CLI fails", async () => {
      const { exec } = await import("node:child_process");
      (exec as any).mockImplementation(
        (
          _cmd: string,
          _opts: unknown,
          callback: (err: Error | null, stdout: string) => void,
        ) => {
          callback(new Error("gh: command not found"), "");
        },
      );

      const result = await resolveGitHubAuth();

      expect(result).toEqual({});
    });

    it("should return empty object when gh CLI returns empty", async () => {
      const { exec } = await import("node:child_process");
      (exec as any).mockImplementation(
        (
          _cmd: string,
          _opts: unknown,
          callback: (err: Error | null, stdout: string) => void,
        ) => {
          callback(null, "");
        },
      );

      const result = await resolveGitHubAuth();

      expect(result).toEqual({});
    });
  });

  describe("no authentication available", () => {
    it("should return empty object when nothing is available", async () => {
      const { exec } = await import("node:child_process");
      (exec as any).mockImplementation(
        (
          _cmd: string,
          _opts: unknown,
          callback: (err: Error | null, stdout: string) => void,
        ) => {
          callback(new Error("not authenticated"), "");
        },
      );

      const result = await resolveGitHubAuth();

      expect(result).toEqual({});
    });

    it("should return original headers when no auth found", async () => {
      const { exec } = await import("node:child_process");
      (exec as any).mockImplementation(
        (
          _cmd: string,
          _opts: unknown,
          callback: (err: Error | null, stdout: string) => void,
        ) => {
          callback(new Error("not authenticated"), "");
        },
      );

      const headers = { "X-Custom-Header": "value" };
      const result = await resolveGitHubAuth(headers);

      expect(result).toEqual({ "X-Custom-Header": "value" });
    });
  });
});
