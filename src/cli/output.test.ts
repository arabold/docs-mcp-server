import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as loggerModule from "../utils/logger";
import {
  applyGlobalCliOutputMode,
  renderScalarOutput,
  renderStructuredOutput,
  renderTextOutput,
} from "./output";

const stdoutIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const stderrIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");

function restoreDescriptor(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
    return;
  }

  Reflect.deleteProperty(target, key);
}

describe("CLI output helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOG_LEVEL;
    delete process.env.ENABLE_TEST_LOGS;
  });

  afterEach(() => {
    restoreDescriptor(process.stdout, "isTTY", stdoutIsTTYDescriptor);
    restoreDescriptor(process.stderr, "isTTY", stderrIsTTYDescriptor);
    vi.restoreAllMocks();
  });

  /** Makes stdout and stderr look like a terminal or not. */
  function setInteractive(interactive: boolean): void {
    for (const stream of [process.stdout, process.stderr]) {
      Object.defineProperty(stream, "isTTY", { value: interactive, configurable: true });
    }
  }

  it("picks the log level from --verbose, --quiet and the terminal", () => {
    const setLogLevelSpy = vi.spyOn(loggerModule, "setLogLevel");
    const cases: Array<{
      label: string;
      interactive: boolean;
      options: { verbose?: boolean; quiet?: boolean };
      expected: loggerModule.LogLevel;
    }> = [
      {
        label: "no terminal",
        interactive: false,
        options: {},
        expected: loggerModule.LogLevel.ERROR,
      },
      {
        label: "terminal",
        interactive: true,
        options: {},
        expected: loggerModule.LogLevel.INFO,
      },
      {
        label: "--quiet",
        interactive: true,
        options: { quiet: true },
        expected: loggerModule.LogLevel.ERROR,
      },
      {
        label: "--verbose",
        interactive: false,
        options: { verbose: true },
        expected: loggerModule.LogLevel.DEBUG,
      },
    ];

    for (const { label, interactive, options, expected } of cases) {
      setLogLevelSpy.mockClear();
      setInteractive(interactive);
      applyGlobalCliOutputMode(options);
      expect.soft(setLogLevelSpy.mock.lastCall?.[0], label).toBe(expected);
    }
  });

  it("writes each kind of output to stdout in the requested format", () => {
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((() => true) as typeof process.stdout.write);
    const cases: Array<{ label: string; render: () => void; expected: string }> = [
      {
        label: "structured, no format",
        render: () => renderStructuredOutput({ ok: true }, {}),
        expected: '{\n  "ok": true\n}\n',
      },
      {
        label: "structured as YAML",
        render: () => renderStructuredOutput({ ok: true }, { output: "yaml" }),
        expected: "ok: true\n",
      },
      {
        label: "structured as TOON",
        render: () =>
          renderStructuredOutput({ users: [{ id: 1, name: "Ada" }] }, { output: "toon" }),
        expected: "users[1]{id,name}:\n  1,Ada\n",
      },
      {
        label: "scalar, no format",
        render: () => renderScalarOutput(42, {}),
        expected: "42\n",
      },
      {
        label: "plain text",
        render: () => renderTextOutput("hello"),
        expected: "hello\n",
      },
    ];

    for (const { label, render, expected } of cases) {
      writeSpy.mockClear();
      render();
      expect
        .soft(writeSpy.mock.calls.map(([chunk]) => chunk).join(""), label)
        .toBe(expected);
    }
  });
});
