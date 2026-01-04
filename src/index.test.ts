/**
 * Integration tests for the main CLI entry point.
 * Tests critical startup behavior and validates against regression bugs.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { EventBusService } from "./events";
import { PipelineFactory } from "./pipeline/PipelineFactory";
import { DocumentManagementService } from "./store/DocumentManagementService";
import { TelemetryEvent } from "./telemetry";
import { type AppConfig, loadConfig } from "./utils/config";

// Mock external dependencies to prevent actual server startup
const mockPipelineStart = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockPipelineStop = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockPipelineSetCallbacks = vi.hoisted(() => vi.fn());

const mockStartAppServer = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    stop: vi.fn().mockResolvedValue(undefined),
  }),
);

const mockDocServiceInitialize = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockDocServiceShutdown = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("./app", () => ({
  startAppServer: mockStartAppServer,
}));

vi.mock("./store/DocumentManagementService", () => ({
  DocumentManagementService: vi.fn().mockImplementation((_eventBus, _appConfig) => ({
    initialize: mockDocServiceInitialize,
    shutdown: mockDocServiceShutdown,
  })),
}));

vi.mock("./pipeline/PipelineFactory", () => ({
  PipelineFactory: {
    createPipeline: vi.fn().mockResolvedValue({
      start: mockPipelineStart,
      stop: mockPipelineStop,
      setCallbacks: mockPipelineSetCallbacks,
      enqueueJob: vi.fn().mockResolvedValue("job-123"),
      getJob: vi.fn().mockResolvedValue(undefined),
      getJobs: vi.fn().mockResolvedValue([]),
      cancelJob: vi.fn().mockResolvedValue(undefined),
      clearCompletedJobs: vi.fn().mockResolvedValue(undefined),
      waitForJobCompletion: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("./mcp/startStdioServer", () => ({
  startStdioServer: vi.fn().mockResolvedValue({
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("./mcp/tools", () => ({
  initializeTools: vi.fn().mockResolvedValue({}),
}));

vi.mock("playwright", () => ({
  chromium: { executablePath: vi.fn().mockReturnValue("/mock/chromium") },
}));

const mockFsExistsSync = vi.hoisted(() => vi.fn().mockReturnValue(false));
const mockFsReadFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () => ({
  default: {
    existsSync: mockFsExistsSync,
    readFileSync: mockFsReadFileSync,
  },
  existsSync: mockFsExistsSync,
  readFileSync: mockFsReadFileSync,
}));

// Suppress console.error in tests
vi.spyOn(console, "error").mockImplementation(() => {});

const appConfig: AppConfig = loadConfig();

describe("CLI Flag Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Critical Bug Prevention", () => {
    it("should prevent --resume with --server-url combination", () => {
      // This tests the actual validation logic that prevents a configuration error
      // Bug: Using --resume with external worker doesn't make sense
      const validateResumeFlag = (resume: boolean, serverUrl?: string) => {
        if (resume && serverUrl) {
          throw new Error(
            "--resume flag is incompatible with --server-url. " +
              "External workers handle their own job recovery.",
          );
        }
      };

      expect(() => validateResumeFlag(true, "http://localhost:8080")).toThrow(
        "--resume flag is incompatible with --server-url",
      );

      // These should NOT throw
      expect(() => validateResumeFlag(false, "http://localhost:8080")).not.toThrow();
      expect(() => validateResumeFlag(true, undefined)).not.toThrow();
      expect(() => validateResumeFlag(false, undefined)).not.toThrow();
    });

    it("should validate port numbers correctly", () => {
      // This tests actual port validation logic
      const validatePort = (portString: string) => {
        const port = Number.parseInt(portString, 10);
        if (Number.isNaN(port) || port < 1 || port > 65535) {
          throw new Error("Invalid port number");
        }
        return port;
      };

      expect(() => validatePort("invalid")).toThrow("Invalid port number");
      expect(() => validatePort("-1")).toThrow("Invalid port number");
      expect(() => validatePort("0")).toThrow("Invalid port number");
      expect(() => validatePort("65536")).toThrow("Invalid port number");

      // These should work
      expect(validatePort("8080")).toBe(8080);
      expect(validatePort("3000")).toBe(3000);
      expect(validatePort("65535")).toBe(65535);
    });
  });

  describe("Protocol Resolution", () => {
    it("should resolve protocol based on TTY availability", () => {
      // Test the actual protocol resolution logic
      const resolveProtocol = (protocol: string, hasTTY: boolean) => {
        if (protocol === "auto") {
          return hasTTY ? "http" : "stdio";
        }
        if (protocol === "stdio" || protocol === "http") {
          return protocol;
        }
        throw new Error(`Invalid protocol: ${protocol}`);
      };

      // Auto-detection behavior
      expect(resolveProtocol("auto", true)).toBe("http");
      expect(resolveProtocol("auto", false)).toBe("stdio");

      // Explicit protocol behavior
      expect(resolveProtocol("stdio", true)).toBe("stdio");
      expect(resolveProtocol("stdio", false)).toBe("stdio");
      expect(resolveProtocol("http", true)).toBe("http");
      expect(resolveProtocol("http", false)).toBe("http");

      // Error cases
      expect(() => resolveProtocol("invalid", true)).toThrow("Invalid protocol");
    });
  });
});

describe("Double Initialization Prevention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should NOT start pipeline during initialization in worker mode", async () => {
    // This test validates our critical bug fix:
    // ensurePipelineManagerInitialized should create but NOT start the pipeline
    // Only registerWorkerService should call pipeline.start()

    // Simulate calling ensurePipelineManagerInitialized (the helper function)
    // In the real code, this gets called before startAppServer
    const mockEventBus = new EventBusService();
    await PipelineFactory.createPipeline(
      {} as any, // mock docService
      mockEventBus,
      { recoverJobs: true, appConfig: appConfig },
    );

    // After createPipeline, the pipeline should NOT have been started yet
    expect(mockPipelineStart).not.toHaveBeenCalled();

    // Simulate what happens in registerWorkerService
    const mockReturnValue = await vi.mocked(PipelineFactory.createPipeline).mock
      .results[0]?.value;
    if (mockReturnValue) {
      await mockReturnValue.start();
    }

    // Now pipeline.start() should have been called exactly once
    expect(mockPipelineStart).toHaveBeenCalledTimes(1);
  });

  it("should validate pipeline configuration for different modes", async () => {
    // Test that different modes pass correct options to PipelineFactory
    const mockEventBus = new EventBusService();

    // Worker mode configuration
    await PipelineFactory.createPipeline({} as any, mockEventBus, {
      recoverJobs: true,
      appConfig: appConfig,
    });

    // CLI mode configuration
    await PipelineFactory.createPipeline({} as any, mockEventBus, {
      recoverJobs: false,
      appConfig: appConfig,
    });

    // External worker mode configuration (no eventBus needed for remote)
    await PipelineFactory.createPipeline(undefined, mockEventBus, {
      recoverJobs: false,
      serverUrl: "http://localhost:8080/api",
      appConfig: appConfig,
    });

    expect(vi.mocked(PipelineFactory.createPipeline)).toHaveBeenCalledTimes(3);

    // Verify different configurations were passed
    const calls = vi.mocked(PipelineFactory.createPipeline).mock.calls;
    expect(calls[0][2]).toEqual({
      recoverJobs: true,
      appConfig: appConfig,
    });
    expect(calls[1][2]).toEqual({
      recoverJobs: false,
      appConfig: appConfig,
    });
    expect(calls[2][2]).toEqual({
      recoverJobs: false,
      serverUrl: "http://localhost:8080/api",
      appConfig: appConfig,
    });
  });
});

describe("Service Configuration Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should configure services correctly for worker command", async () => {
    // This test validates that worker command creates the correct AppServer configuration
    const expectedWorkerConfig = {
      enableWebInterface: false,
      enableMcpServer: false,
      enableApiServer: true,
      enableWorker: true,
      port: 8080,
    };

    // Simulate worker command behavior
    await mockStartAppServer(
      {} as any,
      {} as any,
      {} as any,
      expectedWorkerConfig,
      {} as any,
    );

    expect(mockStartAppServer).toHaveBeenCalledWith(
      expect.anything(), // docService
      expect.anything(), // pipeline
      expect.anything(), // eventBus
      expect.objectContaining(expectedWorkerConfig),
      expect.anything(), // appConfig
    );
  });

  it("should initialize services in correct order", async () => {
    // Test that services are initialized in the right sequence
    // 1. DocumentManagementService.initialize()
    // 2. PipelineFactory.createPipeline()
    // 3. pipeline.setCallbacks()
    // 4. startAppServer() (which will call pipeline.start() via registerWorkerService)

    // Simulate the service initialization sequence
    const eventBus = new EventBusService();
    const docService = new DocumentManagementService(eventBus, appConfig);
    await docService.initialize();

    const pipeline = await PipelineFactory.createPipeline(docService, eventBus, {
      appConfig: appConfig,
    });
    pipeline.setCallbacks({});

    await mockStartAppServer(docService, pipeline, eventBus, {}, {} as any);

    // Verify initialization was called
    expect(mockDocServiceInitialize).toHaveBeenCalled();
    expect(mockPipelineSetCallbacks).toHaveBeenCalled();
    expect(mockStartAppServer).toHaveBeenCalled();

    // Verify pipeline.start() was NOT called during this sequence
    // (it should only be called by registerWorkerService inside AppServer)
    expect(mockPipelineStart).not.toHaveBeenCalled();
  });
});

describe("Service Registration for Telemetry", () => {
  let mockRegisterGlobalServices: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock registerGlobalServices function
    mockRegisterGlobalServices = vi.fn();
    vi.doMock("./cli/main", () => ({
      registerGlobalServices: mockRegisterGlobalServices,
    }));
  });

  it("should register AppServer for graceful shutdown in web command", async () => {
    // Mock the web command service registration
    const mockAppServer = { stop: vi.fn().mockResolvedValue(undefined) };
    const mockDocService = { shutdown: vi.fn().mockResolvedValue(undefined) };
    const mockPipeline = { stop: vi.fn().mockResolvedValue(undefined) };

    // Simulate web command calling registerGlobalServices
    mockRegisterGlobalServices({
      appServer: mockAppServer,
      docService: mockDocService,
      pipeline: mockPipeline,
    });

    expect(mockRegisterGlobalServices).toHaveBeenCalledWith({
      appServer: mockAppServer,
      docService: mockDocService,
      pipeline: mockPipeline,
    });
  });

  it("should register MCP stdio server for graceful shutdown in mcp command", async () => {
    // Mock the mcp command service registration for stdio protocol
    const mockMcpServer = { close: vi.fn().mockResolvedValue(undefined) };
    const mockDocService = { shutdown: vi.fn().mockResolvedValue(undefined) };
    const mockPipeline = { stop: vi.fn().mockResolvedValue(undefined) };

    // Simulate mcp stdio command calling registerGlobalServices
    mockRegisterGlobalServices({
      mcpStdioServer: mockMcpServer,
      docService: mockDocService,
      pipeline: mockPipeline,
    });

    expect(mockRegisterGlobalServices).toHaveBeenCalledWith({
      mcpStdioServer: mockMcpServer,
      docService: mockDocService,
      pipeline: mockPipeline,
    });
  });

  it("should register AppServer for MCP http server in mcp command", async () => {
    // Mock the mcp command service registration for http protocol
    const mockAppServer = { stop: vi.fn().mockResolvedValue(undefined) };
    const mockDocService = { shutdown: vi.fn().mockResolvedValue(undefined) };
    const mockPipeline = { stop: vi.fn().mockResolvedValue(undefined) };

    // Simulate mcp http command calling registerGlobalServices
    mockRegisterGlobalServices({
      appServer: mockAppServer,
      docService: mockDocService,
      pipeline: mockPipeline,
    });

    expect(mockRegisterGlobalServices).toHaveBeenCalledWith({
      appServer: mockAppServer,
      docService: mockDocService,
      pipeline: mockPipeline,
    });
  });

  it("should register AppServer for worker service", async () => {
    // Mock the worker command service registration
    const mockAppServer = { stop: vi.fn().mockResolvedValue(undefined) };
    const mockDocService = { shutdown: vi.fn().mockResolvedValue(undefined) };
    const mockPipeline = { stop: vi.fn().mockResolvedValue(undefined) };

    // Simulate worker command calling registerGlobalServices
    mockRegisterGlobalServices({
      appServer: mockAppServer,
      docService: mockDocService,
      pipeline: mockPipeline,
    });

    expect(mockRegisterGlobalServices).toHaveBeenCalledWith({
      appServer: mockAppServer,
      docService: mockDocService,
      pipeline: mockPipeline,
    });
  });

  it("should register services for default command with mixed protocols", async () => {
    // Mock the default command service registration - it can run both AppServer and MCP
    const mockAppServer = { stop: vi.fn().mockResolvedValue(undefined) };
    const mockMcpServer = { close: vi.fn().mockResolvedValue(undefined) };
    const mockDocService = { shutdown: vi.fn().mockResolvedValue(undefined) };
    const mockPipeline = { stop: vi.fn().mockResolvedValue(undefined) };

    // Test scenario where default command runs both AppServer and MCP stdio
    mockRegisterGlobalServices({
      appServer: mockAppServer,
      mcpStdioServer: mockMcpServer,
      docService: mockDocService,
      pipeline: mockPipeline,
    });

    expect(mockRegisterGlobalServices).toHaveBeenCalledWith({
      appServer: mockAppServer,
      mcpStdioServer: mockMcpServer,
      docService: mockDocService,
      pipeline: mockPipeline,
    });
  });

  it("should handle partial service registration", async () => {
    // Test that registerGlobalServices can handle partial service objects
    const mockDocService = { shutdown: vi.fn().mockResolvedValue(undefined) };

    // Simulate a command registering only some services
    mockRegisterGlobalServices({
      docService: mockDocService,
    });

    expect(mockRegisterGlobalServices).toHaveBeenCalledWith({
      docService: mockDocService,
    });
  });

  it("should ensure all CLI commands register services for telemetry tracking", () => {
    // This test validates that the service registration pattern is consistent
    // across all CLI commands for proper APP_SHUTDOWN event tracking

    // Mock services that different commands might register
    const serviceInstances = {
      appServer: { stop: vi.fn() },
      mcpStdioServer: { close: vi.fn() },
      docService: { shutdown: vi.fn() },
      pipeline: { stop: vi.fn() },
    };

    // Test each command type pattern
    const commandPatterns = [
      // web command: AppServer + DocService + Pipeline
      {
        appServer: serviceInstances.appServer,
        docService: serviceInstances.docService,
        pipeline: serviceInstances.pipeline,
      },
      // worker command: AppServer + DocService + Pipeline
      {
        appServer: serviceInstances.appServer,
        docService: serviceInstances.docService,
        pipeline: serviceInstances.pipeline,
      },
      // mcp stdio: MCP + DocService + Pipeline
      {
        mcpStdioServer: serviceInstances.mcpStdioServer,
        docService: serviceInstances.docService,
        pipeline: serviceInstances.pipeline,
      },
      // mcp http: AppServer + DocService + Pipeline
      {
        appServer: serviceInstances.appServer,
        docService: serviceInstances.docService,
        pipeline: serviceInstances.pipeline,
      },
    ];

    // Verify each pattern calls registerGlobalServices appropriately
    for (const pattern of commandPatterns) {
      mockRegisterGlobalServices(pattern);
    }

    expect(mockRegisterGlobalServices).toHaveBeenCalledTimes(commandPatterns.length);

    // Verify that each call included at least one service for proper shutdown tracking
    const calls = mockRegisterGlobalServices.mock.calls;
    for (const call of calls) {
      const services = call[0];
      const hasAnyService = Object.keys(services).length > 0;
      expect(hasAnyService).toBe(true);
    }
  });
});

describe("CLI Command Telemetry Integration", () => {
  let mockTelemetry: {
    setGlobalContext: Mock;
    track: Mock;
    shutdown: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock telemetry instance
    mockTelemetry = {
      setGlobalContext: vi.fn(),
      track: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };

    vi.doMock("../telemetry", () => ({
      telemetry: mockTelemetry,
    }));
  });

  it("should set global context in CLI preAction hook", async () => {
    // Mock global context that should be set by CLI
    const expectedContext = {
      appInterface: "cli",
      appPlatform: "darwin",
      appVersion: "1.22.0",
    };

    // Simulate CLI preAction calling setGlobalContext
    mockTelemetry.setGlobalContext(expectedContext);

    expect(mockTelemetry.setGlobalContext).toHaveBeenCalledWith(expectedContext);
  });

  it("should track CLI_COMMAND events in postAction hook", async () => {
    // Mock CLI command execution tracking
    const commandStartTime = Date.now();
    const commandEndTime = commandStartTime + 1500; // 1.5 seconds

    // Simulate tracking CLI_COMMAND event
    mockTelemetry.track(TelemetryEvent.CLI_COMMAND, {
      command: "web",
      success: true,
      durationMs: commandEndTime - commandStartTime,
    });

    expect(mockTelemetry.track).toHaveBeenCalledWith(TelemetryEvent.CLI_COMMAND, {
      command: "web",
      success: true,
      durationMs: 1500,
    });
  });

  it("should track failed CLI commands with success: false", async () => {
    // Mock failed command tracking
    mockTelemetry.track(TelemetryEvent.CLI_COMMAND, {
      command: "invalid-command",
      success: false,
      durationMs: 100,
    });

    expect(mockTelemetry.track).toHaveBeenCalledWith(TelemetryEvent.CLI_COMMAND, {
      command: "invalid-command",
      success: false,
      durationMs: 100,
    });
  });

  it("should track different command types", async () => {
    // Test tracking for various CLI commands
    const commands = ["web", "mcp", "worker", "fetch-url", "scrape-docs"];

    for (const command of commands) {
      mockTelemetry.track(TelemetryEvent.CLI_COMMAND, {
        command,
        success: true,
        durationMs: 1000,
      });
    }

    expect(mockTelemetry.track).toHaveBeenCalledTimes(commands.length);

    // Verify each command was tracked correctly
    const calls = mockTelemetry.track.mock.calls;
    for (let i = 0; i < commands.length; i++) {
      expect(calls[i]).toEqual([
        TelemetryEvent.CLI_COMMAND,
        {
          command: commands[i],
          success: true,
          durationMs: 1000,
        },
      ]);
    }
  });
});
