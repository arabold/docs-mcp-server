import { describe, expect, it, vi } from "vitest";
import { ScraperError } from "../utils/errors";
import { ScraperRegistry } from "./ScraperRegistry";
import { GitHubScraperStrategy } from "./strategies/GitHubScraperStrategy";
import { LocalFileStrategy } from "./strategies/LocalFileStrategy";
import { NpmScraperStrategy } from "./strategies/NpmScraperStrategy";
import { PyPiScraperStrategy } from "./strategies/PyPiScraperStrategy";

vi.mock("../utils/logger");

describe("ScraperRegistry", () => {
  it("should throw error for unknown URLs", () => {
    const registry = new ScraperRegistry();
    expect(() => registry.getStrategy("invalid://example.com")).toThrow(ScraperError);
    expect(() => registry.getStrategy("invalid://example.com")).toThrow(
      "No strategy found for URL",
    );
  });

  it("should return LocalFileStrategy for file:// URLs", () => {
    const registry = new ScraperRegistry();
    const strategy = registry.getStrategy("file:///path/to/file.txt");
    expect(strategy).toBeInstanceOf(LocalFileStrategy);
  });

  it("should return GitHubScraperStrategy for GitHub URLs", () => {
    const registry = new ScraperRegistry();
    const strategy = registry.getStrategy("https://github.com/user/repo");
    expect(strategy).toBeInstanceOf(GitHubScraperStrategy);
  });

  it("should return NpmScraperStrategy for NPM URLs", () => {
    const registry = new ScraperRegistry();
    const strategy = registry.getStrategy("https://npmjs.com/package/test");
    expect(strategy).toBeInstanceOf(NpmScraperStrategy);
  });

  it("should return PyPiScraperStrategy for PyPI URLs", () => {
    const registry = new ScraperRegistry();
    const strategy = registry.getStrategy("https://pypi.org/project/test");
    expect(strategy).toBeInstanceOf(PyPiScraperStrategy);
  });

  describe("cleanup", () => {
    it("should call cleanup() on all registered strategies", async () => {
      const registry = new ScraperRegistry();

      // Spy on cleanup methods of all strategies
      const strategies = registry["strategies"];
      const cleanupSpies = strategies
        .map((strategy) => {
          if (strategy.cleanup) {
            return vi.spyOn(strategy, "cleanup" as any).mockResolvedValue(undefined);
          }
          return null;
        })
        .filter(Boolean);

      await registry.cleanup();

      // Verify cleanup was called on all strategies that have it
      cleanupSpies.forEach((spy) => {
        expect(spy).toHaveBeenCalledOnce();
      });
    });

    it("should handle cleanup errors gracefully", async () => {
      const registry = new ScraperRegistry();

      // Mock one strategy to throw error during cleanup
      const strategies = registry["strategies"];
      const strategyWithCleanup = strategies.find((s) => s.cleanup);
      if (strategyWithCleanup?.cleanup) {
        vi.spyOn(strategyWithCleanup, "cleanup" as any).mockRejectedValue(
          new Error("Strategy cleanup failed"),
        );
      }

      // Should still complete without throwing
      await expect(registry.cleanup()).resolves.not.toThrow();
    });

    it("should be idempotent - multiple cleanup() calls should not error", async () => {
      const registry = new ScraperRegistry();

      // Multiple calls should not throw
      await expect(registry.cleanup()).resolves.not.toThrow();
      await expect(registry.cleanup()).resolves.not.toThrow();
    });
  });
});
