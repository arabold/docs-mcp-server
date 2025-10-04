/** Unit test for scrapeAction */

import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("../utils", () => ({
  createPipelineWithCallbacks: vi.fn(async () => pipelineMock),
  getGlobalOptions: vi.fn(() => ({ storePath: undefined })),
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
    const { ScrapeTool } = await import("../../tools");
    expect(ScrapeTool).toHaveBeenCalledTimes(1);
    expect(pipelineMock.start).toHaveBeenCalledTimes(1);
    expect(pipelineMock.stop).toHaveBeenCalledTimes(1);
  });
});
