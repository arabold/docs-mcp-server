import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AutoDetectFetcher, RawContent } from "../scraper/fetcher";
import { BasePipeline } from "../scraper/pipelines/BasePipeline";
import { PipelineFactory } from "../scraper/pipelines/PipelineFactory";
import { ScrapeMode } from "../scraper/types";
import { loadConfig } from "../utils/config";
import { ChallengeError, ScraperError } from "../utils/errors";
import { ToolError } from "./errors";
import { FetchUrlTool } from "./FetchUrlTool";

// Content conversion, fetch failures and invalid URLs run on the real fetcher
// in test/fetch-url-tool-e2e.test.ts.
describe("FetchUrlTool", () => {
  const appConfig = loadConfig();
  let fetcher: { canFetch: Mock; fetch: Mock; close: Mock };
  let fetchUrlTool: FetchUrlTool;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetcher = {
      canFetch: vi.fn().mockReturnValue(true),
      fetch: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    fetchUrlTool = new FetchUrlTool(fetcher as unknown as AutoDetectFetcher, appConfig);
  });

  /** Makes the fetcher answer with `content` of type `mimeType`. */
  function respondWith(content: RawContent["content"], mimeType: string): void {
    fetcher.fetch.mockResolvedValue({ content, mimeType, source: "https://example.com" });
  }

  it("returns Markdown unchanged and a type no pipeline handles as raw text", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header
    const cases: Array<{
      label: string;
      content: RawContent["content"];
      mimeType: string;
      expected: string;
    }> = [
      {
        label: "Markdown",
        content: "# Already Markdown\n\nNo conversion needed.",
        mimeType: "text/markdown",
        expected: "# Already Markdown\n\nNo conversion needed.",
      },
      {
        label: "PNG",
        content: png,
        mimeType: "image/png",
        expected: png.toString("utf-8"),
      },
    ];

    for (const { label, content, mimeType, expected } of cases) {
      respondWith(content, mimeType);
      const result = await fetchUrlTool.execute({ url: "https://example.com/file" });
      expect.soft(result, label).toBe(expected);
    }
  });

  it("names the bot challenge that answered in place of the page", async () => {
    const url = "https://pypi.org/project/requests/";
    fetcher.fetch.mockRejectedValue(new ChallengeError(url, 200, "fastly"));

    const error = await fetchUrlTool.execute({ url }).catch((e) => e);

    expect(error).toBeInstanceOf(ToolError);
    expect(error.message).toContain("fastly bot challenge");
    expect(error.message).not.toContain("verify the URL is correct");
  });

  it("passes followRedirects, maxRetries and headers to the fetcher", async () => {
    const url = "https://example.com/docs";
    const headers = { Authorization: "Bearer token123", "User-Agent": "MyAgent" };
    respondWith("<h1>Authenticated Content</h1>", "text/html");

    await fetchUrlTool.execute({
      url,
      scrapeMode: ScrapeMode.Fetch,
      followRedirects: false,
      headers,
    });

    expect(fetcher.fetch).toHaveBeenCalledWith(url, {
      followRedirects: false,
      maxRetries: 3,
      headers,
    });
  });

  it("closes every pipeline and the fetcher after success or failure, even when a close fails", async () => {
    const pipelineClose = vi.spyOn(BasePipeline.prototype, "close");
    const pipelineCount = PipelineFactory.createStandardPipelines(appConfig).length;
    const options = { url: "https://example.com", scrapeMode: ScrapeMode.Fetch };
    /** The distinct pipelines whose close() ran. */
    const closedPipelines = () => new Set(pipelineClose.mock.contexts).size;

    // Success, with one pipeline failing to close
    pipelineClose.mockRejectedValueOnce(new Error("Pipeline cleanup failed"));
    respondWith("<h1>Test</h1>", "text/html");
    await expect(fetchUrlTool.execute(options)).resolves.toContain("# Test");
    expect(closedPipelines()).toBe(pipelineCount);
    expect(fetcher.close).toHaveBeenCalledTimes(1);

    // Failure
    pipelineClose.mockClear();
    fetcher.close.mockClear();
    fetcher.fetch.mockRejectedValue(new ScraperError("Fetch failed", true));
    await expect(fetchUrlTool.execute(options)).rejects.toThrow(ToolError);
    expect(closedPipelines()).toBe(pipelineCount);
    expect(fetcher.close).toHaveBeenCalledTimes(1);
  });
});
