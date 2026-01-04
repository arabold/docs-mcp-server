/**
 * CLI argument validation tests.
 * Tests that commands accept the correct arguments according to the CLI Commands and Arguments Matrix.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalDocumentManagement } from "../store";
import { resolveStorePath } from "../utils/paths";
import { createCli } from "./index";
import { resolveProtocol, validatePort, validateResumeFlag } from "./utils";

// Mocks for execution tests will be defined below in dedicated describe block

// Mock CLI utils early to prevent side effects (like Playwright installation)
vi.mock("./utils", async () => {
  const actual = await vi.importActual<any>("./utils");
  return {
    ...actual,
    ensurePlaywrightBrowsersInstalled: vi.fn(), // Mock to prevent side effects in tests
  };
});

vi.mock("../events", () => ({
  EventBusService: vi.fn().mockImplementation(() => ({
    emitter: {},
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  })),
}));

// Mock telemetry to prevent side effects and timeouts
vi.mock("../telemetry", async () => {
  return {
    initTelemetry: vi.fn(),
    shouldEnableTelemetry: vi.fn().mockReturnValue(false),
    TelemetryService: vi.fn().mockImplementation(() => ({
      shutdown: vi.fn(),
    })),
    telemetry: {
      isEnabled: vi.fn().mockReturnValue(false),
      setGlobalContext: vi.fn(),
      track: vi.fn(),
      shutdown: vi.fn(),
    },
    TelemetryEvent: {
      APP_STARTED: "app_started",
      APP_SHUTDOWN: "app_shutdown",
      CLI_COMMAND: "cli_command",
      TOOL_USED: "tool_used",
      PIPELINE_JOB_STARTED: "pipeline_job_started",
      PIPELINE_JOB_COMPLETED: "pipeline_job_completed",
      PIPELINE_JOB_FAILED: "pipeline_job_failed",
    },
  };
});

// --- Additional mocks for createPipelineWithCallbacks behavior tests ---
vi.mock("../pipeline/PipelineFactory", () => ({
  PipelineFactory: {
    createPipeline: vi.fn().mockResolvedValue({
      setCallbacks: vi.fn(),
      shutdown: vi.fn(),
      start: vi.fn(),
    }),
  },
}));

// --- Mocks & state for handler wiring regression (formerly commandHandlers.test.ts) ---
let capturedCreateArgs: any[] = [];
let listToolExecuteCalled = false;
vi.mock("../tools", async () => {
  const actual = await vi.importActual<any>("../tools");
  return {
    ...actual,
    ListLibrariesTool: vi.fn().mockImplementation(() => ({
      execute: vi.fn(async () => {
        listToolExecuteCalled = true;
        return { libraries: [] };
      }),
    })),
  };
});

// CLI Command Arguments Matrix tests removed as they relied on Commander-specific internal properties.
// Command configuration is now verified by individual command tests and Typescript validation.

describe("CLI command handler parameters", () => {
  beforeEach(() => {
    capturedCreateArgs = [];
    listToolExecuteCalled = false;
  });

  it("list command forwards --server-url and uses correct (options, command) signature", async () => {
    const program = createCli([]);
    const serverUrl = "http://example.com/api";

    await expect(
      program.parseAsync(["list", "--server-url", serverUrl]),
    ).resolves.not.toThrow();

    expect(capturedCreateArgs).toContainEqual(
      expect.objectContaining({
        eventBus: expect.any(Object),
        serverUrl,
        appConfig: expect.objectContaining({
          app: expect.objectContaining({ storePath: expect.any(String) }),
        }),
      }),
    );
    expect(listToolExecuteCalled).toBe(true);
  });
});

// Global mocks for the propagation tests - declared at module level
vi.mock("../utils/paths", () => ({
  resolveStorePath: vi.fn().mockReturnValue("/mocked/resolved/path"),
  getProjectRoot: vi.fn().mockReturnValue("/mocked/project/root"),
}));

vi.mock("../store", async () => {
  const actual = await vi.importActual<any>("../store");
  return {
    ...actual,
    createDocumentManagement: vi.fn(async (opts: any) => {
      capturedCreateArgs.push(opts);
      return { shutdown: vi.fn() } as any;
    }),
    createLocalDocumentManagement: vi.fn().mockResolvedValue({
      initialize: vi.fn(),
      shutdown: vi.fn(),
    }),
  };
});

vi.mock("../app", () => ({
  startAppServer: vi.fn().mockResolvedValue({
    shutdown: vi.fn(),
  }),
}));

vi.mock("../mcp/tools", () => ({
  initializeTools: vi.fn().mockResolvedValue({}),
}));

vi.mock("../mcp/startStdioServer", () => ({
  startStdioServer: vi.fn().mockResolvedValue({ shutdown: vi.fn() }),
}));

describe("Global option propagation", () => {
  let mockResolveStorePath: any;
  let mockCreateLocalDocumentManagement: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get references to the mocked functions
    mockResolveStorePath = vi.mocked(resolveStorePath);
    mockCreateLocalDocumentManagement = vi.mocked(createLocalDocumentManagement);
  });

  it("should pass --store-path through preAction hook to default command", async () => {
    const customStorePath = "/custom/data/path";
    const resolvedStorePath = "/resolved/custom/path";

    // Mock the path resolution to return a resolved path
    mockResolveStorePath.mockReturnValue(resolvedStorePath);

    const program = createCli([]);

    // Simulate running the default command with --store-path
    // Use --protocol http to get a random available port
    const _parsePromise = program.parseAsync([
      "--store-path",
      customStorePath,
      "--protocol",
      "http",
    ]);

    // Give it a moment to start and then verify the mocks were called
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify that resolveStorePath was called with the CLI option
    expect(mockResolveStorePath).toHaveBeenCalledWith(customStorePath);

    // Verify that createLocalDocumentManagement was called with the resolved path
    expect(mockCreateLocalDocumentManagement).toHaveBeenCalledWith(
      expect.objectContaining({
        emitter: expect.any(Object),
      }), // EventBusService instance
      expect.objectContaining({
        app: expect.objectContaining({ storePath: resolvedStorePath }),
      }),
    );

    // The parseAsync promise will hang since it starts a server, but we've verified our assertions
    // No need to wait for it to complete
  }, 10000);

  it("should handle DOCS_MCP_STORE_PATH environment variable through preAction hook", async () => {
    const envStorePath = "/env/data/path";
    const resolvedStorePath = "/resolved/env/path";

    // Set environment variable
    process.env.DOCS_MCP_STORE_PATH = envStorePath;

    // Mock the path resolution
    mockResolveStorePath.mockReturnValue(resolvedStorePath);

    const program = createCli([]);

    // Run default command without explicit --store-path
    // Use --protocol http to get a random available port
    const _parsePromise = program.parseAsync(["--protocol", "http"]);

    // Give it a moment to start and then verify the mocks were called
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify that resolveStorePath was called with the env var value
    expect(mockResolveStorePath).toHaveBeenCalledWith(envStorePath);

    // Verify that createLocalDocumentManagement was called with the resolved path
    expect(mockCreateLocalDocumentManagement).toHaveBeenCalledWith(
      expect.objectContaining({
        emitter: expect.any(Object),
      }), // EventBusService instance
      expect.objectContaining({
        app: expect.objectContaining({ storePath: resolvedStorePath }),
      }),
    );

    // Clean up
    delete process.env.DOCS_MCP_STORE_PATH;
  }, 10000);

  it("should pass --embedding-model through to document management", async () => {
    const embeddingModel = "openai:text-embedding-3-large";
    const resolvedStorePath = "/mocked/resolved/path";
    mockResolveStorePath.mockReturnValue(resolvedStorePath);

    const program = createCli([]);

    // Parse with embedding model flag
    const _parsePromise = program.parseAsync([
      "--embedding-model",
      embeddingModel,
      "--protocol",
      "http",
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockCreateLocalDocumentManagement).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        app: expect.objectContaining({
          storePath: resolvedStorePath,
          embeddingModel,
        }),
      }),
    );
  }, 10000);

  it("should pick up DOCS_MCP_EMBEDDING_MODEL environment variable", async () => {
    const envModel = "openai:text-embedding-ada-002";
    const resolvedStorePath = "/mocked/resolved/path";
    process.env.DOCS_MCP_EMBEDDING_MODEL = envModel;
    mockResolveStorePath.mockReturnValue(resolvedStorePath);

    const program = createCli([]);

    // Run without explicit --embedding-model
    const _parsePromise = program.parseAsync(["--protocol", "http"]);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockCreateLocalDocumentManagement).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        app: expect.objectContaining({
          storePath: resolvedStorePath,
          embeddingModel: envModel,
        }),
      }),
    );

    delete process.env.DOCS_MCP_EMBEDDING_MODEL;
  }, 10000);
});

describe("CLI Validation Logic", () => {
  describe("resolveProtocol", () => {
    it("should return explicit protocol values", () => {
      expect(resolveProtocol("stdio")).toBe("stdio");
      expect(resolveProtocol("http")).toBe("http");
    });

    it("should auto-detect stdio when no TTY", () => {
      // Mock no TTY environment (like CI/CD or VS Code)
      vi.stubGlobal("process", {
        ...process,
        stdin: { isTTY: false },
        stdout: { isTTY: false },
      });

      expect(resolveProtocol("auto")).toBe("stdio");
    });

    it("should auto-detect http when TTY is available", () => {
      // Mock TTY environment (like terminal)
      vi.stubGlobal("process", {
        ...process,
        stdin: { isTTY: true },
        stdout: { isTTY: true },
      });

      expect(resolveProtocol("auto")).toBe("http");
    });

    it("should throw on invalid protocol", () => {
      expect(() => resolveProtocol("invalid")).toThrow(
        "Invalid protocol: invalid. Must be 'auto', 'stdio', or 'http'",
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });
  });

  describe("validatePort", () => {
    it("should accept valid port numbers", () => {
      expect(validatePort("3000")).toBe(3000);
      expect(validatePort("8080")).toBe(8080);
      expect(validatePort("1")).toBe(1);
      expect(validatePort("65535")).toBe(65535);
    });

    it("should throw on clearly invalid port numbers", () => {
      expect(() => validatePort("0")).toThrow();
      expect(() => validatePort("65536")).toThrow();
      expect(() => validatePort("-1")).toThrow();
      expect(() => validatePort("abc")).toThrow();
      expect(() => validatePort("")).toThrow();
    });
  });

  describe("validateResumeFlag", () => {
    it("should allow resume without server URL", () => {
      expect(() => validateResumeFlag(true)).not.toThrow();
      expect(() => validateResumeFlag(true, undefined)).not.toThrow();
    });

    it("should allow no resume with server URL", () => {
      expect(() => validateResumeFlag(false, "http://example.com")).not.toThrow();
    });

    it("should throw when resume is used with server URL", () => {
      expect(() => validateResumeFlag(true, "http://example.com")).toThrow(
        "--resume flag is incompatible with --server-url. External workers handle their own job recovery.",
      );
    });
  });
});
