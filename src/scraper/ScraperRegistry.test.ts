import { describe, it, expect } from "vitest";
import { ScraperRegistry } from "./ScraperRegistry";
import { ScraperError } from "../utils/errors";
import { LocalFileStrategy } from "./strategies/LocalFileStrategy";
import { GitHubScraperStrategy } from "./strategies/GitHubScraperStrategy";
import { NpmScraperStrategy } from "./strategies/NpmScraperStrategy";
import { PyPiScraperStrategy } from "./strategies/PyPiScraperStrategy";

describe("ScraperRegistry", () => {
  it("should throw error for unknown URLs", () => {
    const registry = new ScraperRegistry();
    expect(() => registry.getStrategy("invalid://example.com")).toThrow(
      ScraperError
    );
    expect(() => registry.getStrategy("invalid://example.com")).toThrow(
      "No strategy found for URL"
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
});
