/** Unit test for mcp command */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs";
import * as appModule from "../../app";
import * as stdioModule from "../../mcp/startStdioServer";
import { TelemetryEvent, telemetry } from "../../telemetry";
import type { AppConfig } from "../../utils/config";
import { loadConfig } from "../../utils/config";
import * as services from "../services";
import * as utils from "../utils";
import { createMcpCommand } from "./mcp";

const pipelineMock = {};

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
  validatePort: vi.fn((p) => parseInt(p || "6280", 10)),
  validateHost: vi.fn((h) => h || "127.0.0.1"),
  resolveProtocol: vi.fn((p) => p || "http"),
  checkAuthForProtocol: vi.fn(),
  createAppServerConfig: vi.fn((config) => config),
  handleEmbeddingModelChange: vi.fn(),
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
// Mock main to avoid importing real code
vi.mock("../services", () => ({
  registerGlobalServices: vi.fn(),
}));

/** Environment variables that could set the settings under test. */
const PRECEDENCE_ENV = [
  "DOCS_MCP_CONFIG",
  "DOCS_MCP_PROTOCOL",
  "DOCS_MCP_SERVER_PROTOCOL",
  "DOCS_MCP_READ_ONLY",
  "DOCS_MCP_APP_READ_ONLY",
  "DOCS_MCP_AUTH_ENABLED",
  "DOCS_MCP_AUTH_ISSUER_URL",
  "DOCS_MCP_AUTH_AUDIENCE",
];

describe("mcp command configuration precedence", () => {
  const savedEnv = new Map<string, string | undefined>();
  const savedTty = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY };
  let tempDir = "";

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    for (const name of PRECEDENCE_ENV) {
      savedEnv.set(name, process.env[name]);
      delete process.env[name];
    }
    tempDir = mkdtempSync(path.join(tmpdir(), "mcp-precedence-"));

    // Run the real loader, protocol resolution and auth check; only the
    // servers stay mocked.
    const actualConfig =
      await vi.importActual<typeof import("../../utils/config")>("../../utils/config");
    vi.mocked(loadConfig).mockImplementationOnce(actualConfig.loadConfig);
    const actualUtils = await vi.importActual<typeof import("../utils")>("../utils");
    vi.mocked(utils.resolveProtocol).mockImplementationOnce(actualUtils.resolveProtocol);
    vi.mocked(utils.checkAuthForProtocol).mockImplementationOnce(
      actualUtils.checkAuthForProtocol,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [name, value] of savedEnv) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    process.stdin.isTTY = savedTty.stdin;
    process.stdout.isTTY = savedTty.stdout;
    rmSync(tempDir, { recursive: true, force: true });
  });

  /** Parses `args` with `--config` pointed at a file holding `configYaml`. */
  async function run(args: string, configYaml = ""): Promise<void> {
    const configPath = path.join(tempDir, "config.yaml");
    writeFileSync(configPath, configYaml);
    // Strict, so an option the command does not declare fails the run.
    // --config is a global option, declared here the way the CLI does.
    const parser = yargs()
      .scriptName("test")
      .option("config", { type: "string" })
      .strict();
    createMcpCommand(parser);
    vi.mocked(services.registerGlobalServices)
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error("Simulated Stop");
      });
    try {
      await parser.parse(`${args} --config ${configPath}`);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "Simulated Stop") {
        throw error;
      }
    }
  }

  function httpAppConfig(): AppConfig {
    expect(appModule.startAppServer).toHaveBeenCalledTimes(1);
    return vi.mocked(appModule.startAppServer).mock.calls[0][2];
  }

  function stdioAppConfig(): AppConfig {
    expect(stdioModule.startStdioServer).toHaveBeenCalledTimes(1);
    return vi.mocked(stdioModule.startStdioServer).mock.calls[0][1];
  }

  function withoutTerminal(): void {
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
  }

  it("keeps auth enabled from the environment when --auth-enabled is omitted", async () => {
    process.env.DOCS_MCP_AUTH_ENABLED = "true";
    process.env.DOCS_MCP_AUTH_ISSUER_URL = "https://issuer.example.com";

    await run("mcp --protocol http");

    expect(httpAppConfig().auth.enabled).toBe(true);
    expect(telemetry.track).toHaveBeenCalledWith(
      TelemetryEvent.CLI_COMMAND,
      expect.objectContaining({ authEnabled: true, protocol: "http" }),
    );
  });

  it("serves HTTP when the environment selects it and --protocol is omitted", async () => {
    process.env.DOCS_MCP_PROTOCOL = "http";
    withoutTerminal();

    await run("mcp");

    expect(stdioModule.startStdioServer).not.toHaveBeenCalled();
    expect(appModule.startAppServer).toHaveBeenCalledTimes(1);
    // The MCP endpoint only, without the web UI
    expect(vi.mocked(appModule.startAppServer).mock.calls[0][1]).toMatchObject({
      enableMcpServer: true,
      enableWebInterface: false,
    });
  });

  it("reads the server identity flags", async () => {
    await run(
      `mcp --protocol stdio --server-name acme-docs --server-title "Acme Docs" --server-instructions "Use acme docs" --server-instructions-file /tmp/acme.md`,
    );

    expect(stdioAppConfig().server).toMatchObject({
      name: "acme-docs",
      title: "Acme Docs",
      instructions: "Use acme docs",
      instructionsFile: "/tmp/acme.md",
    });
  });

  it("serves stdio with auth enabled, warning that auth does not apply", async () => {
    // An HTTP issuer fails the check over HTTP; over stdio it is never looked at.
    process.env.DOCS_MCP_AUTH_ENABLED = "true";
    process.env.DOCS_MCP_AUTH_ISSUER_URL = "http://issuer.example.com";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await run("mcp --protocol stdio");

    expect(stdioAppConfig().auth.enabled).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("Authentication does not apply to MCP over stdio"),
    );
  });
});
