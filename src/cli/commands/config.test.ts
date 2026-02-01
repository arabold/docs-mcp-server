/** Unit test for config command */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs";
import { createConfigCommand } from "./config";

vi.mock("../../utils/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/config")>();
  return {
    ...actual,
    loadConfig: vi.fn(() => ({
      scraper: {
        maxPages: 1000,
        document: { maxSize: 10485760 },
        fetcher: { maxRetries: 6 },
      },
      app: { telemetryEnabled: true },
    })),
    isValidConfigPath: vi.fn((path: string) => {
      const validPaths = [
        "scraper.maxPages",
        "scraper.document.maxSize",
        "scraper.fetcher",
        "app.telemetryEnabled",
      ];
      return validPaths.includes(path);
    }),
    setConfigValue: vi.fn(() => "/mock/config.yaml"),
  };
});

describe("config command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  describe("config (no subcommand)", () => {
    it("prints current configuration as JSON", async () => {
      const parser = yargs().scriptName("test");
      createConfigCommand(parser);

      await parser.parse("config");

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"scraper"'));
    });

    it("prints configuration as YAML with --yaml flag", async () => {
      const parser = yargs().scriptName("test");
      createConfigCommand(parser);

      await parser.parse("config --yaml");

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("scraper:"));
    });
  });

  describe("config get", () => {
    it("gets a scalar value", async () => {
      const parser = yargs().scriptName("test");
      createConfigCommand(parser);

      await parser.parse("config get scraper.maxPages");

      expect(consoleSpy).toHaveBeenCalledWith("1000");
    });

    it("gets an object value as JSON", async () => {
      const parser = yargs().scriptName("test");
      createConfigCommand(parser);

      await parser.parse("config get scraper.fetcher");

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"maxRetries"'));
    });

    it("errors on invalid path", async () => {
      const parser = yargs().scriptName("test");
      createConfigCommand(parser);

      await parser.parse("config get invalid.path");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid config path"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("outputs YAML with --yaml flag", async () => {
      const parser = yargs().scriptName("test");
      createConfigCommand(parser);

      await parser.parse("config get scraper.fetcher --yaml");

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("maxRetries:"));
    });
  });

  describe("config set", () => {
    it("sets a value and confirms", async () => {
      const parser = yargs().scriptName("test");
      createConfigCommand(parser);

      await parser.parse("config set scraper.maxPages 500");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Updated scraper.maxPages"),
      );
    });

    it("errors on invalid path", async () => {
      const parser = yargs().scriptName("test");
      createConfigCommand(parser);

      await parser.parse("config set invalid.path value");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid config path"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("errors when --config is specified (read-only mode)", async () => {
      const parser = yargs().scriptName("test");
      createConfigCommand(parser);

      await parser.parse("config set scraper.maxPages 500 --config /some/path.yaml");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cannot modify configuration"),
      );
      expect(process.exitCode).toBe(1);
    });
  });
});
