/** Unit test for config command */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs";
import { setConfigValue } from "../../utils/config";
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
  let stdoutWriteSpy: { mockRestore: () => void };

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWriteMock.mockReset();
    stdoutWriteSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(stdoutWriteMock as any);
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
    stdoutWriteSpy.mockRestore();
  });

  /** Runs `args` through a parser that knows only the config command. */
  async function run(args: string): Promise<void> {
    const parser = yargs().scriptName("test");
    createConfigCommand(parser);
    await parser.parse(args);
  }

  /** Everything the command wrote to stdout. */
  const printed = () =>
    stdoutWriteMock.mock.calls.map(([chunk]) => String(chunk)).join("");

  it("prints the configuration in the format --output names", async () => {
    const cases: Array<{ args: string; shows: string }> = [
      { args: "config", shows: '"scraper"' },
      { args: "config --output yaml", shows: "scraper:" },
      { args: "config --output toon", shows: "maxPages: 1000" },
      { args: "config get scraper.fetcher --output yaml", shows: "maxRetries:" },
      { args: "config get scraper.fetcher --output toon", shows: "maxRetries: 6" },
    ];

    for (const { args, shows } of cases) {
      stdoutWriteMock.mockReset();
      await run(args);
      expect.soft(printed(), args).toContain(shows);
    }
  });

  it("gets a scalar value as plain text and an object value as JSON", async () => {
    await run("config get scraper.maxPages");
    expect(printed()).toBe("1000\n");

    stdoutWriteMock.mockReset();
    await run("config get scraper.fetcher");
    expect(JSON.parse(printed())).toEqual({ maxRetries: 6 });
  });

  it("sets a value and confirms", async () => {
    await run("config set scraper.maxPages 500");

    expect(printed()).toContain("Updated scraper.maxPages");
  });

  it("refuses to set a value it cannot save, with exit code 1", async () => {
    const cases: Array<{ label: string; args: string; reason: RegExp }> = [
      {
        label: "unknown path",
        args: "config set invalid.path value",
        reason: /Invalid config path 'invalid.path'/,
      },
      {
        label: "explicit --config file (read-only)",
        args: "config set scraper.maxPages 500 --config /some/path.yaml",
        reason: /Cannot modify configuration when using explicit --config file/,
      },
      {
        label: "path to an object",
        args: "config set scraper.fetcher 5",
        reason: /refers to an object/,
      },
    ];

    for (const { label, args, reason } of cases) {
      vi.mocked(logger.error).mockClear();
      process.exitCode = undefined;

      await run(args);

      expect.soft(process.exitCode, label).toBe(1);
      const logged = vi.mocked(logger.error).mock.calls.map(([message]) => message);
      expect.soft(logged.join("\n"), label).toMatch(reason);
    }
    expect(setConfigValue).not.toHaveBeenCalled();
  });
});
