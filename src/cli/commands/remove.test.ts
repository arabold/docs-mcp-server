/** Unit test for removeAction */

import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const removeFn = vi.fn(async () => {});
vi.mock("../../store", () => ({
  createDocumentManagement: vi.fn(async () => ({
    shutdown: vi.fn(),
    removeAllDocuments: removeFn,
  })),
}));
vi.mock("../utils", () => ({ setupLogging: vi.fn() }));

import { removeAction } from "./remove";

function cmd() {
  return new Command();
}
beforeEach(() => {
  vi.clearAllMocks();
});

describe("removeAction", () => {
  it("calls removeAllDocuments", async () => {
    await removeAction("react", { version: "18.0.0", serverUrl: undefined });
    expect(removeFn).toHaveBeenCalledWith("react", "18.0.0");
  });
});
