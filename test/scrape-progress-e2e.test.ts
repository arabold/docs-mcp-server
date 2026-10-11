/**
 * End-to-end tests for scrape progress counter semantics.
 *
 * The `scrape-progress-reporting` capability defines four counters and an
 * invariant relating them. Unit tests pin the arithmetic inside
 * `BaseScraperStrategy`; these tests cover what only a whole-pipeline run can
 * show: that the numbers a real crawl or refresh produces survive the trip
 * through `PipelineManager` into the job record, and that the value an MCP
 * client reads back after completion is the value the scraper computed.
 */

import { describe, expect, it } from "vitest";
import { PipelineJobStatus } from "../src/pipeline/types";
import { PageOutcome } from "../src/scraper/types";
import { GetJobInfoTool } from "../src/tools/GetJobInfoTool";
import { hubPage, leafPage, mockSite } from "./mock-site";
import { usePipelineHarness } from "./pipeline-harness";

describe("Scrape progress counters E2E", () => {
  const site = mockSite("http://progress-docs.example.com");
  const h = usePipelineHarness({
    library: "progress-lib",
    version: "1.0.0",
    defaults: { url: site.url("/") },
  });

  const lastEvent = () => {
    const event = h.events[h.events.length - 1];
    if (!event) throw new Error("The job emitted no progress events");
    return event;
  };

  /** Reads the job back through the MCP tool, the way a client would. */
  async function jobInfo(jobId: string) {
    const { job } = await new GetJobInfoTool(h.pipelineManager).execute({ jobId });
    return job;
  }

  describe("during a scrape", () => {
    it("converges pagesScraped on totalPages when the queue drains", async () => {
      site
        .page("/", hubPage(["/a", "/b", "/c"]))
        .page("/a", leafPage("A"))
        .page("/b", leafPage("B"))
        .page("/c", leafPage("C"));

      const job = await h.scrape();

      expect(job.status).toBe(PipelineJobStatus.COMPLETED);
      expect(await h.storedUrls()).toEqual(["/", "/a", "/b", "/c"].map(site.url));
      // The point of the invariant: the fraction reads 4 of 4, not 4 of maxPages.
      expect(lastEvent()).toMatchObject({
        pagesScraped: 4,
        totalPages: 4,
        pagesIndexed: 4,
        totalDiscovered: 4,
      });
    });

    it("counts non-content outcomes in pagesScraped but not pagesIndexed", async () => {
      site
        .page("/", hubPage(["/kept", "/gone"]))
        .page("/kept", leafPage("Kept"))
        .notFound("/gone");

      const job = await h.scrape();

      expect(job.status).toBe(PipelineJobStatus.COMPLETED);
      expect(await h.storedUrls()).toEqual([site.url("/"), site.url("/kept")]);
      expect(lastEvent()).toMatchObject({
        pagesScraped: 3,
        pagesIndexed: 2,
        totalPages: 3,
      });
      // Every item reached exactly one outcome, and the 404 named its own
      // rather than advancing the count silently.
      expect(h.events.map((e) => [e.currentUrl, e.outcome])).toEqual([
        [site.url("/"), PageOutcome.Stored],
        [site.url("/kept"), PageOutcome.Stored],
        [site.url("/gone"), PageOutcome.Absent],
      ]);
    });

    it("bounds pagesIndexed by maxPages while pagesScraped absorbs the misses", async () => {
      // Five links: two store content, three 404. With maxPages 3 the crawl must
      // keep going past the misses until three pages have actually indexed.
      site
        .page("/", hubPage(["/miss1", "/hit1", "/miss2", "/hit2", "/miss3"]))
        .page("/hit1", leafPage("hit1"))
        .page("/hit2", leafPage("hit2"))
        .notFound("/miss1")
        .notFound("/miss2")
        .notFound("/miss3");

      const job = await h.scrape({ maxPages: 3 });

      expect(job.status).toBe(PipelineJobStatus.COMPLETED);
      // Root, hit1 and hit2 exhaust the budget of three, so the crawl stops
      // there and never asks for the last miss.
      expect(await h.storedUrls()).toEqual(["/", "/hit1", "/hit2"].map(site.url));
      expect(site.wasRequested("/miss3")).toBe(false);
      // The two misses before it were processed without consuming the budget,
      // and the denominator tracked that work rather than staying at maxPages.
      expect(lastEvent()).toMatchObject({
        pagesIndexed: 3,
        pagesScraped: 5,
        totalPages: 5,
        // Admissions, unbounded by the limit: root plus five links.
        totalDiscovered: 6,
      });
    });

    it("never reports pagesScraped above totalPages at any point", async () => {
      const links = Array.from({ length: 8 }, (_, i) => `/p${i}`);
      site.page("/", hubPage(links));
      for (const [i, link] of links.entries()) {
        // Alternate stored and missing so the clamp is exercised mid-crawl.
        if (i % 2 === 0) site.page(link, leafPage(link));
        else site.notFound(link);
      }

      await h.scrape({ maxPages: 3 });

      expect(h.events.length).toBeGreaterThan(0);
      for (const event of h.events) {
        expect(event.pagesScraped).toBeLessThanOrEqual(event.totalPages);
        expect(event.pagesIndexed).toBeLessThanOrEqual(event.pagesScraped);
        expect(event.totalPages).toBeLessThanOrEqual(event.totalDiscovered);
      }
      // pagesScraped advances by exactly one per event, never skipping or
      // repeating: every item reaches exactly one outcome.
      const scraped = h.events.map((e) => e.pagesScraped);
      expect(scraped).toEqual(scraped.map((_, i) => i + 1));
    });

    it("persists all three counters on the job record for later reads", async () => {
      site
        .page("/", hubPage(["/one", "/two"]))
        .page("/one", leafPage("One"))
        .notFound("/two");

      const job = await h.scrape();
      const final = lastEvent();

      // The persisted columns carry the values the crawl ended on, rather than
      // being live-only or reconstructed from a different source.
      expect(job.progressPages).toBe(final.pagesScraped);
      expect(job.progressMaxPages).toBe(final.totalPages);
      expect(job.progressPagesIndexed).toBe(final.pagesIndexed);
      // And an MCP client reading the job back sees the same numbers: the
      // counters survive the write to the job record and the read back through
      // the tool layer.
      expect((await jobInfo(job.id)).progress).toMatchObject({
        pages: final.pagesScraped,
        totalPages: final.totalPages,
        pagesIndexed: final.pagesIndexed,
      });
    });

    it("does not adjust a cancelled job's counters to look complete", async () => {
      // One worker takes the links in order, so the crawl stores the root, /a
      // and /b, then waits on /stall with the rest of the queue untouched.
      const links = ["/a", "/b", "/stall", "/c", "/d", "/e"];
      site.page("/", hubPage(links)).stall("/stall");
      for (const link of ["/a", "/b", "/c", "/d", "/e"]) site.page(link, leafPage(link));

      const jobId = await h.enqueueScrape();
      await site.waitForRequest("/stall");
      await h.pipelineManager.cancelJob(jobId);
      const job = await h.finish(jobId);

      expect(job.status).toBe(PipelineJobStatus.CANCELLED);
      expect(site.wasRequested("/c")).toBe(false);
      expect(lastEvent()).toMatchObject({
        pagesScraped: 3,
        pagesIndexed: 3,
        totalPages: 1 + links.length,
      });
      // Asserted on the persisted record too: the counters a client reads back
      // are the job's, and squaring them up on cancellation would leave every
      // in-flight event untouched and unnoticed.
      expect(job.progressPages).toBe(3);
      expect(job.progressPagesIndexed).toBe(3);
      expect(job.progressMaxPages).toBe(1 + links.length);
    });

    it("counts one page once when both its representations are crawled", async () => {
      // A document reachable as `/guide.md` and `/guide` resolves to one
      // identity, and both routes are stored: the store decides which
      // representation to keep. Counting the second as a new page spent a unit
      // of the page budget on a page that was never added, so a crawl asked for
      // N stopped short of N and reported N anyway. `/extra` is the page that
      // went missing.
      site
        .page("/", hubPage(["/guide.md", "/guide", "/extra"]))
        .page("/guide.md", "# Guide\n\nMarkdown body.", { type: "text/markdown" })
        .page("/guide", leafPage("Guide"))
        .page("/extra", leafPage("Extra"));

      const job = await h.scrape({ maxPages: 3 });

      expect(job.status).toBe(PipelineJobStatus.COMPLETED);
      expect(await h.storedUrls()).toEqual(["/", "/extra", "/guide"].map(site.url));
      expect(job.progressPagesIndexed).toBe(3);
    });
  });

  describe("during a refresh", () => {
    it("counts a refresh that changes nothing as processed but not indexed", async () => {
      site
        .page("/", hubPage(["/a", "/b"]), { etag: '"home-v1"' })
        .page("/a", leafPage("A"), { etag: '"a-v1"' })
        .page("/b", leafPage("B"), { etag: '"b-v1"' });
      await h.scrape();

      const refresh = await h.refresh();

      expect(refresh.status).toBe(PipelineJobStatus.COMPLETED);
      expect(h.events.map((e) => e.outcome)).toEqual([
        PageOutcome.Unchanged,
        PageOutcome.Unchanged,
        PageOutcome.Unchanged,
      ]);
      expect(lastEvent()).toMatchObject({
        pagesScraped: 3,
        totalPages: 3,
        pagesIndexed: 0,
      });
      // Zero, not unknown: a refresh that indexed nothing still reports a count.
      expect(refresh.progressPagesIndexed).toBe(0);
      expect((await jobInfo(refresh.id)).progress).toMatchObject({
        pages: 3,
        totalPages: 3,
        pagesIndexed: 0,
      });
    });

    it("counts unchanged, deleted and updated pages once each", async () => {
      site
        .page("/", hubPage(["/same", "/gone", "/edited"]), { etag: '"home-v1"' })
        .page("/same", leafPage("Same"), { etag: '"same-v1"' })
        .page("/gone", leafPage("Gone"), { etag: '"gone-v1"' })
        .page("/edited", leafPage("Edited"), { etag: '"edited-v1"' });
      await h.scrape();

      site
        .notFound("/gone")
        .page("/edited", leafPage("Edited", "Revised text."), { etag: '"edited-v2"' });
      const refresh = await h.refresh();

      expect(refresh.status).toBe(PipelineJobStatus.COMPLETED);
      expect(h.outcomeOf(site.url("/same"))).toBe(PageOutcome.Unchanged);
      expect(h.outcomeOf(site.url("/gone"))).toBe(PageOutcome.Absent);
      expect(h.outcomeOf(site.url("/edited"))).toBe(PageOutcome.Stored);
      // Four stored pages, four outcomes; only the edited page indexed anew.
      expect(lastEvent()).toMatchObject({
        pagesScraped: 4,
        totalPages: 4,
        pagesIndexed: 1,
      });
      expect(refresh.progressPages).toBe(4);
      expect(refresh.progressMaxPages).toBe(4);
      expect(refresh.progressPagesIndexed).toBe(1);
    });
  });
});
