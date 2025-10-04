/** Unit test for listAction */

import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  setupLogging: vi.fn(),
  formatOutput: (v: unknown) => JSON.stringify(v, null, 2),
}));

import { listAction } from "./list";

function _cmd() {
  return new Command();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listAction", () => {
  it("executes ListLibrariesTool", async () => {
    await expect(listAction({ serverUrl: undefined })).resolves.not.toThrow();
    const { ListLibrariesTool } = await import("../../tools");
    expect(ListLibrariesTool).toHaveBeenCalledTimes(1);
  });
});
