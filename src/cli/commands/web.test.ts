/** Unit test for web command */

import { beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs";
import * as appModule from "../../app";
import { registerGlobalServices } from "../services";
import { createWebCommand } from "./web";

const pipelineMock = {};

// Mock startAppServer
vi.mock("../../app", () => ({
  startAppServer: vi.fn(async () => ({ shutdown: vi.fn() })),
}));

vi.mock("../../services/backend", () => ({
  openBackend: vi.fn(async (options: { serverUrl?: string }) => ({
    workerUrl: options.serverUrl,
    docService: {},
    pipeline: pipelineMock,
    eventBus: {},
    isWorkerConnected: undefined,
    close: vi.fn(),
  })),
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
  validatePort: vi.fn((p) => parseInt(p || "6281", 10)),
  validateHost: vi.fn((h) => h || "127.0.0.1"),
  createAppServerConfig: vi.fn((config) => config),
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
        ports: { web: 6281 },
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

describe("web command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock process.exit to avoid exiting test runner
    vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
  });

  // The only check that web leaves the MCP endpoint off; no E2E suite asks
  // the web command's server for /mcp.
  it("starts the web UI and the API without the MCP endpoint", async () => {
    const parser = yargs().scriptName("test");
    createWebCommand(parser);
    // The command waits forever once the server runs; stop it right there.
    // It reports the stop as a startup failure and resolves.
    vi.mocked(registerGlobalServices)
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error("Simulated Stop");
      });

    await parser.parse("web");

    expect(vi.mocked(appModule.startAppServer).mock.calls[0]?.[1]).toMatchObject({
      enableWebInterface: true,
      enableApiServer: true,
      enableMcpServer: false,
    });
  });
});
