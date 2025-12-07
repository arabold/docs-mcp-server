/** Unit test for fetchUrlAction */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FetchUrlTool } from "../../tools";

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

import { fetchUrlAction } from "./fetchUrl";

beforeEach(() => vi.clearAllMocks());

describe("fetchUrlAction", () => {
  it("executes FetchUrlTool", async () => {
    await fetchUrlAction("https://example.com", {
      followRedirects: true,
      scrapeMode: "auto" as any,
      header: [],
    });
    expect(FetchUrlTool).toHaveBeenCalledTimes(1);
  });
});
