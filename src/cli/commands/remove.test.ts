/** Unit test for removeAction */

import { beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs";
import { createRemoveCommand } from "./remove";

const removeFn = vi.fn(async () => {});
vi.mock("../../store", () => ({
  createDocumentManagement: vi.fn(async () => ({
    shutdown: vi.fn(),
    removeAllDocuments: removeFn,
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

describe("remove command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls removeAllDocuments", async () => {
    const parser = yargs().scriptName("test");
    createRemoveCommand(parser);

    await parser.parse("remove react --version 18.0.0");

    expect(removeFn).toHaveBeenCalledWith("react", "18.0.0");
  });
});
