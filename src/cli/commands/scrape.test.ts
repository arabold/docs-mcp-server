/** Unit test for scrapeAction */

import { beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs";
import { ScrapeTool } from "../../tools";
import { createScrapeCommand } from "./scrape";

const pipelineMock = {
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
};

vi.mock("../../store", () => ({
  createDocumentManagement: vi.fn(async () => ({ shutdown: vi.fn() })),
}));
vi.mock("../../tools", () => ({
  ScrapeTool: vi
    .fn()
    .mockImplementation(() => ({ execute: vi.fn(async () => ({ jobId: "job-123" })) })),
}));
vi.mock("../../pipeline", () => ({
  PipelineFactory: {
    createPipeline: vi.fn(async () => pipelineMock),
  },
}));
vi.mock("../../events", () => ({
  EventBusService: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    emit: vi.fn(),
  })),
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

  it("starts pipeline and executes ScrapeTool", async () => {
    const parser = yargs().scriptName("test");
    createScrapeCommand(parser);

    await parser.parse([
      "scrape",
      "react",
      "https://react.dev",
      "--max-pages",
      "1",
      "--max-depth",
      "1",
      "--max-concurrency",
      "1",
      "--ignore-errors",
      "--scope",
      "subpages",
      "--follow-redirects",
      "--scrape-mode",
      "auto",
      "--embedding-model",
      "mock-embedding-model",
    ]);

    expect(ScrapeTool).toHaveBeenCalledTimes(1);
    expect(pipelineMock.start).toHaveBeenCalledTimes(1);
    expect(pipelineMock.stop).toHaveBeenCalledTimes(1);
  });
});
