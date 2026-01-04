/** Unit test for worker command */

import { beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs";
import * as appModule from "../../app";
import { createWorkerCommand } from "./worker";

const pipelineMock = {
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
};

// Mock startAppServer
vi.mock("../../app", () => ({
  startAppServer: vi.fn(async () => ({ shutdown: vi.fn() })),
}));

vi.mock("../../store", () => ({
  createLocalDocumentManagement: vi.fn(async () => ({ shutdown: vi.fn() })),
}));
vi.mock("../../pipeline", () => ({
  PipelineFactory: {
    createPipeline: vi.fn(async () => pipelineMock),
  },
}));
vi.mock("../../events", () => ({
  getEventBus: vi.fn(() => ({
    on: vi.fn(),
    emit: vi.fn(),
  })),
}));
vi.mock("../utils", () => ({
  getGlobalOptions: vi.fn(() => ({ storePath: undefined })),
  getEventBus: vi.fn(() => ({
    on: vi.fn(),
    emit: vi.fn(),
  })),
  resolveEmbeddingContext: vi.fn(() => ({ provider: "mock", model: "mock-model" })),
  validatePort: vi.fn((p) => parseInt(p || "8080", 10)),
  validateHost: vi.fn((h) => h || "127.0.0.1"),
  createAppServerConfig: vi.fn((config) => config),
  ensurePlaywrightBrowsersInstalled: vi.fn(),
  CliContext: {},
  setupLogging: vi.fn(),
}));
vi.mock("../../utils/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/config")>();
  return {
    ...actual,
    loadConfig: vi.fn(() => ({
      app: { embeddingModel: "mock-model", storePath: "/mock/store" },
      server: {
        ports: { worker: 8080 },
      },
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
// Mock main to avoid importing real code
vi.mock("../services", () => ({
  registerGlobalServices: vi.fn(),
}));

describe("worker command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock process.exit to avoid exiting test runner
    vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
  });

  it("starts worker server with correct config", async () => {
    const parser = yargs().scriptName("test");
    createWorkerCommand(parser);

    const services = await import("../services");
    // @ts-expect-error
    services.registerGlobalServices.mockImplementationOnce(() => {
      throw new Error("Simulated Stop");
    });

    try {
      await parser.parse(`worker --port 8080`);
    } catch (e: any) {
      if (e.message !== "Simulated Stop") throw e;
    }

    expect(appModule.startAppServer).toHaveBeenCalled();
    const callArgs = (appModule.startAppServer as any).mock.calls[0];
    const config = callArgs[3]; // 4th arg is config
    expect(config.enableWorker).toBe(true);
    expect(config.enableApiServer).toBe(true);
    expect(config.enableWebInterface).toBe(false);
    expect(config.port).toBe(8080);
  });
});
