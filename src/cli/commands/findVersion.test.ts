/** Unit test for findVersionAction */

import { beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs";
import { FindVersionTool } from "../../tools";
import { createFindVersionCommand } from "./findVersion";

vi.mock("../../store", () => ({
  createDocumentManagement: vi.fn(async () => ({ shutdown: vi.fn() })),
}));
vi.mock("../../tools", () => ({
  FindVersionTool: vi
    .fn()
    .mockImplementation(() => ({ execute: vi.fn(async () => ({ version: "1.0.0" })) })),
}));
vi.mock("../utils", () => ({
  getGlobalOptions: vi.fn(() => ({ storePath: undefined })),
  getEventBus: vi.fn(() => ({
    on: vi.fn(),
    emit: vi.fn(),
  })),
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

describe("find-version command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls FindVersionTool", async () => {
    const parser = yargs().scriptName("test");
    createFindVersionCommand(parser);

    await parser.parse("find-version react --version 18.x");

    expect(FindVersionTool).toHaveBeenCalledTimes(1);
    const mockInstance = (FindVersionTool as any).mock.results[0].value;
    expect(mockInstance.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        library: "react",
        targetVersion: "18.x",
      }),
    );
  });
});
