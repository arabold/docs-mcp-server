/** Unit test for removeAction */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs";
import { openBackend } from "../../services/backend";
import { createRemoveCommand } from "./remove";

const stdoutWriteMock = vi.fn();

const execute = vi.fn(async () => ({ message: "Successfully removed react@18.0.0." }));
vi.mock("../../services/backend", () => ({
  openBackend: vi.fn(async () => ({
    docService: {},
    pipeline: undefined,
    close: vi.fn(),
  })),
}));
vi.mock("../../tools/RemoveTool", () => ({
  RemoveTool: vi.fn().mockImplementation(function () {
    return { execute };
  }),
}));
vi.mock("../utils", () => ({
  getGlobalOptions: vi.fn(() => ({ storePath: undefined })),
  getEventBus: vi.fn(() => ({
    on: vi.fn(),
    emit: vi.fn(),
  })),
  CliContext: {},
  setupLogging: vi.fn(),
}));
vi.mock("../../utils/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/config")>();
  return {
    ...actual,
    loadConfig: vi.fn(() => ({
      app: { storePath: "/mock/store" },
    })),
  };
});

describe("remove command", () => {
  let stdoutWriteSpy: { mockRestore: () => void };

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWriteMock.mockReset();
    stdoutWriteSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(stdoutWriteMock as any);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
  });

  it("removes through RemoveTool on a documents-only backend", async () => {
    const parser = yargs().scriptName("test");
    createRemoveCommand(parser);

    await parser.parse("remove react --version 18.0.0");

    expect(vi.mocked(openBackend).mock.calls[0]?.[0].jobs).toBeUndefined();
    expect(execute).toHaveBeenCalledWith({ library: "react", version: "18.0.0" });
    expect(stdoutWriteMock).toHaveBeenCalledWith("Successfully removed react@18.0.0.\n");
  });

  it("fails when the library does not exist", async () => {
    execute.mockRejectedValueOnce(new Error("Library react not found in store."));
    const parser = yargs().scriptName("test").fail(false);
    createRemoveCommand(parser);

    await expect(parser.parse("remove react")).rejects.toThrow("not found");
  });
});
