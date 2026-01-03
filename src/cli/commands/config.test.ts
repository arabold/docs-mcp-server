/** Unit test for config command */

import { beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs";
import { createConfigCommand } from "./config";

vi.mock("../../utils/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/config")>();
  return {
    ...actual,
    loadConfig: vi.fn(() => ({
      mocked: "config",
    })),
  };
});

describe("config command", () => {
  let consoleSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("prints current configuration", async () => {
    const parser = yargs().scriptName("test");
    createConfigCommand(parser);

    await parser.parse(`config`);

    expect(consoleSpy).toHaveBeenCalledWith(
      JSON.stringify({ mocked: "config" }, null, 2),
    );
  });
});
