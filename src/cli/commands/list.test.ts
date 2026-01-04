/** Unit test for listAction */

import { beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs";
import { ListLibrariesTool } from "../../tools";
import { createListCommand } from "./list";

// Mocks
vi.mock("../../store", () => ({
  createDocumentManagement: vi.fn(async () => ({
    shutdown: vi.fn(),
  })),
}));
vi.mock("../../tools", () => ({
  ListLibrariesTool: vi
    .fn()
    .mockImplementation(() => ({ execute: vi.fn(async () => ({ libraries: [] })) })),
}));
vi.mock("../utils", () => ({
  getGlobalOptions: vi.fn(() => ({ storePath: undefined })),
  getEventBus: vi.fn(() => ({
    on: vi.fn(),
    emit: vi.fn(),
  })),
  formatOutput: vi.fn((data) => JSON.stringify(data)),
  CliContext: {},
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

describe("list command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes ListLibrariesTool", async () => {
    const parser = yargs().scriptName("test");
    createListCommand(parser);

    await parser.parse("list");

    expect(ListLibrariesTool).toHaveBeenCalledTimes(1);
    const mockInstance = (ListLibrariesTool as any).mock.results[0].value;
    expect(mockInstance.execute).toHaveBeenCalled();
  });
});
