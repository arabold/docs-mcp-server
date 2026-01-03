/** Unit test for mcp command */

import { beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs";
import * as appModule from "../../app";
import * as stdioModule from "../../mcp/startStdioServer";
import { createMcpCommand } from "./mcp";

const pipelineMock = {
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
};

// Mock startAppServer
vi.mock("../../app", () => ({
  startAppServer: vi.fn(async () => ({ shutdown: vi.fn() })),
}));
vi.mock("../../mcp/startStdioServer", () => ({
  startStdioServer: vi.fn(async () => ({})),
}));
vi.mock("../../mcp/tools", () => ({
  initializeTools: vi.fn(async () => []),
}));

vi.mock("../../store", () => ({
  createDocumentManagement: vi.fn(async () => ({ shutdown: vi.fn() })),
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
  validatePort: vi.fn((p) => parseInt(p || "6280", 10)),
  validateHost: vi.fn((h) => h || "127.0.0.1"),
  resolveProtocol: vi.fn((p) => p || "http"),
  parseAuthConfig: vi.fn(() => null),
  validateAuthConfig: vi.fn(),
  createAppServerConfig: vi.fn((config) => config),
  warnHttpUsage: vi.fn(),
  CliContext: {},
  setupLogging: vi.fn(),
  setLogLevel: vi.fn(),
}));
vi.mock("../../utils/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/config")>();
  return {
    ...actual,
    loadConfig: vi.fn(() => ({
      app: { embeddingModel: "mock-model", storePath: "/mock/store" },
      server: {
        ports: { mcp: 6280 },
      },
      auth: { enabled: false },
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
// Mock logger
vi.mock("../../utils/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  LogLevel: { ERROR: 0 },
  setLogLevel: vi.fn(),
}));
// Mock main to avoid importing real code
vi.mock("../services", () => ({
  registerGlobalServices: vi.fn(),
}));

describe("mcp command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
  });

  it("starts HTTP server when protocol is http", async () => {
    const parser = yargs().scriptName("test");
    createMcpCommand(parser);

    const services = await import("../services");
    // @ts-expect-error
    services.registerGlobalServices.mockImplementationOnce(() => {
      throw new Error("Simulated Stop");
    });

    // Mock resolveProtocol
    const utils = await import("../utils");
    // @ts-expect-error
    utils.resolveProtocol.mockReturnValueOnce("http");

    try {
      await parser.parse(`mcp --protocol http`);
    } catch (e: any) {
      if (e.message !== "Simulated Stop") throw e;
    }

    expect(appModule.startAppServer).toHaveBeenCalled();
    const callArgs = (appModule.startAppServer as any).mock.calls[0];
    const config = callArgs[3];
    expect(config.enableMcpServer).toBe(true);
    expect(config.enableWebInterface).toBe(false);
  });

  it("starts Stdio server when protocol is stdio", async () => {
    const parser = yargs().scriptName("test");
    createMcpCommand(parser);

    const services = await import("../services");
    // @ts-expect-error
    services.registerGlobalServices.mockImplementationOnce(() => {
      throw new Error("Simulated Stop");
    });

    // Mock resolveProtocol
    const utils = await import("../utils");
    // @ts-expect-error
    utils.resolveProtocol.mockReturnValueOnce("stdio");

    try {
      await parser.parse(`mcp --protocol stdio`);
    } catch (e: any) {
      if (e.message !== "Simulated Stop") throw e;
    }

    expect(stdioModule.startStdioServer).toHaveBeenCalled();
    expect(appModule.startAppServer).not.toHaveBeenCalled();
  });
});
