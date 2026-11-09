import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import { PipelineJobStatus } from "../pipeline/types";
import { ScrapeMode } from "../scraper/types";
import { defaults } from "../utils/config";
import { ScrapeTool, type ScrapeToolOptions } from "./ScrapeTool";

// Version labels are normalized by normalizeVersionLabel (src/store/types.test.ts);
// test/version-resolution-e2e.test.ts checks this tool applies it. The page
// count and job failures reach the CLI in test/cli-e2e.test.ts.
describe("ScrapeTool", () => {
  let pipeline: {
    enqueueScrapeJob: Mock<IPipeline["enqueueScrapeJob"]>;
    waitForJobCompletion: Mock<IPipeline["waitForJobCompletion"]>;
    getJob: Mock;
  };
  let scrapeTool: ScrapeTool;

  const MOCK_JOB_ID = "test-job-123";

  beforeEach(() => {
    pipeline = {
      enqueueScrapeJob: vi.fn().mockResolvedValue(MOCK_JOB_ID),
      waitForJobCompletion: vi.fn().mockResolvedValue(undefined),
      getJob: vi.fn().mockResolvedValue({
        id: MOCK_JOB_ID,
        status: PipelineJobStatus.COMPLETED,
        progress: { pagesScraped: 0 },
      }),
    };
    scrapeTool = new ScrapeTool(pipeline as unknown as IPipeline, defaults.scraper);
  });

  const baseOptions: ScrapeToolOptions = {
    library: "test-lib",
    version: "1.0.0",
    url: "http://example.com/docs",
  };

  it("should report the job id before waiting for the job", async () => {
    const onJobEnqueued = vi.fn(() => {
      expect(pipeline.waitForJobCompletion).not.toHaveBeenCalled();
    });

    await scrapeTool.execute({ ...baseOptions, onJobEnqueued });

    expect(onJobEnqueued).toHaveBeenCalledWith(MOCK_JOB_ID);
    expect(pipeline.waitForJobCompletion).toHaveBeenCalledTimes(1);
  });

  it("fills defaults and passes crawl options through", async () => {
    const headers = {
      Authorization: "Bearer test-token",
      "X-Custom-Header": "custom-value",
    };

    await scrapeTool.execute({
      ...baseOptions,
      options: { maxPages: 50, ignoreErrors: false, headers, preserveHashes: true },
    });

    expect(pipeline.enqueueScrapeJob).toHaveBeenCalledWith(
      "test-lib",
      "1.0.0",
      {
        url: "http://example.com/docs",
        library: "test-lib",
        version: "1.0.0",
        // Given
        maxPages: 50,
        ignoreErrors: false,
        headers,
        preserveHashes: true,
        // From the scraper config
        maxDepth: defaults.scraper.maxDepth,
        maxConcurrency: defaults.scraper.maxConcurrency,
        // Built-in
        scope: "subpages",
        followRedirects: true,
        scrapeMode: ScrapeMode.Auto,
      },
      { onExisting: undefined },
    );
  });

  it("should return jobId immediately if waitForCompletion is false", async () => {
    const result = await scrapeTool.execute({ ...baseOptions, waitForCompletion: false });

    expect(result).toEqual({ jobId: MOCK_JOB_ID });
    expect(pipeline.enqueueScrapeJob).toHaveBeenCalledOnce();
    expect(pipeline.waitForJobCompletion).not.toHaveBeenCalled();
  });

  it("requests replacement only for replace: true and never stores it as a scraper option", async () => {
    await scrapeTool.execute({ ...baseOptions, replace: true });
    await scrapeTool.execute(baseOptions);

    const [replaced, omitted] = pipeline.enqueueScrapeJob.mock.calls;
    expect(replaced?.[3]).toEqual({ onExisting: "replace" });
    // Without replace, the pipeline applies its own default
    expect(omitted?.[3]).toEqual({ onExisting: undefined });
    expect(replaced?.[2]).not.toHaveProperty("replace");
    expect(replaced?.[2]).not.toHaveProperty("onExisting");
  });
});
