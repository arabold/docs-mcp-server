/** Unit test for config command */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs";
import { logger } from "../../utils/logger";
import { createConfigCommand } from "./config";

const stdoutWriteMock = vi.fn();

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
  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWriteMock.mockReset();
    process.env.ENABLE_TEST_LOGS = "1";
    vi.spyOn(process.stdout, "write").mockImplementation(stdoutWriteMock as any);
    vi.spyOn(logger, "error").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    delete process.env.ENABLE_TEST_LOGS;
    process.exitCode = undefined;
  });

  describe("config (no subcommand)", () => {
    it("prints current configuration as JSON", async () => {
      const parser = yargs().scriptName("test");
      createConfigCommand(parser);

      await parser.parse("config");

      expect(stdoutWriteMock).toHaveBeenCalledWith(expect.stringContaining('"scraper"'));
    });

    it("prints configuration as YAML with --yaml flag", async () => {
      const parser = yargs().scriptName("test");
      createConfigCommand(parser);

      await parser.parse("config --output yaml");

      expect(stdoutWriteMock).toHaveBeenCalledWith(expect.stringContaining("scraper:"));
    });

    it("prints configuration as TOON with --output toon", async () => {
      const parser = yargs().scriptName("test");
      createConfigCommand(parser);

      await parser.parse("config --output toon");

      expect(stdoutWriteMock).toHaveBeenCalledWith(
        expect.stringContaining("maxPages: 1000"),
      );
    });
  });

  describe("config get", () => {
    it("gets a scalar value", async () => {
      const parser = yargs().scriptName("test");
      createConfigCommand(parser);

      await parser.parse("config get scraper.maxPages");

      expect(stdoutWriteMock).toHaveBeenCalledWith("1000\n");
    });

    it("gets an object value as JSON", async () => {
      const parser = yargs().scriptName("test");
      createConfigCommand(parser);

      await parser.parse("config get scraper.fetcher");

      expect(stdoutWriteMock).toHaveBeenCalledWith(
        expect.stringContaining('"maxRetries"'),
      );
    });

    it("errors on invalid path", async () => {
      const parser = yargs().scriptName("test");
      createConfigCommand(parser);

      await parser.parse("config get invalid.path");

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid config path"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("outputs YAML with --yaml flag", async () => {
      const parser = yargs().scriptName("test");
      createConfigCommand(parser);

      await parser.parse("config get scraper.fetcher --output yaml");

      expect(stdoutWriteMock).toHaveBeenCalledWith(
        expect.stringContaining("maxRetries:"),
      );
    });

    it("outputs TOON with --output toon", async () => {
      const parser = yargs().scriptName("test");
      createConfigCommand(parser);

      await parser.parse("config get scraper.fetcher --output toon");

      expect(stdoutWriteMock).toHaveBeenCalledWith(
        expect.stringContaining("maxRetries: 6"),
      );
    });
  });

  describe("config set", () => {
    it("sets a value and confirms", async () => {
      const parser = yargs().scriptName("test");
      createConfigCommand(parser);

      await parser.parse("config set scraper.maxPages 500");

      expect(stdoutWriteMock).toHaveBeenCalledWith(
        expect.stringContaining("Updated scraper.maxPages"),
      );
    });

    it("errors on invalid path", async () => {
      const parser = yargs().scriptName("test");
      createConfigCommand(parser);

      await parser.parse("config set invalid.path value");

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid config path"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("errors when --config is specified (read-only mode)", async () => {
      const parser = yargs().scriptName("test");
      createConfigCommand(parser);

      await parser.parse("config set scraper.maxPages 500 --config /some/path.yaml");

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Cannot modify configuration"),
      );
      expect(process.exitCode).toBe(1);
    });
  });
});
