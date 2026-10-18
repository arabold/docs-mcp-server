/**
 * End-to-end tests for refreshing an indexed website, and for how a crawl
 * handles pages it cannot read.
 *
 * A refresh replays the stored pages as conditional requests: `304` keeps a
 * page, `404` deletes it, `200` replaces it, and links on a changed page are
 * crawled as usual. These tests run whole jobs against a mock site and assert on
 * the requests the site received and on what the store holds afterwards.
 *
 * Refreshing a local directory is covered by `local-file-refresh-e2e.test.ts`.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { PipelineJobStatus } from "../src/pipeline/types";
import { PageOutcome, ScrapeMode } from "../src/scraper/types";
import { hubPage, leafPage, mockSite } from "./mock-site";
import { usePipelineHarness } from "./pipeline-harness";

describe("Refresh pipeline E2E", () => {
  const site = mockSite("http://test-docs.example.com");
  const h = usePipelineHarness({
    library: "test-lib",
    version: "1.0.0",
    defaults: { url: site.url("/"), maxDepth: 2 },
  });

  describe("refresh outcomes", () => {
    it("keeps every page when each conditional request is answered 304", async () => {
      site
        .page("/", hubPage(["/page1"]), { etag: '"home-v1"' })
        .page("/page1", leafPage("Page 1", "Stable content"), { etag: '"page1-v1"' });
      await h.scrape();

      const refresh = await h.refresh();

      expect(refresh.status).toBe(PipelineJobStatus.COMPLETED);
      // Each page was asked for with the validator stored for it, and the 304
      // left it as it was.
      expect(site.requestsTo("/").at(-1)?.ifNoneMatch).toBe('"home-v1"');
      expect(site.requestsTo("/page1").at(-1)?.ifNoneMatch).toBe('"page1-v1"');
      expect(h.outcomeOf(site.url("/"))).toBe(PageOutcome.Unchanged);
      expect(h.outcomeOf(site.url("/page1"))).toBe(PageOutcome.Unchanged);
      expect(await h.storedUrls()).toEqual([site.url("/"), site.url("/page1")]);
      expect(await h.contentOf(site.url("/page1"))).toContain("Stable content");
    });

    it("deletes a page that answers 404 on refresh", async () => {
      site
        .page("/", hubPage(["/page1", "/page2"]), { etag: '"home-v1"' })
        .page("/page1", leafPage("Page 1", "Content of page 1"), { etag: '"page1-v1"' })
        .page("/page2", leafPage("Page 2", "Content of page 2"), { etag: '"page2-v1"' });
      await h.scrape();

      site.notFound("/page2");
      const refresh = await h.refresh();

      expect(refresh.status).toBe(PipelineJobStatus.COMPLETED);
      expect(h.outcomeOf(site.url("/page2"))).toBe(PageOutcome.Absent);
      expect(await h.storedUrls()).toEqual([site.url("/"), site.url("/page1")]);
      const results = await h.search("Content of page");
      expect(results.map((r) => r.url)).not.toContain(site.url("/page2"));
      expect(await h.contentOf(site.url("/page1"))).toContain("Content of page 1");
    });

    it("replaces the content of a page that changed", async () => {
      site
        .page("/", hubPage(["/page1"]), { etag: '"home-v1"' })
        .page("/page1", leafPage("Page 1", "Original content version 1"), {
          etag: '"page1-v1"',
        });
      await h.scrape();

      site.page("/page1", leafPage("Page 1", "Updated content version 2"), {
        etag: '"page1-v2"',
      });
      const refresh = await h.refresh();

      expect(refresh.status).toBe(PipelineJobStatus.COMPLETED);
      // The request went to the page's own URL with the validator it issued;
      // the page had moved on, so it answered with content rather than 304.
      expect(site.requestsTo("/page1").at(-1)?.ifNoneMatch).toBe('"page1-v1"');
      expect(h.outcomeOf(site.url("/page1"))).toBe(PageOutcome.Stored);

      const content = await h.contentOf(site.url("/page1"));
      expect(content).toContain("Updated content version 2");
      expect(content).not.toContain("Original content version 1");
      expect((await h.storedPage(site.url("/page1")))?.etag).toBe('"page1-v2"');
      const stale = await h.search("original content");
      expect(stale.some((r) => r.content.includes("Original content"))).toBe(false);
    });

    it("refreshes several pages at once with each outcome landing on its own page", async () => {
      // The crawl keeps up to maxConcurrency items in flight, so the store sees
      // these results interleaved rather than one page at a time.
      h.config.scraper.maxConcurrency = 3;
      const leaves = ["/a", "/b", "/c", "/d", "/e"];
      site.page("/", hubPage(leaves), { etag: '"home-v1"' });
      for (const path of leaves) {
        site.page(path, leafPage(path, `Original ${path}`), { etag: `"${path}-v1"` });
      }
      await h.scrape();

      site
        .notFound("/b")
        .page("/c", leafPage("/c", "Updated /c"), { etag: '"/c-v2"' })
        .notFound("/e");
      const refresh = await h.refresh();

      expect(refresh.status).toBe(PipelineJobStatus.COMPLETED);
      expect(h.outcomeOf(site.url("/a"))).toBe(PageOutcome.Unchanged);
      expect(h.outcomeOf(site.url("/b"))).toBe(PageOutcome.Absent);
      expect(h.outcomeOf(site.url("/c"))).toBe(PageOutcome.Stored);
      expect(h.outcomeOf(site.url("/d"))).toBe(PageOutcome.Unchanged);
      expect(h.outcomeOf(site.url("/e"))).toBe(PageOutcome.Absent);
      expect(await h.storedUrls()).toEqual(
        ["/", "/a", "/c", "/d"].map((path) => site.url(path)),
      );
      expect(await h.contentOf(site.url("/c"))).toContain("Updated /c");
      expect(await h.contentOf(site.url("/d"))).toContain("Original /d");
    });

    it("indexes pages first linked from a page that changed", async () => {
      site
        .page("/", hubPage(["/page1"]), { etag: '"home-v1"' })
        .page("/page1", leafPage("Page 1", "Original page"), { etag: '"page1-v1"' });
      await h.scrape();

      site
        .page("/", hubPage(["/page1", "/page2"]), { etag: '"home-v2"' })
        .page("/page2", leafPage("Page 2", "Newly added page"));
      const refresh = await h.refresh();

      expect(refresh.status).toBe(PipelineJobStatus.COMPLETED);
      expect(await h.storedUrls()).toEqual([
        site.url("/"),
        site.url("/page1"),
        site.url("/page2"),
      ]);
      expect(await h.contentOf(site.url("/page2"))).toContain("Newly added page");
    });

    it("reuses the options the version was scraped with", async () => {
      site
        .page("/", hubPage(["/docs/guide"]), { etag: '"home-v1"' })
        .page("/docs/guide", leafPage("Guide"), { etag: '"guide-v1"' });
      await h.scrape({
        headers: { "X-Docs-Token": "token-1" },
        includePatterns: ["/docs/**"],
        excludePatterns: ["/docs/internal/**"],
      });
      const scrapeRequestCount = site.requests.length;

      // The home page changes to link one page each pattern admits or rejects.
      const links = ["/docs/guide", "/docs/new", "/docs/internal/secret", "/blog"];
      site
        .page("/", hubPage(links), { etag: '"home-v2"' })
        .page("/docs/new", leafPage("New"));
      const refresh = await h.refresh();

      expect(refresh.status).toBe(PipelineJobStatus.COMPLETED);
      const refreshRequests = site.requests.slice(scrapeRequestCount);
      expect(refreshRequests.map((r) => r.headers.get("x-docs-token"))).toEqual(
        refreshRequests.map(() => "token-1"),
      );
      expect(site.wasRequested("/docs/internal/secret")).toBe(false);
      expect(site.wasRequested("/blog")).toBe(false);
      expect(await h.storedUrls()).toEqual([
        site.url("/"),
        site.url("/docs/guide"),
        site.url("/docs/new"),
      ]);
      // Fetch mode carried over: a refresh that lost it would render in a browser.
      expect(refresh.scraperOptions?.scrapeMode).toBe(ScrapeMode.Fetch);
    });
  });

  describe("crawl errors", () => {
    it("skips a broken link and completes the crawl", async () => {
      site
        .page("/", hubPage(["/valid-page", "/broken-link"]))
        .page("/valid-page", leafPage("Valid Page", "This page exists"))
        .notFound("/broken-link");

      const job = await h.scrape();

      expect(job.status).toBe(PipelineJobStatus.COMPLETED);
      expect(h.outcomeOf(site.url("/broken-link"))).toBe(PageOutcome.Absent);
      expect(await h.storedUrls()).toEqual([site.url("/"), site.url("/valid-page")]);
    });

    it("fails the job when the requested root is not found", async () => {
      site.notFound("/");

      const job = await h.scrape();

      expect(job.status).toBe(PipelineJobStatus.FAILED);
      expect(job.errorMessage).toContain(`Root page not found: ${site.url("/")}`);
      expect(await h.storedUrls()).toEqual([]);
    });

    it("drops a page that stalls past the fetch timeout and crawls the rest", async () => {
      // The stall only ends when the fetcher gives up, so the timeout has to be
      // real. The other pages answer in-process within a few milliseconds, so
      // a short one still leaves them a wide margin, and one retry with a short
      // backoff exercises timeout-then-retry in a fraction of a second.
      h.config.scraper.fetcher.timeoutMs = 100;
      h.config.scraper.fetcher.maxRetries = 1;
      h.config.scraper.fetcher.baseDelayMs = 10;
      site
        .page("/", hubPage(["/page1", "/page2", "/timeout-page"]))
        .page("/page1", leafPage("Page 1", "Working page"))
        .page("/page2", leafPage("Page 2", "Also working"))
        .stall("/timeout-page");

      const job = await h.scrape({ ignoreErrors: true });

      expect(job.status).toBe(PipelineJobStatus.COMPLETED);
      // Both attempts reached the stalled page: the first timed out and was
      // retried, so the page was dropped by the timeout and not by some gate.
      expect(site.requestsTo("/timeout-page")).toHaveLength(2);
      expect(h.outcomeOf(site.url("/timeout-page"))).toBe(PageOutcome.Failed);
      expect(await h.storedUrls()).toEqual([
        site.url("/"),
        site.url("/page1"),
        site.url("/page2"),
      ]);
    });
  });

  describe("redirects", () => {
    it("indexes a redirected link under its final URL only", async () => {
      site
        .page("/", hubPage(["/old-url"]))
        .redirect("/old-url", "/new-url")
        .page("/new-url", leafPage("New Page", "Redirected content"));

      const job = await h.scrape();

      expect(job.status).toBe(PipelineJobStatus.COMPLETED);
      expect(await h.storedUrls()).toEqual([site.url("/"), site.url("/new-url")]);
      expect(await h.contentOf(site.url("/new-url"))).toContain("Redirected content");
    });

    it("moves a page to the end of a redirect chain on refresh", async () => {
      site
        .page("/", hubPage(["/page1"]), { etag: '"home-v1"' })
        .page("/page1", leafPage("Page 1", "Original location"), { etag: '"page1-v1"' });
      await h.scrape();

      site
        .redirect("/page1", "/page1-moved", 301)
        .redirect("/page1-moved", "/page1-new", 302)
        .page("/page1-new", leafPage("Page 1 New", "New location"));
      const refresh = await h.refresh();

      expect(refresh.status).toBe(PipelineJobStatus.COMPLETED);
      // The page now lives at the end of the chain, and nowhere else: a
      // half-done move would leave the old row behind, stale and searchable.
      expect(await h.storedUrls()).toEqual([site.url("/"), site.url("/page1-new")]);
      expect(await h.contentOf(site.url("/page1-new"))).toContain("New location");
      const stale = await h.search("Original location");
      expect(stale.some((r) => r.content.includes("Original location"))).toBe(false);
    });
  });

  describe("network access policy (allowlist mode)", () => {
    const allowed = mockSite("http://docs.allowed.example");
    // An address from a documentation range (RFC 5737): the access policy checks
    // it against allowedCidrs directly, where a host name would need a real DNS
    // lookup before it could be refused.
    const blocked = mockSite("http://203.0.113.10");

    beforeEach(() => {
      const { network } = h.config.scraper.security;
      network.mode = "allowlist";
      network.allowedHosts = ["docs.allowed.example"];
      network.allowedCidrs = [];
      network.allowPrivateNetworks = false;
    });

    it("indexes a host on the allowlist", async () => {
      allowed.page("/", leafPage("Allowed"));

      const job = await h.scrape({ url: allowed.url("/"), maxDepth: 0 });

      expect(job.status).toBe(PipelineJobStatus.COMPLETED);
      expect(await h.storedUrls()).toEqual([allowed.url("/")]);
    });

    // The renderer fetches a page's scripts and frames itself, so their redirects
    // need the same check as the page's own.
    describe("rendering a page in playwright mode", () => {
      const metadata = "/latest/meta-data/";

      it("does not fetch the target of a script that redirects off the allowlist", async () => {
        allowed
          .page("/", '<html><head><script src="/app.js"></script></head><body>Hi</body></html>')
          .redirect("/app.js", blocked.url(metadata));
        blocked.page(metadata, "window.leaked = true;", { type: "text/javascript" });

        const job = await h.scrape({
          url: allowed.url("/"),
          maxDepth: 0,
          scrapeMode: ScrapeMode.Playwright,
        });

        expect(job.status).toBe(PipelineJobStatus.COMPLETED);
        expect(allowed.wasRequested("/app.js")).toBe(true);
        expect(blocked.requests).toEqual([]);
      });

      it("neither fetches nor indexes the target of a frame that redirects off the allowlist", async () => {
        allowed
          .page(
            "/",
            '<html><frameset cols="20%,80%"><frame src="/nav.html"><frame src="/main.html"></frameset></html>',
          )
          .page("/nav.html", "<html><body><p>Navigation frame text</p></body></html>")
          .redirect("/main.html", blocked.url(metadata));
        blocked.page(metadata, leafPage("Metadata", "Instance credentials"));

        const job = await h.scrape({
          url: allowed.url("/"),
          maxDepth: 0,
          scrapeMode: ScrapeMode.Playwright,
        });

        expect(job.status).toBe(PipelineJobStatus.COMPLETED);
        expect(blocked.requests).toEqual([]);
        const content = await h.contentOf(allowed.url("/"));
        expect(content).toContain("Navigation frame text");
        expect(content).not.toContain("Instance credentials");
      });
    });

    it("fails a job for an address off the allowlist without contacting it", async () => {
      const job = await h.scrape({ url: blocked.url("/"), maxDepth: 0 });

      expect(job.status).toBe(PipelineJobStatus.FAILED);
      expect(job.errorMessage).toContain("Security policy blocked network access");
      expect(blocked.requests).toEqual([]);
      expect(await h.storedUrls()).toEqual([]);
    });

    describe.each([ScrapeMode.Fetch, ScrapeMode.Playwright])("in %s mode", (scrapeMode) => {
      // Another host on the allowed site's domain. A link can only reach a
      // different host with scope "domain", and the address has to be a name
      // for that, so the policy looks it up in DNS: `.example` names do not
      // resolve, and an unresolved name is refused.
      const internal = mockSite("http://internal.allowed.example");

      it("does not follow a redirect to an address off the allowlist", async () => {
        allowed
          .page("/", hubPage(["/moved"]))
          .redirect("/moved", blocked.url("/latest/meta-data/"));

        const job = await h.scrape({
          url: allowed.url("/"),
          maxDepth: 1,
          ignoreErrors: true,
          scrapeMode,
        });

        expect(job.status).toBe(PipelineJobStatus.COMPLETED);
        expect(h.outcomeOf(allowed.url("/moved"))).toBe(PageOutcome.Failed);
        expect(blocked.requests).toEqual([]);
        expect(await h.storedUrls()).toEqual([allowed.url("/")]);
      });

      it("does not follow a link to a host off the allowlist", async () => {
        allowed.page("/", hubPage([internal.url("/admin")]));

        const job = await h.scrape({
          url: allowed.url("/"),
          maxDepth: 1,
          scope: "domain",
          ignoreErrors: true,
          scrapeMode,
        });

        expect(job.status).toBe(PipelineJobStatus.COMPLETED);
        expect(h.outcomeOf(internal.url("/admin"))).toBe(PageOutcome.Failed);
        expect(internal.requests).toEqual([]);
        expect(await h.storedUrls()).toEqual([allowed.url("/")]);
      });
    });
  });
});
