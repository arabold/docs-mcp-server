/** Unit test for compact command */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs";
import { createCompactCommand } from "./compact";

const stdoutWriteMock = vi.fn();

const compactFn = vi.fn(async () => ({
  skipped: false,
  vacuumed: true,
  beforeBytes: 2048,
  afterBytes: 1024,
  reclaimedBytes: 1024,
}));
vi.mock("../../services/backend", () => ({
  openBackend: vi.fn(async () => ({
    docService: {
      compact: compactFn,
    },
    close: vi.fn(),
  })),
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

describe("compact command", () => {
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

  it("forces vacuum when requested", async () => {
    const parser = yargs().scriptName("test");
    createCompactCommand(parser);

    await parser.parse("compact --force");

    expect(compactFn).toHaveBeenCalledWith({ force: true });
  });
});
