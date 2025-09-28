/** Unit test for searchAction */

import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../store", () => ({
  createDocumentManagement: vi.fn(async () => ({ shutdown: vi.fn() })),
}));
vi.mock("../../tools", () => ({
  SearchTool: vi
    .fn()
    .mockImplementation(() => ({ execute: vi.fn(async () => ({ results: [] })) })),
}));
vi.mock("../utils", () => ({
  setupLogging: vi.fn(),
  formatOutput: (v: unknown) => v,
  resolveEmbeddingContext: vi.fn(() => ({ type: "mock" })),
}));

import { searchAction } from "./search";

function cmd() {
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
    });
    const { SearchTool } = await import("../../tools");
    expect(SearchTool).toHaveBeenCalledTimes(1);
  });
});
