/**
 * Tests for the CLI setup: global options, the validators commands share, and
 * the rule that options mapped onto settings declare no built-in value.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Argv } from "yargs";
import { Parser } from "yargs/helpers";
import { openBackend } from "../services/backend";
import { getConfigMappedCliKeys } from "../utils/config";
import { COMMAND_FACTORIES, createCli, registerGlobalOptions } from "./index";
import { resolveProtocol, validatePort } from "./utils";

vi.mock("../telemetry", () => ({
  initTelemetry: vi.fn(),
  shouldEnableTelemetry: vi.fn().mockReturnValue(false),
  telemetry: {
    isEnabled: vi.fn().mockReturnValue(false),
    setGlobalContext: vi.fn(),
    track: vi.fn(),
  },
  TelemetryEvent: { CLI_COMMAND: "cli_command" },
}));

vi.mock("../services/backend", () => ({
  openBackend: vi.fn(async () => ({
    docService: { listLibraries: async () => [] },
    close: vi.fn(),
  })),
}));

describe("global options", () => {
  it("opens the store that --store-path names, over DOCS_MCP_STORE_PATH", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cli-store-path-"));
    const savedStorePath = process.env.DOCS_MCP_STORE_PATH;
    process.env.DOCS_MCP_STORE_PATH = path.join(dir, "from-env");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await createCli([]).parseAsync([
        "list",
        "--store-path",
        path.join(dir, "from-flag"),
      ]);

      const [options] = vi.mocked(openBackend).mock.calls[0] ?? [];
      expect(options?.appConfig.app.storePath).toBe(path.join(dir, "from-flag"));
    } finally {
      stdout.mockRestore();
      process.env.DOCS_MCP_STORE_PATH = savedStorePath;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveProtocol", () => {
  it("takes an explicit protocol as given and resolves auto from the terminal", () => {
    const savedTty = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY };
    const cases: Array<{ protocol: string; terminal: boolean; expected: string }> = [
      { protocol: "stdio", terminal: true, expected: "stdio" },
      { protocol: "http", terminal: false, expected: "http" },
      // No terminal, like VS Code or CI/CD
      { protocol: "auto", terminal: false, expected: "stdio" },
      { protocol: "auto", terminal: true, expected: "http" },
    ];
    try {
      for (const { protocol, terminal, expected } of cases) {
        process.stdin.isTTY = terminal;
        process.stdout.isTTY = terminal;
        expect
          .soft(resolveProtocol(protocol), `${protocol}, terminal: ${terminal}`)
          .toBe(expected);
      }
    } finally {
      process.stdin.isTTY = savedTty.stdin;
      process.stdout.isTTY = savedTty.stdout;
    }

    expect(() => resolveProtocol("invalid")).toThrow(
      "Invalid protocol: invalid. Must be 'auto', 'stdio', or 'http'",
    );
  });
});

describe("validatePort", () => {
  it("accepts a port from 1 to 65535 and rejects anything else", () => {
    const cases: Array<{ input: string; expected: number | "rejected" }> = [
      { input: "3000", expected: 3000 },
      { input: "8080", expected: 8080 },
      { input: "1", expected: 1 },
      { input: "65535", expected: 65535 },
      { input: "0", expected: "rejected" },
      { input: "65536", expected: "rejected" },
      { input: "-1", expected: "rejected" },
      { input: "abc", expected: "rejected" },
      { input: "", expected: "rejected" },
    ];

    for (const { input, expected } of cases) {
      const label = JSON.stringify(input);
      if (expected === "rejected") {
        expect.soft(() => validatePort(input), label).toThrow("Invalid port number");
      } else {
        expect.soft(validatePort(input), label).toBe(expected);
      }
    }
  });
});

describe("CLI options mapped to settings", () => {
  interface Declaration {
    command: string;
    name: string;
    options: Record<string, unknown>;
  }

  /**
   * A yargs stand-in that records option and positional declarations, runs
   * command builders against itself, and returns itself for every other call.
   */
  function createRecorder(command: string, declarations: Declaration[]): Argv {
    const record = (name: string, options: Record<string, unknown> = {}) => {
      declarations.push({ command, name, options });
    };
    const recorder: Argv = new Proxy({} as Argv, {
      get(_target, property) {
        if (property === "then") {
          return undefined;
        }
        return (...args: unknown[]) => {
          if (property === "option" || property === "positional") {
            record(args[0] as string, args[1] as Record<string, unknown>);
          } else if (property === "options") {
            for (const [name, options] of Object.entries(args[0] as object)) {
              record(name, options);
            }
          } else if (property === "command") {
            const [names, , builder] = args;
            const commandName = [names].flat()[0] as string;
            if (typeof builder === "function") {
              builder(createRecorder(commandName, declarations));
            } else if (builder && typeof builder === "object") {
              for (const [name, options] of Object.entries(builder)) {
                declarations.push({ command: commandName, name, options });
              }
            }
          }
          return recorder;
        };
      },
    });
    return recorder;
  }

  it("declares no built-in value on an option that maps onto a setting", () => {
    const declarations: Declaration[] = [];
    registerGlobalOptions(createRecorder("(global)", declarations));
    for (const registerCommand of COMMAND_FACTORIES) {
      const before = declarations.length;
      registerCommand(createRecorder("(root)", declarations));
      // A factory the recorder cannot follow would hide its offenders
      expect.soft(declarations.length - before, registerCommand.name).toBeGreaterThan(0);
    }
    const mapped = getConfigMappedCliKeys();

    const offenders = declarations
      .filter(({ name, options }) => {
        // The same conversion yargs applies to argv keys.
        const keys = [name, ...[options.alias ?? []].flat()].map((key) =>
          Parser.camelCase(String(key)),
        );
        return keys.some((key) => mapped.has(key)) && options.default !== undefined;
      })
      .map(({ command, name }) => `${command} --${name}`);

    expect(offenders).toEqual([]);
  });
});
