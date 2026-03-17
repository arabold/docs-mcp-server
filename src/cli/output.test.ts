import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as loggerModule from "../utils/logger";
import {
  applyGlobalCliOutputMode,
  formatStructuredOutput,
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

  it("defaults to error log level in non-interactive mode", () => {
    const setLogLevelSpy = vi.spyOn(loggerModule, "setLogLevel");

    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stderr, "isTTY", { value: false, configurable: true });

    applyGlobalCliOutputMode({});

    expect(setLogLevelSpy).toHaveBeenCalledWith(loggerModule.LogLevel.ERROR);
  });

  it("defaults to info log level in interactive mode", () => {
    const setLogLevelSpy = vi.spyOn(loggerModule, "setLogLevel");

    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    applyGlobalCliOutputMode({});

    expect(setLogLevelSpy).toHaveBeenCalledWith(loggerModule.LogLevel.INFO);
  });

  it("sets error log level for quiet mode", () => {
    const setLogLevelSpy = vi.spyOn(loggerModule, "setLogLevel");

    applyGlobalCliOutputMode({ quiet: true });

    expect(setLogLevelSpy).toHaveBeenCalledWith(loggerModule.LogLevel.ERROR);
  });

  it("sets debug log level for verbose mode", () => {
    const setLogLevelSpy = vi.spyOn(loggerModule, "setLogLevel");

    applyGlobalCliOutputMode({ verbose: true });

    expect(setLogLevelSpy).toHaveBeenCalledWith(loggerModule.LogLevel.DEBUG);
  });

  it("formats structured output as TOON", () => {
    const output = formatStructuredOutput({ users: [{ id: 1, name: "Ada" }] }, "toon");

    expect(output).toContain("users[1]{id,name}:");
  });

  it("renders structured output to stdout", () => {
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((() => true) as any);

    renderStructuredOutput({ ok: true }, {});

    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('"ok": true'));
  });

  it("renders scalar values as plain text when no format is requested", () => {
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((() => true) as any);

    renderScalarOutput(42, {});

    expect(writeSpy).toHaveBeenCalledWith("42\n");
  });

  it("keeps plain text output unstructured", () => {
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((() => true) as any);

    renderTextOutput("hello");

    expect(writeSpy).toHaveBeenCalledWith("hello\n");
  });
});
