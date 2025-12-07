/** Unit test for listAction */

import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ListLibrariesTool } from "../../tools";

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
    expect(ListLibrariesTool).toHaveBeenCalledTimes(1);
  });
});
