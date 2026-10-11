/** Unit test for scrapeAction */

import { beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs";
import { openBackend } from "../../services/backend";
import { ScrapeTool } from "../../tools";
import { createScrapeCommand } from "./scrape";

const pipelineMock = {};
const closeBackend = vi.fn(async () => {});

vi.mock("../../services/backend", () => ({
  openBackend: vi.fn(async () => ({
    docService: {},
    pipeline: pipelineMock,
    eventBus: { on: vi.fn(() => () => {}) },
    close: closeBackend,
  })),
}));
vi.mock("../../tools", () => ({
  ScrapeTool: vi.fn().mockImplementation(function () {
    return { execute: vi.fn(async () => ({ jobId: "job-123" })) };
  }),
}));
vi.mock("../../events", () => ({
  EventBusService: vi.fn().mockImplementation(function () {
    return {
      on: vi.fn(),
      emit: vi.fn(),
    };
  }),
  EventType: {
    JOB_STATUS_CHANGE: "JOB_STATUS_CHANGE",
    JOB_PROGRESS: "JOB_PROGRESS",
    LIBRARY_CHANGE: "LIBRARY_CHANGE",
  },
}));
vi.mock("../utils", () => ({
  getGlobalOptions: vi.fn(() => ({ storePath: undefined })),
  getEventBus: vi.fn(() => ({
    on: vi.fn(),
    emit: vi.fn(),
  })),
  parseHeaders: vi.fn(() => ({})),
  resolveEmbeddingContext: vi.fn(() => ({ provider: "mock", model: "mock-model" })),
  CliContext: {},
  setupLogging: vi.fn(),
}));
vi.mock("../../utils/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/config")>();
  return {
    ...actual,
    loadConfig: vi.fn(() => ({
      app: { embeddingModel: "mock-model", storePath: "/mock/store" },
      scraper: { maxPages: 100, maxDepth: 2, maxConcurrency: 1 },
    })),
  };
});

describe("scrape command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the crawl flags to ScrapeTool", async () => {
    const parser = yargs().scriptName("test");
    createScrapeCommand(parser);

    // Values that differ from the option defaults and the config
    await parser.parse([
      "scrape",
      "react",
      "https://react.dev",
      "--version",
      "19.0",
      "--max-pages",
      "5",
      "--max-depth",
      "1",
      "--max-concurrency",
      "3",
      "--no-ignore-errors",
      "--scope",
      "hostname",
      "--no-follow-redirects",
      "--scrape-mode",
      "fetch",
      "--include-pattern",
      "/reference/*",
      "--exclude-pattern",
      "/blog/*",
      "--no-clean",
    ]);

    const execute = vi.mocked(ScrapeTool).mock.results[0]?.value.execute;
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://react.dev",
        library: "react",
        version: "19.0",
        options: expect.objectContaining({
          maxPages: 5,
          maxDepth: 1,
          maxConcurrency: 3,
          ignoreErrors: false,
          scope: "hostname",
          followRedirects: false,
          scrapeMode: "fetch",
          includePatterns: ["/reference/*"],
          excludePatterns: ["/blog/*"],
          clean: false,
        }),
      }),
    );
  });

  it("runs on a backend that recovers no jobs, and closes it", async () => {
    const parser = yargs().scriptName("test");
    createScrapeCommand(parser);

    await parser.parse(["scrape", "react", "https://react.dev"]);

    expect(openBackend).toHaveBeenCalledWith(
      expect.objectContaining({ jobs: { recoverJobs: false } }),
    );
    expect(closeBackend).toHaveBeenCalledTimes(1);
  });

  it("passes preserveHashes through to ScrapeTool", async () => {
    const parser = yargs().scriptName("test");
    createScrapeCommand(parser);

    await parser.parse(["scrape", "react", "https://react.dev", "--preserve-hashes"]);

    const execute = vi.mocked(ScrapeTool).mock.results[0]?.value.execute;
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          preserveHashes: true,
        }),
      }),
    );
  });

  it("passes --replace through to ScrapeTool", async () => {
    const parser = yargs().scriptName("test");
    createScrapeCommand(parser);

    await parser.parse(["scrape", "react", "https://react.dev", "--replace"]);

    const execute = vi.mocked(ScrapeTool).mock.results[0]?.value.execute;
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ replace: true }));
  });

  it("does not replace by default", async () => {
    const parser = yargs().scriptName("test");
    createScrapeCommand(parser);

    await parser.parse(["scrape", "react", "https://react.dev"]);

    const execute = vi.mocked(ScrapeTool).mock.results[0]?.value.execute;
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ replace: false }));
  });
});
