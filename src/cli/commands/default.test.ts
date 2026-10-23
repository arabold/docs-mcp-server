/** Unit test for default command */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs";
import * as appModule from "../../app";
import * as stdioModule from "../../mcp/startStdioServer";
import type { AppConfig } from "../../utils/config";
import { loadConfig } from "../../utils/config";
import * as services from "../services";
import * as utils from "../utils";
import { createDefaultAction } from "./default";

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
  ensurePlaywrightBrowsersInstalled: vi.fn(),
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
        ports: { default: 6280 },
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

describe("server command configuration precedence", () => {
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
    tempDir = mkdtempSync(path.join(tmpdir(), "server-precedence-"));

    // Run the real loader and protocol resolution; only the servers stay mocked.
    const actualConfig =
      await vi.importActual<typeof import("../../utils/config")>("../../utils/config");
    vi.mocked(loadConfig).mockImplementationOnce(actualConfig.loadConfig);
    const actualUtils = await vi.importActual<typeof import("../utils")>("../utils");
    vi.mocked(utils.resolveProtocol).mockImplementationOnce(actualUtils.resolveProtocol);
  });

  afterEach(() => {
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
    createDefaultAction(parser);
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

  it("keeps read-only from the config file when --read-only is omitted", async () => {
    await run("server --protocol http", "app:\n  readOnly: true\n");

    expect(httpAppConfig().app.readOnly).toBe(true);
  });

  it("lets an explicit --no-read-only override the environment", async () => {
    process.env.DOCS_MCP_READ_ONLY = "true";

    await run("server --protocol http --no-read-only");

    expect(httpAppConfig().app.readOnly).toBe(false);
  });

  it("reads the server identity flags", async () => {
    await run(
      `server --protocol stdio --server-name acme-docs --server-title "Acme Docs" --server-instructions "Use acme docs" --server-instructions-file /tmp/acme.md`,
    );

    expect(stdioAppConfig().server).toMatchObject({
      name: "acme-docs",
      title: "Acme Docs",
      instructions: "Use acme docs",
      instructionsFile: "/tmp/acme.md",
    });
  });

  it("applies the built-in defaults when no layer sets a value", async () => {
    withoutTerminal();

    await run("server");

    const appConfig = stdioAppConfig();
    expect(appConfig.auth.enabled).toBe(false);
    expect(appConfig.app.readOnly).toBe(false);
    expect(appConfig.server.protocol).toBe("auto");
  });
});
