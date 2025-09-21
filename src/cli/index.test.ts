/**
 * CLI argument validation tests.
 * Tests that commands accept the correct arguments according to the CLI Commands and Arguments Matrix.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCliProgram } from "./index";
import {
  resolveEmbeddingContext,
  resolveProtocol,
  validatePort,
  validateResumeFlag,
} from "./utils";

// Mocks for execution tests will be defined below in dedicated describe block
vi.mock("../utils/logger");

// --- Additional mocks for createPipelineWithCallbacks behavior tests ---
vi.mock("../pipeline/PipelineFactory", () => ({
  PipelineFactory: {
    createPipeline: vi.fn(),
  },
}));

// --- Mocks & state for handler wiring regression (formerly commandHandlers.test.ts) ---
let capturedCreateArgs: any[] = [];
let listToolExecuteCalled = false;
vi.mock("../store", async () => {
  const actual = await vi.importActual<any>("../store");
  return {
    ...actual,
    createDocumentManagement: vi.fn(async (opts: any) => {
      capturedCreateArgs.push(opts);
      return { shutdown: vi.fn() } as any;
    }),
  };
});
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

describe("CLI Command Arguments Matrix", () => {
  const program = createCliProgram();

  // Extract command options for easier testing
  const getCommandOptions = (commandName?: string) => {
    if (!commandName) {
      // Main program options (default action)
      return program.options.map((opt) => opt.long);
    }

    const command = program.commands.find((cmd) => cmd.name() === commandName);
    return command?.options.map((opt) => opt.long) || [];
  };

  // Test that embedding-model option is available on commands that require embeddings
  describe("embedding-model option availability", () => {
    const commandMatrix = {
      default: true,
      mcp: true,
      web: true,
      worker: true,
      scrape: true,
      search: true,
      list: false,
      remove: false,
      "find-version": false,
      "fetch-url": false,
    };

    Object.entries(commandMatrix).forEach(([commandName, shouldHaveEmbeddingOption]) => {
      it(`${commandName} command should ${shouldHaveEmbeddingOption ? "have" : "not have"} --embedding-model option`, () => {
        const options = getCommandOptions(
          commandName === "default" ? undefined : commandName,
        );

        if (shouldHaveEmbeddingOption) {
          expect(options).toContain("--embedding-model");
        } else {
          expect(options).not.toContain("--embedding-model");
        }
      });
    });
  });

  // Test the CLI Commands and Arguments Matrix
  const commandMatrix = {
    default: {
      hasVerboseSilent: true,
      hasPort: true,
      hasServerUrl: false, // Default action doesn't have server-url
      hasProtocol: true,
      hasResume: true,
      hasReadOnly: true,
      requiresEmbedding: true, // Default action starts servers that need search capability
    },
    mcp: {
      hasVerboseSilent: true,
      hasPort: true,
      hasServerUrl: true,
      hasProtocol: true,
      hasResume: false,
      hasReadOnly: true,
      requiresEmbedding: true, // MCP server provides search tools
    },
    web: {
      hasVerboseSilent: true,
      hasPort: true,
      hasServerUrl: true,
      hasProtocol: false,
      hasResume: false,
      hasReadOnly: false,
      requiresEmbedding: true, // Web interface has search functionality
    },
    worker: {
      hasVerboseSilent: true,
      hasPort: true,
      hasServerUrl: false,
      hasProtocol: false,
      hasResume: true,
      hasReadOnly: false,
      requiresEmbedding: true, // Worker handles scraping/indexing and search
    },
    scrape: {
      hasVerboseSilent: true,
      hasPort: false,
      hasServerUrl: true,
      hasProtocol: false,
      hasResume: false,
      hasReadOnly: false,
      requiresEmbedding: true, // Scrape needs embeddings for indexing
    },
    search: {
      hasVerboseSilent: true,
      hasPort: false,
      hasServerUrl: true,
      hasProtocol: false,
      hasResume: false,
      hasReadOnly: false,
      requiresEmbedding: true, // Search explicitly needs embeddings
    },
    list: {
      hasVerboseSilent: true,
      hasPort: false,
      hasServerUrl: true,
      hasProtocol: false,
      hasResume: false,
      hasReadOnly: false,
      requiresEmbedding: false, // List only queries metadata, no embeddings needed
    },
    remove: {
      hasVerboseSilent: true,
      hasPort: false,
      hasServerUrl: true,
      hasProtocol: false,
      hasResume: false,
      hasReadOnly: false,
      requiresEmbedding: false, // Remove only deletes records, no embeddings needed
    },
    "find-version": {
      hasVerboseSilent: true,
      hasPort: false,
      hasServerUrl: true,
      hasProtocol: false,
      hasResume: false,
      hasReadOnly: false,
      requiresEmbedding: false, // Find-version only queries metadata, no embeddings needed
    },
    "fetch-url": {
      hasVerboseSilent: true,
      hasPort: false,
      hasServerUrl: false,
      hasProtocol: false,
      hasResume: false,
      hasReadOnly: false,
      requiresEmbedding: false, // Fetch-url is standalone, doesn't use document store
    },
  };

  // Test each command according to the matrix
  Object.entries(commandMatrix).forEach(([commandName, expectedOptions]) => {
    it(`should have correct options for ${commandName} command`, () => {
      const options = getCommandOptions(
        commandName === "default" ? undefined : commandName,
      );

      // Global options (--verbose/--silent) are inherited for all commands
      if (expectedOptions.hasVerboseSilent && commandName !== "default") {
        // For subcommands, global options are available through parent
        const globalOptions = program.options.map((opt) => opt.long);
        expect(globalOptions).toContain("--verbose");
        expect(globalOptions).toContain("--silent");
      } else if (commandName === "default") {
        expect(options).toContain("--verbose");
        expect(options).toContain("--silent");
      }

      // Test specific options
      if (expectedOptions.hasPort) {
        expect(options).toContain("--port");
      } else {
        expect(options).not.toContain("--port");
      }

      if (expectedOptions.hasServerUrl) {
        expect(options).toContain("--server-url");
      } else {
        expect(options).not.toContain("--server-url");
      }

      if (expectedOptions.hasProtocol) {
        expect(options).toContain("--protocol");
      } else {
        expect(options).not.toContain("--protocol");
      }

      if (expectedOptions.hasResume) {
        expect(options).toContain("--resume");
      } else {
        expect(options).not.toContain("--resume");
      }

      if (expectedOptions.hasReadOnly) {
        expect(options).toContain("--read-only");
      } else {
        expect(options).not.toContain("--read-only");
      }
    });
  });

  it("should register all expected commands", () => {
    const commandNames = program.commands.map((cmd) => cmd.name());
    expect(commandNames).toEqual([
      "mcp",
      "web",
      "worker",
      "scrape",
      "search",
      "list",
      "find-version",
      "remove",
      "fetch-url",
    ]);
  });
});

describe("createPipelineWithCallbacks behavior", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("attaches callbacks for local pipeline and throws when docService missing", async () => {
    const { createPipelineWithCallbacks } = await import("./utils");
    const { PipelineFactory } = await import("../pipeline/PipelineFactory");
    const mockSetCallbacks = vi.fn();

    // Local path requires a DocumentManagementService instance
    await expect(createPipelineWithCallbacks(undefined as any, {})).rejects.toThrow(
      "Local pipeline requires a DocumentManagementService instance",
    );

    // Provide a fake docService and ensure callbacks are wired
    vi.mocked(PipelineFactory.createPipeline).mockResolvedValueOnce({
      setCallbacks: mockSetCallbacks,
    } as any);

    const fakeDocService = {} as any;
    const pipeline = await createPipelineWithCallbacks(fakeDocService, {
      concurrency: 2,
    });

    expect(PipelineFactory.createPipeline).toHaveBeenCalledWith(fakeDocService, {
      concurrency: 2,
    });
    expect(mockSetCallbacks).toHaveBeenCalledWith(
      expect.objectContaining({
        onJobProgress: expect.any(Function),
        onJobStatusChange: expect.any(Function),
        onJobError: expect.any(Function),
      }),
    );
    expect(pipeline).toBeDefined();
  });

  it("creates remote pipeline when serverUrl is provided and attaches callbacks", async () => {
    const { createPipelineWithCallbacks } = await import("./utils");
    const { PipelineFactory } = await import("../pipeline/PipelineFactory");
    const mockSetCallbacks = vi.fn();

    vi.mocked(PipelineFactory.createPipeline).mockResolvedValueOnce({
      setCallbacks: mockSetCallbacks,
    } as any);

    const pipeline = await createPipelineWithCallbacks(undefined, {
      serverUrl: "http://localhost:8080",
      concurrency: 1,
    });

    expect(PipelineFactory.createPipeline).toHaveBeenCalledWith(undefined, {
      serverUrl: "http://localhost:8080",
      concurrency: 1,
    });
    expect(mockSetCallbacks).toHaveBeenCalledWith(
      expect.objectContaining({
        onJobProgress: expect.any(Function),
        onJobStatusChange: expect.any(Function),
        onJobError: expect.any(Function),
      }),
    );
    expect(pipeline).toBeDefined();
  });
});

describe("CLI command handler parameters (regression)", () => {
  beforeEach(() => {
    capturedCreateArgs = [];
    listToolExecuteCalled = false;
  });

  it("list command forwards --server-url and uses correct (options, command) signature", async () => {
    const { createCliProgram } = await import("./index");
    const program = createCliProgram();
    const serverUrl = "http://example.com/api";

    await expect(
      program.parseAsync(["node", "test", "list", "--server-url", serverUrl]),
    ).resolves.not.toThrow();

    expect(capturedCreateArgs).toContainEqual({ serverUrl });
    expect(listToolExecuteCalled).toBe(true);
  });
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

  describe("resolveEmbeddingContext", () => {
    afterEach(() => {
      // Clean up environment after each test
      delete process.env.DOCS_MCP_EMBEDDING_MODEL;
      delete process.env.OPENAI_API_KEY;
    });

    it("should return null when no embedding model is configured and no OPENAI_API_KEY", () => {
      // Ensure no env vars are set
      delete process.env.DOCS_MCP_EMBEDDING_MODEL;
      delete process.env.OPENAI_API_KEY;
      const result = resolveEmbeddingContext();
      expect(result).toBeNull();
    });

    it("should return default config when OPENAI_API_KEY is present but no embedding model specified", () => {
      // Ensure no embedding model env var is set, but OPENAI_API_KEY is present
      delete process.env.DOCS_MCP_EMBEDDING_MODEL;
      process.env.OPENAI_API_KEY = "test-key";
      const result = resolveEmbeddingContext();
      expect(result).toMatchObject({
        provider: "openai",
        model: "text-embedding-3-small", // Default fallback
      });
    });

    it("should return config when embedding model is configured via environment", () => {
      process.env.DOCS_MCP_EMBEDDING_MODEL = "openai:text-embedding-ada-002";
      // The function now checks for OPENAI_API_KEY when using OpenAI models
      process.env.OPENAI_API_KEY = "test-key";
      const result = resolveEmbeddingContext();
      expect(result).toMatchObject({
        provider: "openai",
        model: "text-embedding-3-small",
      });
    });

    it("should prioritize CLI args over environment variables", () => {
      process.env.DOCS_MCP_EMBEDDING_MODEL = "openai:text-embedding-ada-002";
      const result = resolveEmbeddingContext("openai:text-embedding-3-small");
      expect(result).toMatchObject({
        provider: "openai",
        model: "text-embedding-3-small",
      });
    });
  });
});
