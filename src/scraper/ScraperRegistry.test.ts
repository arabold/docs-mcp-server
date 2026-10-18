import { describe, expect, it } from "vitest";
import { loadConfig } from "../utils/config";
import { ScraperError } from "../utils/errors";
import { ScraperRegistry } from "./ScraperRegistry";
import { GitHubScraperStrategy } from "./strategies/GitHubScraperStrategy";
import { LocalFileStrategy } from "./strategies/LocalFileStrategy";
import { NpmScraperStrategy } from "./strategies/NpmScraperStrategy";
import { PyPiScraperStrategy } from "./strategies/PyPiScraperStrategy";
import { WebScraperStrategy } from "./strategies/WebScraperStrategy";
import type { ScraperStrategy } from "./types";

describe("ScraperRegistry", () => {
  const appConfig = loadConfig();

  it("should throw error for unknown URLs", () => {
    const registry = new ScraperRegistry(appConfig);
    expect(() => registry.getStrategy("invalid://example.com")).toThrow(ScraperError);
    expect(() => registry.getStrategy("invalid://example.com")).toThrow(
      "No strategy found for URL",
    );
  });

  it("routes each URL to the strategy for its source", () => {
    const registry = new ScraperRegistry(appConfig);
    const cases: Array<{
      url: string;
      strategy: new (...args: never[]) => ScraperStrategy;
    }> = [
      { url: "file:///path/to/file.txt", strategy: LocalFileStrategy },
      { url: "https://npmjs.com/package/test", strategy: NpmScraperStrategy },
      { url: "https://pypi.org/project/test", strategy: PyPiScraperStrategy },
      { url: "https://github.com/user/repo", strategy: GitHubScraperStrategy },
      { url: "https://www.github.com/owner/repo", strategy: GitHubScraperStrategy },
      { url: "https://github.com/owner/repo/", strategy: GitHubScraperStrategy },
      { url: "https://github.com/owner/repo/tree/main", strategy: GitHubScraperStrategy },
      {
        url: "https://github.com/owner/repo/tree/develop/src",
        strategy: GitHubScraperStrategy,
      },
      {
        url: "https://github.com/owner/repo/blob/main/README.md",
        strategy: GitHubScraperStrategy,
      },
      {
        url: "https://github.com/owner/repo/blob/main/src/index.js",
        strategy: GitHubScraperStrategy,
      },
      // Legacy github-file:// URLs still route to GitHub, which reports them as
      // not found so a refresh removes the pages stored under them.
      { url: "github-file://src/cli/types.ts", strategy: GitHubScraperStrategy },
      { url: "github-file://README.md", strategy: GitHubScraperStrategy },
      // Wiki, issue and pull request pages are ordinary web pages.
      { url: "https://github.com/owner/repo/wiki", strategy: WebScraperStrategy },
      { url: "https://github.com/owner/repo/wiki/Page", strategy: WebScraperStrategy },
      { url: "https://github.com/owner/repo/issues", strategy: WebScraperStrategy },
      { url: "https://github.com/owner/repo/pulls", strategy: WebScraperStrategy },
      { url: "https://gitlab.com/owner/repo", strategy: WebScraperStrategy },
      { url: "https://bitbucket.org/owner/repo", strategy: WebScraperStrategy },
      { url: "https://docs.example.com/", strategy: WebScraperStrategy },
      { url: "http://example.com", strategy: WebScraperStrategy },
    ];

    for (const { url, strategy } of cases) {
      expect.soft(registry.getStrategy(url), url).toBeInstanceOf(strategy);
    }
  });

  it("should return independent instances for each getStrategy call", () => {
    const registry = new ScraperRegistry(appConfig);

    const strategy1 = registry.getStrategy("https://docs.example.com/");
    const strategy2 = registry.getStrategy("https://docs.example.com/");

    expect(strategy1).not.toBe(strategy2);
  });
});
