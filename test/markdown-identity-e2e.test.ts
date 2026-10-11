/**
 * End-to-end tests for Markdown variant page identity.
 *
 * A published Markdown file is a representation of a page, not a page of its
 * own. Sites express that in two incompatible ways: some list canonical URLs in
 * `llms.txt` and serve a `.md` alongside each, others list the `.md` URLs
 * directly. Indexed naively the second shape stores every page under a `.md`
 * URL, and a site reachable both ways stores each document twice.
 *
 * These tests drive whole crawls against mock sites of each shape, because the
 * property at stake (one document, one identity, whichever route reached it)
 * only exists across a crawl. Unit tests cover the rule itself.
 */

import { describe, expect, it } from "vitest";
import { PipelineJobStatus } from "../src/pipeline/types";
import { ScrapeMode } from "../src/scraper/types";
import { hubPage, leafPage, llmsTxt, mockSite } from "./mock-site";
import { usePipelineHarness } from "./pipeline-harness";

/**
 * A Markdown document whose heading only Markdown parsing recognises: the
 * splitter rewrites the underlined form as `# Guide`, while the plain-text
 * pipeline would keep the `=====` line.
 */
const GUIDE_MARKDOWN = "Guide\n=====\n\nMarkdown body.\n";

describe("Markdown variant identity E2E", () => {
  const site = mockSite("http://md-docs.example.com");
  const h = usePipelineHarness({
    library: "md-lib",
    version: "1.0.0",
    defaults: { url: site.url("/") },
  });
  const GUIDE = site.url("/guide");

  it.each([
    { type: "text/markdown", markdownFirst: true },
    { type: "text/plain", markdownFirst: true },
    { type: "text/markdown", markdownFirst: false },
    { type: "text/plain", markdownFirst: false },
  ])(
    "keeps one page, as Markdown, for a .md served as $type and its HTML twin (Markdown reached first: $markdownFirst)",
    async ({ type, markdownFirst }) => {
      // vite.dev serves its .md alternates as text/markdown and react.dev as
      // text/plain. The extension is the author's statement about the format,
      // so both are parsed as Markdown, and both outrank an HTML copy of the
      // page whichever of the two the crawl stores first.
      if (markdownFirst) {
        // The vite.dev shape: llms.txt seeds are queued ahead of the root's links.
        site
          .page("/llms.txt", llmsTxt([site.url("/guide.md")]), { type: "text/plain" })
          .page("/", hubPage(["/guide"]));
      } else {
        site.page("/", hubPage(["/guide", "/guide.md"]));
      }
      site
        .page("/guide.md", GUIDE_MARKDOWN, { type })
        .page("/guide", leafPage("Guide", "HTML body."));

      expect((await h.scrape()).status).toBe(PipelineJobStatus.COMPLETED);

      // One identity, reached twice, and never recorded under the .md URL.
      expect(await h.storedUrls()).toEqual([site.url("/"), GUIDE]);
      const content = await h.contentOf(GUIDE);
      expect(content).toContain("Markdown body.");
      expect(content).not.toContain("HTML body.");
      // Parsed as Markdown: the underlined heading was recognised.
      expect(content).toContain("# Guide");
      expect(content).not.toContain("=====");
    },
  );

  it("keeps a .md URL that serves HTML under its own identity", async () => {
    // A server ignoring the extension must not have its response folded onto a
    // canonical URL it does not serve.
    site
      .page("/", hubPage(["/stale.md"]))
      .page("/stale.md", leafPage("Soft 404", "No such document."));

    expect((await h.scrape()).status).toBe(PipelineJobStatus.COMPLETED);

    expect(await h.storedUrls()).toEqual([site.url("/"), site.url("/stale.md")]);
  });

  it("refreshes the representation the content came from, not the identity", async () => {
    // The identity is an assertion about where the page lives; the retrieval
    // location is a fact about where its bytes came from. Refreshing the former
    // would fetch a different representation, and send the stored validator to
    // a resource that never issued it. The site serves nothing at `/guide`, so
    // a request there would fail the test as unmatched.
    site
      .page("/llms.txt", llmsTxt([site.url("/guide.md")]), { type: "text/plain" })
      .page("/", leafPage("Home", "hi"))
      .page("/guide.md", "# Guide\n\nOriginal markdown body.", {
        type: "text/markdown",
        etag: '"md-v1"',
      });
    expect((await h.scrape()).status).toBe(PipelineJobStatus.COMPLETED);
    expect((await h.storedPage(GUIDE))?.content_url).toBe(site.url("/guide.md"));

    site.page("/guide.md", "# Guide\n\nUpdated markdown body.", {
      type: "text/markdown",
      etag: '"md-v2"',
    });
    expect((await h.refresh()).status).toBe(PipelineJobStatus.COMPLETED);

    expect(site.requestsTo("/guide.md").at(-1)?.ifNoneMatch).toBe('"md-v1"');
    // The page updated rather than freezing at what it was first indexed with.
    const content = await h.contentOf(GUIDE);
    expect(content).toContain("Updated markdown body");
    expect(content).not.toContain("Original markdown body");
  });

  it("collapses spellings that differ only by a trailing slash or fragment", async () => {
    // The residual duplicate classes after `.md` identity alone: an llms.txt
    // entry reaching `/config.md` while a crawl reaches `/config/` and an
    // in-page anchor reaches `/config/#opts`. All three name one page.
    site
      .page("/llms.txt", llmsTxt([site.url("/config.md")]), { type: "text/plain" })
      .page("/", hubPage(["/config/", "/config/#opts"]))
      .page("/config.md", "# Config\n\nConfiguration reference.", {
        type: "text/markdown",
      })
      .page("/config/", leafPage("Config", "HTML copy."));

    expect((await h.scrape()).status).toBe(PipelineJobStatus.COMPLETED);

    expect(await h.storedUrls()).toEqual([site.url("/"), site.url("/config")]);
  });

  it("keeps hash routes apart but still collapses a trailing slash", async () => {
    // With preserveHashes the fragment names the route, so `/#/alpha` and
    // `/#/beta` are different pages and neither slash nor fragment may be
    // trimmed. The server sends the same document for every route, as a
    // single-page app does. Preserving fragments must not switch off path
    // normalization for the rest of the crawl, though: that left `/docs` and
    // `/docs/` as two pages on exactly the sites the option exists for.
    // `/docs/` has no route, so requesting it would fail the test.
    site
      .page("/", hubPage(["/#/alpha", "/#/beta", "/docs", "/docs/"], "App"))
      .page("/docs", leafPage("Docs", "Docs body."));

    // Hash routes only exist in a browser, so this crawl renders. Both checks
    // share one crawl because each launches Chromium.
    const job = await h.scrape({
      preserveHashes: true,
      scrapeMode: ScrapeMode.Playwright,
    });
    expect(job.status).toBe(PipelineJobStatus.COMPLETED);

    expect(await h.storedUrls()).toEqual(
      ["/", "/#/alpha", "/#/beta", "/docs"].map(site.url),
    );
  });

  it("keeps the stored markdown when an html twin extracts nothing", async () => {
    // An empty representation competes on the same terms as a full one.
    // Without that, the HTML twin's empty record replaced the Markdown already
    // stored under the identity and the page was left with no chunks at all.
    site
      .page("/llms.txt", llmsTxt([site.url("/guide.md")]), { type: "text/plain" })
      .page("/", hubPage(["/guide"]))
      .page("/guide.md", "# Guide\n\nMarkdown guide body.", { type: "text/markdown" })
      .page("/guide", "<html><body></body></html>");

    expect((await h.scrape()).status).toBe(PipelineJobStatus.COMPLETED);

    expect(await h.contentOf(GUIDE)).toContain("Markdown guide body");
  });

  it("records the retrieval location for a page that turns out to be empty", async () => {
    // An empty page still has a retrieval location. Dropping it stored NULL, so
    // the next refresh asked the identity instead of the markdown file it was
    // read from, and sent that file's validator to a resource that never
    // issued it.
    site
      .page("/llms.txt", llmsTxt([site.url("/guide.md")]), { type: "text/plain" })
      .page("/", leafPage("Home", "Home body."))
      .page("/guide.md", "   \n\n   \n", {
        type: "text/markdown",
        etag: '"md-empty-v1"',
      });
    expect((await h.scrape()).status).toBe(PipelineJobStatus.COMPLETED);
    expect((await h.storedPage(GUIDE))?.content_url).toBe(site.url("/guide.md"));

    // The consequence that matters: the refresh goes back to the markdown file
    // with the validator that file issued, and finds content there.
    site.reset();
    site
      .page("/", leafPage("Home", "Home body."))
      .page("/guide.md", "# Guide\n\nThe page has content again.", {
        type: "text/markdown",
        etag: '"md-v2"',
      });
    expect((await h.refresh()).status).toBe(PipelineJobStatus.COMPLETED);

    expect(site.requestsTo("/guide.md").map((r) => r.ifNoneMatch)).toEqual([
      '"md-empty-v1"',
    ]);
    expect(await h.contentOf(GUIDE)).toContain("content again");
  });

  it("does not delete a live page because its markdown alternate is gone", async () => {
    // A refresh asks the location the content came from, which for a published
    // Markdown file is not the page's own URL. A 404 there says the file was
    // withdrawn, not that the page was: sites drop their `.md` alternates and
    // keep serving the pages. Deleting on that answer removed live pages from
    // the index without ever requesting them, and, because refresh 404s are
    // deliberately excluded from the failure threshold, reported success.
    site
      .page("/llms.txt", llmsTxt([site.url("/guide.md")]), { type: "text/plain" })
      .page("/", leafPage("Home", "Home body."), { etag: '"home-v1"' })
      .page("/guide.md", "# Guide\n\nGuide body about widgets.", {
        type: "text/markdown",
        etag: '"md-v1"',
      });
    expect((await h.scrape({ maxDepth: 2 })).status).toBe(PipelineJobStatus.COMPLETED);
    expect(await h.storedUrls()).toContain(GUIDE);

    // The site withdraws its alternates; the HTML page is still served.
    site.reset();
    site
      .page("/", leafPage("Home", "Home body."), { etag: '"home-v1"' })
      .notFound("/guide.md")
      .page("/guide", leafPage("Guide", "Guide body about widgets."));
    expect((await h.refresh()).status).toBe(PipelineJobStatus.COMPLETED);

    expect(await h.storedUrls()).toContain(GUIDE);
    expect(await h.contentOf(GUIDE)).toContain("widgets");
    // The page was asked without the validator the withdrawn file issued.
    expect(site.requestsTo("/guide").map((r) => r.ifNoneMatch)).toEqual([null]);
  });

  it("deletes the page when neither the alternate nor the page itself is served", async () => {
    // The fallback asks the identity; if that is gone too, the page really is.
    site
      .page("/llms.txt", llmsTxt([site.url("/guide.md")]), { type: "text/plain" })
      .page("/", leafPage("Home", "Home body."), { etag: '"home-v1"' })
      .page("/guide.md", "# Guide\n\nGuide body about widgets.", {
        type: "text/markdown",
      });
    expect((await h.scrape({ maxDepth: 2 })).status).toBe(PipelineJobStatus.COMPLETED);

    site.reset();
    site
      .page("/", leafPage("Home", "Home body."), { etag: '"home-v1"' })
      .notFound("/guide.md")
      .notFound("/guide");
    expect((await h.refresh()).status).toBe(PipelineJobStatus.COMPLETED);

    expect(site.wasRequested("/guide")).toBe(true);
    expect(await h.storedUrls()).toEqual([site.url("/")]);
  });

  it("keeps the markdown when refreshing an index that predates one identity", async () => {
    // An index built before `.md` URLs folded onto their canonical page holds
    // both representations as separate rows. The first refresh re-fetches both,
    // and they now resolve to one identity. Retiring the old row before the two
    // could be compared let the HTML overwrite the Markdown, silently, on
    // upgrade, for exactly the indexes this change exists to repair.
    site.page("/", leafPage("Home", "Home body."));
    expect((await h.scrape({ maxDepth: 0 })).status).toBe(PipelineJobStatus.COMPLETED);

    // The pre-upgrade shape, in the order an llms.txt-driven crawl produced it:
    // the .md entries first, the crawled HTML pages after.
    for (const [url, mime, body] of [
      [site.url("/guide.md"), "text/markdown", "Legacy markdown guide body."],
      [GUIDE, "text/html", "Legacy HTML guide body."],
    ] as const) {
      await h.docService.addScrapeResult("md-lib", "1.0.0", 1, {
        url,
        title: "Guide",
        sourceContentType: mime,
        contentType: mime,
        textContent: body,
        links: [],
        errors: [],
        chunks: [{ types: ["text"], content: body, section: { level: 0, path: [] } }],
      });
    }

    site
      .page("/guide", leafPage("Guide", "Fresh HTML guide body."))
      .page("/guide.md", "# Guide\n\nFresh markdown guide body.", {
        type: "text/markdown",
      });
    expect((await h.refresh()).status).toBe(PipelineJobStatus.COMPLETED);

    // One identity, and the published Markdown is what it holds.
    expect(await h.storedUrls()).toEqual([site.url("/"), GUIDE]);
    const content = await h.contentOf(GUIDE);
    expect(content).toContain("Fresh markdown guide body");
    expect(content).not.toContain("Fresh HTML guide body");
  });
});
