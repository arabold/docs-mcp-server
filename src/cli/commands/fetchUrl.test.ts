/** Unit test for fetchUrlAction */

import { beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs";
import { FetchUrlTool } from "../../tools";
import { createFetchUrlCommand } from "./fetchUrl";

vi.mock("../../scraper/fetcher", () => ({
  HttpFetcher: vi.fn().mockImplementation(() => ({})),
  FileFetcher: vi.fn().mockImplementation(() => ({})),
  AutoDetectFetcher: vi.fn().mockImplementation(() => ({
    canFetch: vi.fn().mockReturnValue(true),
    fetch: vi.fn().mockResolvedValue({
      content: "<h1>Test</h1>",
      mimeType: "text/html",
      source: "https://example.com",
    }),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("../../tools", () => ({
  FetchUrlTool: vi
    .fn()
    .mockImplementation(() => ({ execute: vi.fn(async () => "# md") })),
}));
vi.mock("../utils", () => ({ setupLogging: vi.fn(), parseHeaders: () => ({}) }));
vi.mock("../../utils/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/config")>();
  return {
    ...actual,
    loadConfig: vi.fn(() => ({
      scraper: { fetcher: {} },
    })),
  };
});

describe("fetch-url command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes FetchUrlTool", async () => {
    const parser = yargs().scriptName("test");
    createFetchUrlCommand(parser);

    await parser.parse("fetch-url https://example.com --scrape-mode auto");

    expect(FetchUrlTool).toHaveBeenCalledTimes(1);
    const mockInstance = (FetchUrlTool as any).mock.results[0].value;
    expect(mockInstance.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com",
        scrapeMode: "auto",
      }),
    );
  });
});
