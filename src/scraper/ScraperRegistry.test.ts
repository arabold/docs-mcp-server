import { describe, expect, it } from "vitest";
import { loadConfig } from "../utils/config";
import { ScraperError } from "../utils/errors";
import { ScraperRegistry } from "./ScraperRegistry";
import { GitHubScraperStrategy } from "./strategies/GitHubScraperStrategy";
import { LocalFileStrategy } from "./strategies/LocalFileStrategy";
import { NpmScraperStrategy } from "./strategies/NpmScraperStrategy";
import { PyPiScraperStrategy } from "./strategies/PyPiScraperStrategy";
import { WebScraperStrategy } from "./strategies/WebScraperStrategy";

describe("ScraperRegistry", () => {
  const appConfig = loadConfig();

  it("should throw error for unknown URLs", () => {
    const registry = new ScraperRegistry(appConfig);
    expect(() => registry.getStrategy("invalid://example.com")).toThrow(ScraperError);
    expect(() => registry.getStrategy("invalid://example.com")).toThrow(
      "No strategy found for URL",
    );
  });

  it("should return LocalFileStrategy for file:// URLs", () => {
    const registry = new ScraperRegistry(appConfig);
    const strategy = registry.getStrategy("file:///path/to/file.txt");
    expect(strategy).toBeInstanceOf(LocalFileStrategy);
  });

  it("should return GitHubScraperStrategy for GitHub URLs", () => {
    const registry = new ScraperRegistry(appConfig);
    const strategy = registry.getStrategy("https://github.com/user/repo");
    expect(strategy).toBeInstanceOf(GitHubScraperStrategy);
  });

  it("should return NpmScraperStrategy for NPM URLs", () => {
    const registry = new ScraperRegistry(appConfig);
    const strategy = registry.getStrategy("https://npmjs.com/package/test");
    expect(strategy).toBeInstanceOf(NpmScraperStrategy);
  });

  it("should return PyPiScraperStrategy for PyPI URLs", () => {
    const registry = new ScraperRegistry(appConfig);
    const strategy = registry.getStrategy("https://pypi.org/project/test");
    expect(strategy).toBeInstanceOf(PyPiScraperStrategy);
  });

  it("should return WebScraperStrategy for generic HTTP URLs", () => {
    const registry = new ScraperRegistry(appConfig);
    const strategy = registry.getStrategy("https://docs.example.com/");
    expect(strategy).toBeInstanceOf(WebScraperStrategy);
  });

  describe("factory pattern for state isolation", () => {
    it("should return independent instances for each getStrategy call", () => {
      const registry = new ScraperRegistry(appConfig);

      // Get two strategies for the same URL pattern
      const strategy1 = registry.getStrategy("https://docs.example.com/");
      const strategy2 = registry.getStrategy("https://docs.example.com/");

      // They should be different instances
      expect(strategy1).not.toBe(strategy2);
      expect(strategy1).toBeInstanceOf(WebScraperStrategy);
      expect(strategy2).toBeInstanceOf(WebScraperStrategy);
    });

    it("should return independent instances for different URL patterns", () => {
      const registry = new ScraperRegistry(appConfig);

      // Get strategies for different URL patterns
      const npmStrategy = registry.getStrategy("https://npmjs.com/package/test");
      const githubStrategy = registry.getStrategy("https://github.com/user/repo");
      const webStrategy = registry.getStrategy("https://docs.example.com/");

      // All should be different instances
      expect(npmStrategy).not.toBe(githubStrategy);
      expect(githubStrategy).not.toBe(webStrategy);
      expect(npmStrategy).not.toBe(webStrategy);
    });

    it("should ensure strategies have isolated state", () => {
      const registry = new ScraperRegistry(appConfig);

      // Get two WebScraperStrategy instances
      const strategy1 = registry.getStrategy(
        "https://docs.example.com/",
      ) as WebScraperStrategy;
      const strategy2 = registry.getStrategy(
        "https://docs.another.com/",
      ) as WebScraperStrategy;

      // Access internal state (using any to access protected members for testing)
      const visited1 = (strategy1 as any).visited as Set<string> | undefined;
      const visited2 = (strategy2 as any).visited as Set<string> | undefined;

      expect(visited1).toBeDefined();
      expect(visited2).toBeDefined();

      // Add a URL to strategy1's visited set
      visited1?.add("https://test.com/page1");

      // Strategy2's visited set should be unaffected
      expect(visited1?.has("https://test.com/page1")).toBe(true);
      expect(visited2?.has("https://test.com/page1")).toBe(false);
      expect(visited1).not.toBe(visited2);
    });
  });
});
