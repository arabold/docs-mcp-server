/**
 * End-to-end tests for how a page with no extractable content is recorded.
 *
 * The `scrape-progress-reporting` capability draws a distinction that matters
 * across refreshes: a page that is genuinely empty is recorded as empty and its
 * validator stored, while a page whose pipeline errored is left alone and its
 * validator withheld. Withholding is what keeps a transient extraction fault
 * from becoming permanent: store the etag and the next refresh answers `304`
 * and never retries.
 *
 * That is a property of a sequence of refreshes, so unit tests over a single
 * call cannot show it. These tests drive real refresh cycles against a mock
 * site and assert on the stored page records.
 */

import { describe, expect, it } from "vitest";
import { PipelineJobStatus } from "../src/pipeline/types";
import { PageOutcome } from "../src/scraper/types";
import { emptyPage, leafPage, mockSite } from "./mock-site";
import { usePipelineHarness } from "./pipeline-harness";

/** A distinctive phrase, so its disappearance is unambiguous. */
const PHRASE = "Kumquat telemetry manifesto";

/** Accepted by the document pipeline on its type, then fails to parse. */
const BROKEN_PDF = new TextEncoder().encode("%PDF-1.4 not actually a pdf at all");

describe("Empty page and extraction failure refresh handling E2E", () => {
  const site = mockSite("http://empty-docs.example.com");
  const ARTICLE = site.url("/article");
  const h = usePipelineHarness({
    library: "empty-lib",
    version: "1.0.0",
    defaults: { url: ARTICLE, maxPages: 10, maxDepth: 1 },
  });

  it("records a page that became empty and stores its new etag", async () => {
    site.page("/article", leafPage("Article", `${PHRASE}.`), { etag: '"article-v1"' });
    expect((await h.scrape()).status).toBe(PipelineJobStatus.COMPLETED);
    expect(await h.contentOf(ARTICLE)).toContain(PHRASE);

    // The page is now genuinely empty: valid HTML, clean pipeline run, no text.
    site.page("/article", emptyPage(), { etag: '"article-v2"' });
    expect((await h.refresh()).status).toBe(PipelineJobStatus.COMPLETED);

    // The outcome is named, not inferred from a null result. The page still
    // exists, its old content is gone, and the validator moved forward because
    // the response was an accurate statement that it is empty.
    expect(h.outcomeOf(ARTICLE)).toBe(PageOutcome.Empty);
    expect((await h.storedPage(ARTICLE))?.etag).toBe('"article-v2"');
    expect(await h.contentOf(ARTICLE)).toBe("");
    expect(await h.search("kumquat")).toEqual([]);
  });

  it("keeps the page through an extraction failure and retries it next refresh", async () => {
    site.page("/article", leafPage("Article", `${PHRASE}.`), { etag: '"article-v1"' });
    expect((await h.scrape()).status).toBe(PipelineJobStatus.COMPLETED);

    // Refresh 1: a transient extraction failure. We learned nothing about the
    // page, so nothing about it changed, and the server's new validator is
    // withheld.
    site.page("/article", BROKEN_PDF, {
      type: "application/pdf",
      etag: '"article-v2-broken"',
    });
    expect((await h.refresh()).status).toBe(PipelineJobStatus.COMPLETED);
    expect(await h.contentOf(ARTICLE)).toContain(PHRASE);
    expect((await h.storedPage(ARTICLE))?.etag).toBe('"article-v1"');

    // Refresh 2: the conditional request still carries v1, so the server has
    // no reason to answer 304, and the fault is retried rather than frozen in
    // place. Had the broken etag been stored, it would have been sent instead.
    site.page("/article", leafPage("Article", `${PHRASE}, restored.`), {
      etag: '"article-v3"',
    });
    expect((await h.refresh()).status).toBe(PipelineJobStatus.COMPLETED);

    expect(site.requestsTo("/article").at(-1)?.ifNoneMatch).toBe('"article-v1"');
    expect(await h.contentOf(ARTICLE)).toContain(`${PHRASE}, restored.`);
    expect((await h.storedPage(ARTICLE))?.etag).toBe('"article-v3"');
  });

  it("keeps an empty page empty across a 304 refresh", async () => {
    // A page recorded as empty carries a validator, so subsequent refreshes
    // cost one conditional request and write nothing.
    site.page("/article", emptyPage(), { etag: '"empty-v1"' });
    expect((await h.scrape()).status).toBe(PipelineJobStatus.COMPLETED);
    expect((await h.storedPage(ARTICLE))?.etag).toBe('"empty-v1"');

    expect((await h.refresh()).status).toBe(PipelineJobStatus.COMPLETED);

    expect(site.requestsTo("/article").at(-1)?.ifNoneMatch).toBe('"empty-v1"');
    // Unchanged, not empty: the two outcomes stay distinguishable.
    expect(h.outcomeOf(ARTICLE)).toBe(PageOutcome.Unchanged);
    expect((await h.storedPage(ARTICLE))?.etag).toBe('"empty-v1"');
    expect(await h.contentOf(ARTICLE)).toBe("");
  });
});
