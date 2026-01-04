/** Unit test for searchAction */

import { beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs";
import { SearchTool } from "../../tools";
import { createSearchCommand } from "./search";

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
  CliContext: {},
}));
// Mock loadConfig to avoid Zod issues during tests if any, or ensuring defaults
vi.mock("../../utils/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/config")>();
  return {
    ...actual,
    loadConfig: vi.fn(() => ({
      app: { embeddingModel: "mock-model", storePath: "/mock/store" },
      search: { overfetchFactor: 2 },
    })),
  };
});

describe("search command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invokes SearchTool with parameters", async () => {
    const parser = yargs().scriptName("test");
    createSearchCommand(parser);

    await parser.parse("search react hooks --version 18.x --limit 3");

    expect(SearchTool).toHaveBeenCalledTimes(1);
    const mockInstance = (SearchTool as any).mock.results[0].value;
    expect(mockInstance.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        library: "react",
        query: "hooks",
        version: "18.x",
        limit: 3,
        exactMatch: false,
      }),
    );
  });
});
