import { describe, expect, it, vi } from "vitest";
import type { ScraperOptions } from "../../scraper/types";
import type { IPipeline } from "./interfaces";
import { pipelineRouter } from "./router";

/**
 * Builds a mock pipeline that records enqueue arguments without running any
 * real scrape/refresh work.
 */
function buildPipeline() {
  return {
    enqueueScrapeJob: vi.fn().mockResolvedValue("job_scrape"),
    enqueueRefreshJob: vi.fn().mockResolvedValue("job_refresh"),
  } as unknown as IPipeline & {
    enqueueScrapeJob: ReturnType<typeof vi.fn>;
    enqueueRefreshJob: ReturnType<typeof vi.fn>;
  };
}

const OPTIONS = { url: "https://x.dev", library: "x", version: "" } as ScraperOptions;

/**
 * Regression tests for unversioned-library handling: an empty (or whitespace)
 * `version` is the domain's "unversioned" marker, so the pipeline router must
 * accept it (coercing to null) rather than rejecting it with a Zod
 * `too_small` error — the bug that broke "Refresh" for unversioned libraries.
 */
describe("pipelineRouter - unversioned (empty-string) version handling", () => {
  it("accepts an empty-string version for enqueueRefreshJob, treated as unversioned (null)", async () => {
    const pipeline = buildPipeline();
    const caller = pipelineRouter.createCaller({ pipeline });

    await expect(
      caller.enqueueRefreshJob({ library: "pydantic", version: "" }),
    ).resolves.toEqual({ jobId: "job_refresh" });

    expect(pipeline.enqueueRefreshJob).toHaveBeenCalledWith("pydantic", null, undefined);
  });

  it("accepts a whitespace-only version for enqueueScrapeJob, treated as unversioned (null)", async () => {
    const pipeline = buildPipeline();
    const caller = pipelineRouter.createCaller({ pipeline });

    await expect(
      caller.enqueueScrapeJob({ library: "x", version: "   ", options: OPTIONS }),
    ).resolves.toEqual({ jobId: "job_scrape" });

    expect(pipeline.enqueueScrapeJob).toHaveBeenCalledWith("x", null, OPTIONS);
  });

  it("passes a real version through unchanged", async () => {
    const pipeline = buildPipeline();
    const caller = pipelineRouter.createCaller({ pipeline });

    await caller.enqueueRefreshJob({ library: "react", version: "19.0.0" });

    expect(pipeline.enqueueRefreshJob).toHaveBeenCalledWith("react", "19.0.0", undefined);
  });
});
