/** Unit test for scrapeAction */

import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScrapeTool } from "../../tools";

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
}));

import { scrapeAction } from "./scrape";

function cmd() {
  return new Command();
}
beforeEach(() => vi.clearAllMocks());

describe("scrapeAction", () => {
  it("starts pipeline and executes ScrapeTool", async () => {
    await scrapeAction(
      "react",
      "https://react.dev",
      {
        maxPages: "1",
        maxDepth: "1",
        maxConcurrency: "1",
        ignoreErrors: true,
        scope: "subpages",
        followRedirects: true,
        scrapeMode: "auto" as any,
        includePattern: [],
        excludePattern: [],
        header: [],
        serverUrl: undefined,
        embeddingModel: "mock-embedding-model",
      },
      cmd(),
    );
    expect(ScrapeTool).toHaveBeenCalledTimes(1);
    expect(pipelineMock.start).toHaveBeenCalledTimes(1);
    expect(pipelineMock.stop).toHaveBeenCalledTimes(1);
  });
});
