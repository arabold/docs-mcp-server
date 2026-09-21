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
 * property at stake — one document, one identity, whichever route reached it —
 * only exists across a crawl. Unit tests cover the rule itself.
 */

import nock from "nock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBusService } from "../src/events";
import { PipelineManager } from "../src/pipeline/PipelineManager";
import { PipelineJobStatus } from "../src/pipeline/types";
import { ScrapeMode, type ScraperOptions } from "../src/scraper/types";
import { DocumentManagementService } from "../src/store/DocumentManagementService";
import { type AppConfig, loadConfig } from "../src/utils/config";

const TEST_BASE_URL = "http://md-docs.example.com";
const TEST_LIBRARY = "md-lib";
const TEST_VERSION = "1.0.0";

describe("Markdown variant identity E2E", () => {
  let docService: DocumentManagementService;
  let pipelineManager: PipelineManager;
  let appConfig: AppConfig;

  beforeEach(async () => {
    appConfig = loadConfig();
    appConfig.app.storePath = ":memory:";
    appConfig.app.embeddingModel = "";
    appConfig.scraper.security.network.allowPrivateNetworks = true;
    appConfig.scraper.maxConcurrency = 1;

    const eventBus = new EventBusService();
    docService = new DocumentManagementService(eventBus, appConfig);
    await docService.initialize();
    pipelineManager = new PipelineManager(docService, eventBus, {
      recoverJobs: false,
      appConfig,
    });
    await pipelineManager.start();

    nock.cleanAll();
  });

  afterEach(async () => {
    await pipelineManager.stop();
    await docService.shutdown();
    nock.cleanAll();
  });

  async function runScrape(options: Partial<ScraperOptions> = {}) {
    const jobId = await pipelineManager.enqueueScrapeJob(TEST_LIBRARY, TEST_VERSION, {
      url: `${TEST_BASE_URL}/`,
      library: TEST_LIBRARY,
      version: TEST_VERSION,
      maxPages: 100,
      maxDepth: 3,
      scrapeMode: ScrapeMode.Fetch,
      ...options,
    } satisfies ScraperOptions);
    await pipelineManager.waitForJobCompletion(jobId);
    return await pipelineManager.getJob(jobId);
  }

  async function storedUrls(): Promise<string[]> {
    const versionId = await docService.ensureVersion({
      library: TEST_LIBRARY,
      version: TEST_VERSION,
    });
    const pages = await docService.getPagesByVersionId(versionId);
    return pages.map((p) => p.url).sort();
  }

  it("records pages under canonical URLs when llms.txt lists .md entries", async () => {
    // The react.dev shape: every llms.txt entry names a .md URL.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(
        200,
        `# Docs\n\n- [Guide](${TEST_BASE_URL}/guide.md)\n- [API](${TEST_BASE_URL}/api.md)\n`,
        { "Content-Type": "text/plain" },
      )
      .get("/")
      .reply(200, "<html><body><h1>Home</h1><p>Welcome to the docs.</p></body></html>", {
        "Content-Type": "text/html",
      })
      .get("/guide.md")
      .reply(200, "# Guide\n\nHow to use the thing.", { "Content-Type": "text/markdown" })
      .get("/api.md")
      .reply(200, "# API\n\nReference material.", { "Content-Type": "text/markdown" });

    expect((await runScrape())?.status).toBe(PipelineJobStatus.COMPLETED);

    const urls = await storedUrls();
    expect(urls).toContain(`${TEST_BASE_URL}/guide`);
    expect(urls).toContain(`${TEST_BASE_URL}/api`);
    expect(urls.filter((u) => u.endsWith(".md"))).toEqual([]);
  }, 30000);

  it("indexes one page when both representations are reachable", async () => {
    // The vite.dev shape: llms.txt names .md URLs and the HTML pages are also
    // crawlable, so each document is reachable by two routes.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(200, `# Docs\n\n- [Guide](${TEST_BASE_URL}/guide.md)\n`, {
        "Content-Type": "text/plain",
      })
      .get("/")
      .reply(
        200,
        `<html><body><h1>Home</h1><a href="${TEST_BASE_URL}/guide">Guide</a></body></html>`,
        { "Content-Type": "text/html" },
      )
      .get("/guide.md")
      .reply(200, "# Guide\n\nMarkdown body.", { "Content-Type": "text/markdown" })
      .get("/guide")
      .reply(
        200,
        "<html><body><h1>Guide</h1><p>HTML body.</p></body></html>",
        { "Content-Type": "text/html" },
      );

    expect((await runScrape())?.status).toBe(PipelineJobStatus.COMPLETED);

    const urls = await storedUrls();
    // One identity, reached twice.
    expect(urls.filter((u) => u === `${TEST_BASE_URL}/guide`)).toHaveLength(1);
    expect(urls.filter((u) => u.endsWith(".md"))).toEqual([]);

    // And the Markdown representation is the one kept, whichever arrived last.
    const results = await docService.searchStore(
      TEST_LIBRARY,
      TEST_VERSION,
      "body",
      10,
    );
    const guide = results.filter((r) => r.url === `${TEST_BASE_URL}/guide`);
    expect(guide.length).toBeGreaterThan(0);
    expect(guide.some((r) => r.content?.includes("Markdown body"))).toBe(true);
    expect(guide.some((r) => r.content?.includes("HTML body"))).toBe(false);
  }, 30000);

  it("keeps a .md URL that serves HTML under its own identity", async () => {
    // A server ignoring the extension must not have its response folded onto a
    // canonical URL it does not serve.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(404)
      .get("/")
      .reply(
        200,
        `<html><body><h1>Home</h1><a href="${TEST_BASE_URL}/stale.md">Stale</a></body></html>`,
        { "Content-Type": "text/html" },
      )
      .get("/stale.md")
      .reply(200, "<html><body><h1>Soft 404</h1><p>No such document.</p></body></html>", {
        "Content-Type": "text/html",
      });

    expect((await runScrape())?.status).toBe(PipelineJobStatus.COMPLETED);

    const urls = await storedUrls();
    expect(urls).toContain(`${TEST_BASE_URL}/stale.md`);
    expect(urls).not.toContain(`${TEST_BASE_URL}/stale`);
  }, 30000);

  it("refreshes the representation the content came from, not the identity", async () => {
    // The identity is an assertion about where the page lives; the retrieval
    // location is a fact about where its bytes came from. Refreshing the former
    // fetches a different representation and leaves the stored one stale.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(200, `# Docs\n\n- [Guide](${TEST_BASE_URL}/guide.md)\n`, {
        "Content-Type": "text/plain",
      })
      .get("/")
      .reply(200, "<html><body><h1>Home</h1><p>hi</p></body></html>", {
        "Content-Type": "text/html",
      })
      .get("/guide.md")
      .reply(200, "# Guide\n\nOriginal markdown body.", {
        "Content-Type": "text/markdown",
        ETag: '"md-v1"',
      });

    expect((await runScrape())?.status).toBe(PipelineJobStatus.COMPLETED);
    expect(await storedUrls()).toContain(`${TEST_BASE_URL}/guide`);

    // Only the markdown representation is mocked for the refresh. A refresh that
    // asked for the identity would find nothing and fail the assertions below.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(404)
      .get("/")
      .reply(200, "<html><body><h1>Home</h1><p>hi</p></body></html>", {
        "Content-Type": "text/html",
      })
      .get("/guide.md")
      .matchHeader("if-none-match", '"md-v1"')
      .reply(200, "# Guide\n\nUpdated markdown body.", {
        "Content-Type": "text/markdown",
        ETag: '"md-v2"',
      });

    const refreshId = await pipelineManager.enqueueRefreshJob(TEST_LIBRARY, TEST_VERSION);
    await pipelineManager.waitForJobCompletion(refreshId);

    // The page updated rather than freezing at what it was first indexed with.
    const results = await docService.searchStore(TEST_LIBRARY, TEST_VERSION, "body", 10);
    const guide = results.filter((r) => r.url === `${TEST_BASE_URL}/guide`);
    expect(guide.some((r) => r.content?.includes("Updated markdown body"))).toBe(true);
    expect(guide.some((r) => r.content?.includes("Original markdown body"))).toBe(false);
  }, 30000);

  it("sends a stored validator back to the resource that issued it", async () => {
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(200, `# Docs\n\n- [Guide](${TEST_BASE_URL}/guide.md)\n`, {
        "Content-Type": "text/plain",
      })
      .get("/")
      .reply(200, "<html><body><h1>Home</h1><p>hi</p></body></html>", {
        "Content-Type": "text/html",
      })
      .get("/guide.md")
      .reply(200, "# Guide\n\nBody.", {
        "Content-Type": "text/markdown",
        ETag: '"md-v1"',
      });

    expect((await runScrape())?.status).toBe(PipelineJobStatus.COMPLETED);

    // The interceptor only matches when the markdown resource's own validator
    // arrives on a request for that resource.
    const conditional = nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(404)
      .get("/")
      .reply(200, "<html><body><h1>Home</h1><p>hi</p></body></html>", {
        "Content-Type": "text/html",
      })
      .get("/guide.md")
      .matchHeader("if-none-match", '"md-v1"')
      .reply(304, undefined, { ETag: '"md-v1"' });

    const refreshId = await pipelineManager.enqueueRefreshJob(TEST_LIBRARY, TEST_VERSION);
    await pipelineManager.waitForJobCompletion(refreshId);

    expect(conditional.isDone()).toBe(true);
  }, 30000);

  it("refreshes a page with no separate retrieval location unchanged", async () => {
    // The common case must keep working: no llms.txt, no markdown variant.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(404)
      .get("/")
      .reply(200, "<html><body><h1>Home</h1><p>Original text.</p></body></html>", {
        "Content-Type": "text/html",
        ETag: '"html-v1"',
      });

    expect((await runScrape())?.status).toBe(PipelineJobStatus.COMPLETED);

    const refreshed = nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(404)
      .get("/")
      .matchHeader("if-none-match", '"html-v1"')
      .reply(200, "<html><body><h1>Home</h1><p>Updated text.</p></body></html>", {
        "Content-Type": "text/html",
        ETag: '"html-v2"',
      });

    const refreshId = await pipelineManager.enqueueRefreshJob(TEST_LIBRARY, TEST_VERSION);
    await pipelineManager.waitForJobCompletion(refreshId);

    expect(refreshed.isDone()).toBe(true);
    const results = await docService.searchStore(TEST_LIBRARY, TEST_VERSION, "text", 10);
    expect(results.some((r) => r.content?.includes("Updated text"))).toBe(true);
  }, 30000);

  it("collapses spellings that differ only by a trailing slash or fragment", async () => {
    // The residual duplicate classes after `.md` identity alone: an llms.txt
    // entry reaching `/config.md` while a crawl reaches `/config/` and an
    // in-page anchor reaches `/config/#opts`. All three name one page.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(200, `# Docs\n\n- [Config](${TEST_BASE_URL}/config.md)\n`, {
        "Content-Type": "text/plain",
      })
      .get("/")
      .reply(
        200,
        `<html><body><h1>Home</h1>` +
          `<a href="${TEST_BASE_URL}/config/">Config</a>` +
          `<a href="${TEST_BASE_URL}/config/#opts">Options</a>` +
          `</body></html>`,
        { "Content-Type": "text/html" },
      )
      .get("/config.md")
      .reply(200, "# Config\n\nConfiguration reference.", {
        "Content-Type": "text/markdown",
      })
      .get("/config/")
      .reply(200, "<html><body><h1>Config</h1><p>HTML copy.</p></body></html>", {
        "Content-Type": "text/html",
      });

    expect((await runScrape())?.status).toBe(PipelineJobStatus.COMPLETED);

    const urls = await storedUrls();
    const config = urls.filter((u) => u.includes("config"));
    expect(config).toEqual([`${TEST_BASE_URL}/config`]);
  }, 30000);

  it("leaves hash-routed URLs alone", async () => {
    // With preserveHashes the fragment names the route, so `/docs/#/a` and
    // `/docs/#/b` are different pages and neither slash nor fragment may be
    // trimmed.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(404)
      .get("/")
      .reply(
        200,
        `<html><body><h1>App</h1>` +
          `<a href="${TEST_BASE_URL}/#/alpha">Alpha</a>` +
          `<a href="${TEST_BASE_URL}/#/beta">Beta</a>` +
          `</body></html>`,
        { "Content-Type": "text/html" },
      )
      .get("/")
      .times(2)
      .reply(
        200,
        "<html><body><h1>Route</h1><p>Route content here.</p></body></html>",
        { "Content-Type": "text/html" },
      );

    expect((await runScrape({ preserveHashes: true }))?.status).toBe(
      PipelineJobStatus.COMPLETED,
    );

    const urls = await storedUrls();
    expect(urls).toContain(`${TEST_BASE_URL}/#/alpha`);
    expect(urls).toContain(`${TEST_BASE_URL}/#/beta`);
  }, 30000);

  it("still collapses a trailing slash on a hash-routed crawl", async () => {
    // Preserving fragments must not switch off path normalization for every
    // other URL in the crawl: that left `/docs` and `/docs/` as two pages on
    // exactly the sites the option exists for.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(404)
      .get("/")
      .reply(
        200,
        `<html><body><a href="${TEST_BASE_URL}/docs">A</a><a href="${TEST_BASE_URL}/docs/">B</a></body></html>`,
        { "Content-Type": "text/html" },
      )
      .get("/docs")
      .reply(200, "<html><body><h1>Docs</h1><p>Docs body.</p></body></html>", {
        "Content-Type": "text/html",
      });

    expect((await runScrape({ preserveHashes: true }))?.status).toBe(
      PipelineJobStatus.COMPLETED,
    );

    const urls = await storedUrls();
    expect(urls.filter((u) => u.startsWith(`${TEST_BASE_URL}/docs`))).toEqual([
      `${TEST_BASE_URL}/docs`,
    ]);
  }, 30000);

  it("parses a markdown alternate served as plain text as markdown", async () => {
    // react.dev serves its .md alternates as text/plain while vite.dev sends
    // text/markdown. The extension is the author's statement about the format,
    // so the body is parsed as Markdown either way — the plain-text pipeline
    // would throw away every heading — and it folds onto the page it represents.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(200, `# Docs\n\n- [Guide](${TEST_BASE_URL}/guide.md)\n`, {
        "Content-Type": "text/plain",
      })
      .get("/")
      .reply(200, "<html><body><h1>Home</h1><p>hi</p></body></html>", {
        "Content-Type": "text/html",
      })
      .get("/guide.md")
      .reply(200, "# Guide\n\nMarkdown body.", { "Content-Type": "text/plain" });

    expect((await runScrape())?.status).toBe(PipelineJobStatus.COMPLETED);

    const urls = await storedUrls();
    expect(urls).toContain(`${TEST_BASE_URL}/guide`);
    expect(urls).not.toContain(`${TEST_BASE_URL}/guide.md`);

    const results = await docService.searchStore(TEST_LIBRARY, TEST_VERSION, "body", 10);
    const guide = results.filter((r) => r.url === `${TEST_BASE_URL}/guide`);
    expect(guide.some((r) => r.content?.includes("Markdown body"))).toBe(true);
  }, 30000);

  it("prefers a markdown alternate served as plain text over its html twin", async () => {
    // react.dev serves its `.md` alternates as `text/plain`; vite.dev sends
    // `text/markdown`. Both are the published Markdown for the page, so both
    // outrank an HTML copy of it.
    //
    // Plain text was briefly ranked below HTML, to stop a plain-text soft error
    // page outranking the page it folds onto. That protected nothing: the hosts
    // that soft-404 a `.md` URL answer `200 text/markdown` with a
    // `# Page Not Found` body, which this rule does not see, while react.dev
    // returns a real 404. It only cost the published Markdown of every site
    // serving `text/plain`.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(200, `# Docs\n\n- [Guide](${TEST_BASE_URL}/guide.md)\n`, {
        "Content-Type": "text/plain",
      })
      .get("/")
      .reply(
        200,
        `<html><body><h1>Home</h1><a href="${TEST_BASE_URL}/guide">Guide</a></body></html>`,
        { "Content-Type": "text/html" },
      )
      .get("/guide.md")
      .reply(200, "# Guide\n\nMarkdown body.", { "Content-Type": "text/plain" })
      .get("/guide")
      .reply(200, "<html><body><h1>Guide</h1><p>HTML body.</p></body></html>", {
        "Content-Type": "text/html",
      });

    expect((await runScrape())?.status).toBe(PipelineJobStatus.COMPLETED);

    const urls = await storedUrls();
    expect(urls.filter((u) => u === `${TEST_BASE_URL}/guide`)).toHaveLength(1);

    const results = await docService.searchStore(TEST_LIBRARY, TEST_VERSION, "body", 10);
    const guide = results.filter((r) => r.url === `${TEST_BASE_URL}/guide`);
    expect(guide.some((r) => r.content?.includes("Markdown body"))).toBe(true);
    expect(guide.some((r) => r.content?.includes("HTML body"))).toBe(false);
  }, 30000);

  it("keeps the stored markdown when an html twin extracts nothing", async () => {
    // An empty representation competes on the same terms as a full one. Without
    // that, the HTML twin's empty record replaced the Markdown already stored
    // under the identity and the page was left with no chunks at all.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(200, `# Docs\n\n- [Guide](${TEST_BASE_URL}/guide.md)\n`, {
        "Content-Type": "text/plain",
      })
      .get("/")
      .reply(
        200,
        `<html><body><h1>Home</h1><a href="${TEST_BASE_URL}/guide">Guide</a></body></html>`,
        { "Content-Type": "text/html" },
      )
      .get("/guide.md")
      .reply(200, "# Guide\n\nMarkdown guide body.", { "Content-Type": "text/markdown" })
      .get("/guide")
      .reply(200, "<html><body></body></html>", { "Content-Type": "text/html" });

    expect((await runScrape())?.status).toBe(PipelineJobStatus.COMPLETED);

    const results = await docService.searchStore(TEST_LIBRARY, TEST_VERSION, "guide", 10);
    const guide = results.filter((r) => r.url === `${TEST_BASE_URL}/guide`);
    expect(guide.some((r) => r.content?.includes("Markdown guide body"))).toBe(true);
  }, 30000);

  it("records the retrieval location for a page that turns out to be empty", async () => {
    // An empty page still has a retrieval location. Dropping it stored NULL, so
    // the next refresh asked the identity instead of the markdown file it was
    // read from — and sent that file's validator to a resource that never
    // issued it.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(200, `# Docs\n\n- [Guide](${TEST_BASE_URL}/guide.md)\n`, {
        "Content-Type": "text/plain",
      })
      .get("/")
      .reply(200, "<html><body><h1>Home</h1><p>Home body.</p></body></html>", {
        "Content-Type": "text/html",
      })
      .get("/guide.md")
      .reply(200, "   \n\n   \n", {
        "Content-Type": "text/markdown",
        ETag: '"md-empty-v1"',
      });

    expect((await runScrape())?.status).toBe(PipelineJobStatus.COMPLETED);

    const versionId = await docService.ensureVersion({
      library: TEST_LIBRARY,
      version: TEST_VERSION,
    });
    const guide = (await docService.getPagesByVersionId(versionId)).find(
      (p) => p.url === `${TEST_BASE_URL}/guide`,
    );
    expect(guide).toBeDefined();
    expect(guide?.content_url).toBe(`${TEST_BASE_URL}/guide.md`);

    // The consequence that matters: the refresh goes back to the markdown file
    // with the validator that file issued, and finds content there.
    nock.cleanAll();
    const conditional = nock(TEST_BASE_URL)
      .persist()
      .get("/llms.txt")
      .reply(404)
      .get("/")
      .reply(200, "<html><body><h1>Home</h1><p>Home body.</p></body></html>", {
        "Content-Type": "text/html",
      })
      .get("/guide.md")
      .matchHeader("if-none-match", '"md-empty-v1"')
      .reply(200, "# Guide\n\nThe page has content again.", {
        "Content-Type": "text/markdown",
        ETag: '"md-v2"',
      });

    const refreshId = await pipelineManager.enqueueRefreshJob(TEST_LIBRARY, TEST_VERSION);
    await pipelineManager.waitForJobCompletion(refreshId);

    expect(conditional.isDone()).toBe(true);
    const results = await docService.searchStore(TEST_LIBRARY, TEST_VERSION, "content", 10);
    expect(results.some((r) => r.content?.includes("content again"))).toBe(true);
  }, 30000);

  it("does not delete a live page because its markdown alternate is gone", async () => {
    // A refresh asks the location the content came from, which for a published
    // Markdown file is not the page's own URL. A 404 there says the file was
    // withdrawn, not that the page was: sites drop their `.md` alternates and
    // keep serving the pages. Deleting on that answer removed live pages from
    // the index without ever requesting them, and — because refresh 404s are
    // deliberately excluded from the failure threshold — reported success.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(200, `# Docs\n\n- [Guide](${TEST_BASE_URL}/guide.md)\n`, {
        "Content-Type": "text/plain",
      })
      .get("/")
      .reply(200, "<html><body><h1>Home</h1><p>Home body.</p></body></html>", {
        "Content-Type": "text/html",
        ETag: '"home-v1"',
      })
      .get("/guide.md")
      .reply(200, "# Guide\n\nGuide body about widgets.", {
        "Content-Type": "text/markdown",
        ETag: '"md-v1"',
      });

    expect((await runScrape({ maxDepth: 2 }))?.status).toBe(PipelineJobStatus.COMPLETED);
    expect(await storedUrls()).toContain(`${TEST_BASE_URL}/guide`);

    // The site withdraws its alternates; the HTML page is still served.
    nock.cleanAll();
    nock(TEST_BASE_URL)
      .persist()
      .get("/llms.txt")
      .reply(404)
      .get("/")
      .reply(304, undefined, { ETag: '"home-v1"' })
      .get("/guide.md")
      .reply(404)
      .get("/guide")
      .reply(
        200,
        "<html><body><h1>Guide</h1><p>Guide body about widgets.</p></body></html>",
        { "Content-Type": "text/html" },
      );

    const refreshId = await pipelineManager.enqueueRefreshJob(TEST_LIBRARY, TEST_VERSION);
    await pipelineManager.waitForJobCompletion(refreshId);

    expect(await storedUrls()).toContain(`${TEST_BASE_URL}/guide`);
    const results = await docService.searchStore(TEST_LIBRARY, TEST_VERSION, "widgets", 10);
    expect(results.some((r) => r.content?.includes("widgets"))).toBe(true);
  }, 30000);

  it("deletes the page when neither the alternate nor the page itself is served", async () => {
    // The fallback asks the identity; if that is gone too, the page really is.
    nock(TEST_BASE_URL)
      .get("/llms.txt")
      .reply(200, `# Docs\n\n- [Guide](${TEST_BASE_URL}/guide.md)\n`, {
        "Content-Type": "text/plain",
      })
      .get("/")
      .reply(200, "<html><body><h1>Home</h1><p>Home body.</p></body></html>", {
        "Content-Type": "text/html",
        ETag: '"home-v1"',
      })
      .get("/guide.md")
      .reply(200, "# Guide\n\nGuide body about widgets.", {
        "Content-Type": "text/markdown",
      });

    expect((await runScrape({ maxDepth: 2 }))?.status).toBe(PipelineJobStatus.COMPLETED);

    nock.cleanAll();
    nock(TEST_BASE_URL)
      .persist()
      .get("/llms.txt")
      .reply(404)
      .get("/")
      .reply(304, undefined, { ETag: '"home-v1"' })
      .get("/guide.md")
      .reply(404)
      .get("/guide")
      .reply(404);

    const refreshId = await pipelineManager.enqueueRefreshJob(TEST_LIBRARY, TEST_VERSION);
    await pipelineManager.waitForJobCompletion(refreshId);

    expect(await storedUrls()).not.toContain(`${TEST_BASE_URL}/guide`);
  }, 30000);

  it("keeps the markdown when refreshing an index that predates one identity", async () => {
    // An index built before `.md` URLs folded onto their canonical page holds
    // both representations as separate rows. The first refresh re-fetches both,
    // and they now resolve to one identity. Retiring the old row before the two
    // could be compared let the HTML overwrite the Markdown — silently, on
    // upgrade, for exactly the indexes this change exists to repair.
    nock(TEST_BASE_URL)
      .persist()
      .get("/llms.txt")
      .reply(404)
      .get("/")
      .reply(200, "<html><body><h1>Home</h1><p>Home body.</p></body></html>", {
        "Content-Type": "text/html",
      });
    expect((await runScrape({ maxDepth: 0 }))?.status).toBe(PipelineJobStatus.COMPLETED);

    // The pre-upgrade shape, in the order an llms.txt-driven crawl produced it:
    // the .md entries first, the crawled HTML pages after.
    for (const [url, mime, body] of [
      [`${TEST_BASE_URL}/guide.md`, "text/markdown", "Legacy markdown guide body."],
      [`${TEST_BASE_URL}/guide`, "text/html", "Legacy HTML guide body."],
    ] as const) {
      await docService.addScrapeResult(TEST_LIBRARY, TEST_VERSION, 1, {
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

    nock.cleanAll();
    nock(TEST_BASE_URL)
      .persist()
      .get("/llms.txt")
      .reply(404)
      .get("/")
      .reply(200, "<html><body><h1>Home</h1><p>Home body.</p></body></html>", {
        "Content-Type": "text/html",
      })
      .get("/guide")
      .reply(200, "<html><body><h1>Guide</h1><p>Fresh HTML guide body.</p></body></html>", {
        "Content-Type": "text/html",
      })
      .get("/guide.md")
      .reply(200, "# Guide\n\nFresh markdown guide body.", {
        "Content-Type": "text/markdown",
      });

    const refreshId = await pipelineManager.enqueueRefreshJob(TEST_LIBRARY, TEST_VERSION);
    await pipelineManager.waitForJobCompletion(refreshId);

    // One identity, and the published Markdown is what it holds.
    expect(await storedUrls()).not.toContain(`${TEST_BASE_URL}/guide.md`);
    const results = await docService.searchStore(TEST_LIBRARY, TEST_VERSION, "guide", 10);
    expect(results.some((r) => r.content?.includes("Fresh markdown guide body"))).toBe(
      true,
    );
    expect(results.some((r) => r.content?.includes("Fresh HTML guide body"))).toBe(false);
  }, 30000);
});
