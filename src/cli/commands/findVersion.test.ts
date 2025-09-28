/** Unit test for findVersionAction */

import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../store", () => ({
  createDocumentManagement: vi.fn(async () => ({ shutdown: vi.fn() })),
}));
vi.mock("../../tools", () => ({
  FindVersionTool: vi
    .fn()
    .mockImplementation(() => ({ execute: vi.fn(async () => ({ version: "1.0.0" })) })),
}));
vi.mock("../utils", () => ({ setupLogging: vi.fn() }));

import { findVersionAction } from "./findVersion";

function cmd() {
  return new Command();
}
beforeEach(() => vi.clearAllMocks());

describe("findVersionAction", () => {
  it("calls FindVersionTool", async () => {
    await findVersionAction("react", { version: "18.x", serverUrl: undefined });
    const { FindVersionTool } = await import("../../tools");
    expect(FindVersionTool).toHaveBeenCalledTimes(1);
  });
});
