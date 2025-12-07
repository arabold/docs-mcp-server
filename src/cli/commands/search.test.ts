/** Unit test for searchAction */

import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchTool } from "../../tools";

vi.mock("../../store", () => ({
  createDocumentManagement: vi.fn(async () => ({ shutdown: vi.fn() })),
}));
vi.mock("../../tools", () => ({
  SearchTool: vi
    .fn()
    .mockImplementation(() => ({ execute: vi.fn(async () => ({ results: [] })) })),
}));
vi.mock("../utils", () => ({
  getGlobalOptions: vi.fn(() => ({ storePath: undefined })),
  getEventBus: vi.fn(() => ({
    on: vi.fn(),
    emit: vi.fn(),
  })),
  resolveEmbeddingContext: vi.fn(() => ({ provider: "mock", model: "mock-model" })),
  formatOutput: vi.fn((data) => JSON.stringify(data)),
}));

import { searchAction } from "./search";

function _cmd() {
  return new Command();
}
beforeEach(() => vi.clearAllMocks());

describe("searchAction", () => {
  it("invokes SearchTool with parameters", async () => {
    await searchAction("react", "hooks", {
      version: "18.x",
      limit: "3",
      exactMatch: false,
      serverUrl: undefined,
      embeddingModel: "mock-embedding-model",
    });
    expect(SearchTool).toHaveBeenCalledTimes(1);
  });
});
