/** Unit test for scrapeAction */

import { beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs";
import { telemetry } from "../../telemetry";
import { ScrapeTool } from "../../tools";
import { ensurePlaywrightBrowsersInstalled } from "../utils";
import { createScrapeCommand } from "./scrape";

const pipelineMock = {};
const closeBackend = vi.fn(async () => {});

vi.mock("../../telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../telemetry")>()),
  telemetry: { track: vi.fn() },
}));
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
  ensurePlaywrightBrowsersInstalled: vi.fn(),
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
      "--preserve-hashes",
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
          preserveHashes: true,
        }),
      }),
    );
  });

  it("makes sure a browser is installed before it scrapes here", async () => {
    const parser = yargs().scriptName("test");
    createScrapeCommand(parser);

    await parser.parse(["scrape", "react", "https://react.dev"]);

    expect(ensurePlaywrightBrowsersInstalled).toHaveBeenCalled();
  });

  it("leaves the browser to the server it hands the scrape to", async () => {
    const parser = yargs().scriptName("test");
    createScrapeCommand(parser);

    await parser.parse([
      "scrape",
      "react",
      "https://react.dev",
      "--server-url",
      "http://localhost:8080/api",
    ]);

    expect(ensurePlaywrightBrowsersInstalled).not.toHaveBeenCalled();
  });

  it("sends only the host of the URL to telemetry", async () => {
    const parser = yargs().scriptName("test");
    createScrapeCommand(parser);

    await parser.parse([
      "scrape",
      "internal",
      "https://intranet.example.com/team/secret?q=1",
    ]);

    const [, properties] = vi.mocked(telemetry.track).mock.calls[0];
    expect(properties).toMatchObject({
      url: "intranet.example.com",
      urlProtocol: "https",
    });
    expect(JSON.stringify(properties)).not.toContain("secret");
  });
});
