/** Unit test for refresh command */

import { beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs";
import { RefreshVersionTool } from "../../tools/RefreshVersionTool";
import { createRefreshCommand } from "./refresh";

const pipelineMock = {
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
};

vi.mock("../../store", () => ({
  createDocumentManagement: vi.fn(async () => ({ shutdown: vi.fn() })),
}));
vi.mock("../../tools/RefreshVersionTool", () => ({
  RefreshVersionTool: vi
    .fn()
    .mockImplementation(() => ({ execute: vi.fn(async () => ({ pagesRefreshed: 5 })) })),
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
    })),
  };
});
// Mock telemetry
vi.mock("../../telemetry", () => ({
  telemetry: {
    track: vi.fn(),
  },
  TelemetryEvent: {
    CLI_COMMAND: "CLI_COMMAND",
  },
}));

describe("refresh command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts pipeline and executes RefreshVersionTool", async () => {
    const parser = yargs().scriptName("test");
    createRefreshCommand(parser);

    await parser.parse(`refresh react --version 18.0.0 --embedding-model mock-model`);

    expect(RefreshVersionTool).toHaveBeenCalledTimes(1);
    expect(pipelineMock.start).toHaveBeenCalledTimes(1);
    expect(pipelineMock.stop).toHaveBeenCalledTimes(1);
  });
});
