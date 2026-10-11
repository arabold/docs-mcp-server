/**
 * End-to-end tests for the unprocessable-content gates.
 *
 * The `unprocessable-content-filtering` capability defines two gates: a
 * queue-time filter that rejects binary-media links before any request is made,
 * and a fetch-time filter that abandons a response whose served `Content-Type`
 * no pipeline can read. `capability.test.ts` covers the predicate in isolation;
 * these tests cover the properties that only a whole-pipeline run can show:
 * that no request is issued for a filtered link, that a skip stores nothing and
 * keeps what a refresh already stored, and that skips stay out of the
 * failure-rate accounting while genuine failures still abort the crawl.
 */

import { describe, expect, it } from "vitest";
import { PipelineJobStatus } from "../src/pipeline/types";
import { PageOutcome } from "../src/scraper/types";
import { hubPage, leafPage, mockSite } from "./mock-site";
import { usePipelineHarness } from "./pipeline-harness";

const BINARY = new TextEncoder().encode("\x89PNG\r\n\x1a\n binary payload");

describe("Unprocessable content gates E2E", () => {
  const site = mockSite("http://assets-docs.example.com");
  const h = usePipelineHarness({
    library: "assets-lib",
    version: "1.0.0",
    defaults: { url: site.url("/") },
  });

  /** Twelve extensionless asset links behind two readable pages. */
  const ASSET_LINKS = Array.from({ length: 12 }, (_, i) => `/asset${i}`);

  /**
   * Serves a hub linking two readable pages and then the twelve asset links,
   * each answered by `serveAsset`.
   */
  function assetHeavySite(serveAsset: (path: string) => void): void {
    site
      .page("/", hubPage(["/one", "/two", ...ASSET_LINKS]))
      .page("/one", leafPage("One"))
      .page("/two", leafPage("Two"));
    for (const link of ASSET_LINKS) serveAsset(link);
  }

  it("never requests a binary-media link rejected at queue time", async () => {
    // The image has no route: had the gate let it through, the request would
    // fail as unmatched as well as the assertion below.
    site
      .page("/", hubPage(["/guide", "/assets/diagram.png"]))
      .page("/guide", leafPage("Guide"));

    const job = await h.scrape();

    expect(job.status).toBe(PipelineJobStatus.COMPLETED);
    expect(site.wasRequested("/assets/diagram.png")).toBe(false);
    // Rejected at queue time means it never became an item at all, so it has
    // no outcome event, unlike a fetch-time skip.
    expect(h.events.map((e) => e.currentUrl)).toEqual(["/", "/guide"].map(site.url));
  });

  it("skips an extensionless URL that serves an image and stores nothing", async () => {
    // No extension, so only the served Content-Type can decide: this is the
    // fetch-time gate, and it reports the item as skipped rather than storing
    // or failing it.
    site
      .page("/", hubPage(["/guide", "/chart"]))
      .page("/guide", leafPage("Guide"))
      .page("/chart", BINARY, { type: "image/png" });

    const job = await h.scrape();

    expect(job.status).toBe(PipelineJobStatus.COMPLETED);
    // The request was made: the gate can only act once the headers arrive.
    expect(site.wasRequested("/chart")).toBe(true);
    expect(h.events.map((e) => [e.currentUrl, e.outcome])).toEqual([
      [site.url("/"), PageOutcome.Stored],
      [site.url("/guide"), PageOutcome.Stored],
      [site.url("/chart"), PageOutcome.Skipped],
    ]);
    expect(await h.storedUrls()).toEqual([site.url("/"), site.url("/guide")]);
  });

  it("does not let an asset-heavy site trip the failure threshold", async () => {
    // The motivating scenario: twelve skips and no genuine failures. Counted as
    // failures, the skips would pass the default threshold (abort above 50%)
    // as soon as the ten-attempt sample was reached.
    assetHeavySite((link) =>
      site.page(link, BINARY, { type: "application/octet-stream" }),
    );

    const job = await h.scrape();

    expect(job.status).toBe(PipelineJobStatus.COMPLETED);
    expect(job.errorMessage).toBeNull();
    const skipped = h.events.filter((e) => e.outcome === PageOutcome.Skipped);
    expect(skipped.map((e) => e.currentUrl)).toEqual(ASSET_LINKS.map(site.url));
    expect(await h.storedUrls()).toEqual(["/", "/one", "/two"].map(site.url));
  });

  it("aborts the crawl once genuine failures pass the threshold", async () => {
    // The same site with the assets gone. Each 404 is a genuine child failure,
    // so after the tenth attempt (two pages read, eight missing) the failure
    // rate of 0.8 passes the default threshold and the crawl stops.
    assetHeavySite((link) => site.notFound(link));

    const job = await h.scrape();

    expect(job.status).toBe(PipelineJobStatus.FAILED);
    expect(job.errorMessage).toContain("Scrape aborted after 8/10 child pages failed");
    expect(site.wasRequested("/asset7")).toBe(true);
    expect(site.wasRequested("/asset8")).toBe(false);
  });

  it("fails loudly when the requested root itself is unprocessable", async () => {
    // A skip is silent for a child page, but the URL the user actually asked
    // for must not fail silently.
    site.page("/", BINARY, { type: "application/octet-stream" });

    const job = await h.scrape();

    expect(job.status).toBe(PipelineJobStatus.FAILED);
    // The type itself, not just the words "content type": a user who mistyped
    // a URL needs to see what was actually served.
    expect(job.errorMessage).toContain("application/octet-stream");
    expect(job.errorMessage).toContain(site.url("/"));
  });

  it("admits a script extension the mime package resolves to application/*", async () => {
    // `.ps` resolves to application/postscript, which is not binary media, so
    // the queue-time gate must defer to the served Content-Type rather than
    // rejecting the link on its extension.
    site
      .page("/", hubPage(["/Guess/guess.ps"]))
      .page("/Guess/guess.ps", "#!/bin/sh\necho hello\n", { type: "text/plain" });

    const job = await h.scrape();

    expect(job.status).toBe(PipelineJobStatus.COMPLETED);
    expect(site.wasRequested("/Guess/guess.ps")).toBe(true);
    expect(await h.storedUrls()).toContain(site.url("/Guess/guess.ps"));
  });

  it("keeps a stored page that turns unprocessable on refresh", async () => {
    // A skip means the body was never read, so it says nothing about the page:
    // a refresh must not erase what is stored, nor take the new validator.
    site
      .page("/", hubPage(["/report"]), { etag: '"home-v1"' })
      .page("/report", leafPage("Report", "Quarterly figures."), { etag: '"report-v1"' });
    await h.scrape();

    site.page("/report", BINARY, {
      type: "application/octet-stream",
      etag: '"report-v2"',
    });
    const refresh = await h.refresh();

    expect(refresh.status).toBe(PipelineJobStatus.COMPLETED);
    expect(h.outcomeOf(site.url("/report"))).toBe(PageOutcome.Skipped);
    expect(await h.contentOf(site.url("/report"))).toContain("Quarterly figures.");
    expect((await h.storedPage(site.url("/report")))?.etag).toBe('"report-v1"');
  });
});
