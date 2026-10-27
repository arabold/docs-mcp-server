import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type MockSite, mockSite } from "../../../test/mock-site";
import { type AppConfig, loadConfig } from "../../utils/config";
import { logger } from "../../utils/logger";
import { PipelineFactory } from "../pipelines/PipelineFactory";
import type { ContentPipeline } from "../pipelines/types";
import {
  PageOutcome,
  ScrapeMode,
  type ScraperOptions,
  type ScraperProgressEvent,
} from "../types";
import { WebScraperStrategy, type WebScraperStrategyOptions } from "./WebScraperStrategy";

// Building realistic request headers loads a large browser-fingerprint model on
// every fetcher construction, which only costs time here.
vi.mock("../fetcher/FingerprintGenerator", () => ({
  FingerprintGenerator: class {
    generateHeaders(): Record<string, string> {
      return {};
    }
  },
}));

const baseConfig = loadConfig();
const config: AppConfig = {
  ...baseConfig,
  scraper: {
    ...baseConfig.scraper,
    // One item at a time, so a site receives its requests in queue order.
    maxConcurrency: 1,
    fetcher: { ...baseConfig.scraper.fetcher, maxRetries: 0 },
    security: {
      ...baseConfig.scraper.security,
      // The mock hosts pass the access policy without a DNS lookup.
      network: { ...baseConfig.scraper.security.network, allowPrivateNetworks: true },
    },
  },
};

const ROOT = "https://example.com/";

/** An HTML page headed `title` that links each of `hrefs`. */
const html = (title: string, hrefs: string[] = []): string =>
  `<html><head><title>${title}</title></head><body><h1>${title}</h1>${hrefs
    .map((href) => `<a href="${href}">${href}</a>`)
    .join("")}</body></html>`;
const MARKDOWN = { type: "text/markdown" };
const PLAIN_TEXT = { type: "text/plain" };
/** An llms.txt index listing `links`. */
const llmsTxt = (...links: string[]): string =>
  `# Docs\n\n${links.map((link) => `- [${link}](${link})`).join("\n")}`;

const opts = (overrides: Partial<ScraperOptions> = {}): ScraperOptions => ({
  url: ROOT,
  library: "test",
  version: "1.0",
  maxPages: 50,
  maxDepth: 1,
  scrapeMode: ScrapeMode.Fetch,
  ...overrides,
});

/** Crawls, with a fresh strategy unless one is given, and returns every progress event. */
async function crawl(
  overrides: Partial<ScraperOptions> = {},
  strategy = new WebScraperStrategy(config),
): Promise<ScraperProgressEvent[]> {
  const events: ScraperProgressEvent[] = [];
  await strategy.scrape(opts(overrides), async (event) => {
    events.push(event);
  });
  return events;
}

/** A strategy that follows only the links `shouldFollowLink` accepts. */
const following = (shouldFollowLink: WebScraperStrategyOptions["shouldFollowLink"]) =>
  new WebScraperStrategy(config, { shouldFollowLink });

const storedUrls = (events: ScraperProgressEvent[]): string[] =>
  events.flatMap((event) => (event.result ? [event.result.url] : []));
const eventFor = (events: ScraperProgressEvent[], url: string) =>
  events.find((event) => event.currentUrl === url);
/** The pages processed after the start URL, in order. */
const followed = (events: ScraperProgressEvent[]): string[] =>
  events.slice(1).map((event) => event.currentUrl);

const isProbe = (requestPath: string) => requestPath.endsWith("/llms.txt");

describe("WebScraperStrategy", () => {
  const site = mockSite("https://example.com");
  const httpSite = mockSite("http://example.com");
  const www = mockSite("https://www.example.com");
  const otherPort = mockSite("https://example.com:8443");
  const docsHost = mockSite("https://docs.example.com");
  const apiHost = mockSite("https://api.example.com");
  const sites = [site, httpSite, www, otherPort, docsHost, apiHost];

  /** Paths `on` was asked for, llms.txt probes excluded, in arrival order. */
  const pages = (on: MockSite = site): string[] =>
    on.requests.map((request) => request.path).filter((p) => !isProbe(p));
  /** The llms.txt paths `on` was asked for, in arrival order. */
  const probes = (on: MockSite = site): string[] =>
    on.requests.map((request) => request.path).filter(isProbe);

  /** The site serving `url`. */
  const siteFor = (url: string): MockSite => {
    const { origin } = new URL(url);
    const owner = sites.find((candidate) => candidate.origin === origin);
    if (!owner) throw new Error(`No mock site serves ${url}`);
    return owner;
  };
  /** The path and query of `url`, as a site's routes and requests name it. */
  const pathOf = (url: string): string => {
    const { pathname, search } = new URL(url);
    return `${pathname}${search}`;
  };
  /** Serves an HTML page at an absolute URL. */
  const serveAt = (url: string, body: string) => siteFor(url).page(pathOf(url), body);

  /**
   * Ends one case of a table test: fails the case if it asked for a path no
   * route serves, then empties every site for the next case.
   */
  const endCase = (label: string) => {
    for (const each of sites) {
      expect
        .soft(
          each.unmatched.map((r) => r.path),
          `${label}: unmatched`,
        )
        .toEqual([]);
      each.reset();
    }
  };

  it("sends the custom headers with every request and leaves redirects unfollowed when told to", async () => {
    // `/target` has no route, so following the redirect would fail the test.
    site
      .page("/", html("Root", ["/child", "/moved"]))
      .page("/child", html("Child"))
      .redirect("/moved", "/target");
    const headers = { Authorization: "Bearer test-token", "X-Test-Header": "test-value" };

    const events = await crawl({ followRedirects: false, headers, ignoreErrors: true });

    expect(pages()).toEqual(["/", "/child", "/moved"]);
    expect(eventFor(events, `${ROOT}moved`)?.outcome).toBe(PageOutcome.Failed);
    for (const request of site.requests) {
      expect
        .soft(request.headers.get("authorization"), request.path)
        .toBe("Bearer test-token");
      expect.soft(request.headers.get("x-test-header"), request.path).toBe("test-value");
    }
  });

  describe("content processing", () => {
    it("processes HTML, Markdown and plain text through their pipelines", async () => {
      const cases = [
        {
          label: "HTML",
          body: html("HTML Test"),
          type: "text/html",
          expected: {
            title: "HTML Test",
            textContent: expect.stringContaining("# HTML Test"),
            sourceContentType: "text/html",
          },
        },
        {
          label: "Markdown",
          body: "# Markdown Title\n\nThis is already markdown content.",
          type: "text/markdown",
          expected: {
            textContent: expect.stringContaining("This is already markdown content."),
            sourceContentType: "text/markdown",
            contentType: "text/markdown",
          },
        },
        {
          label: "plain text",
          body: "This stays plain text.",
          type: "text/plain",
          expected: {
            textContent: expect.stringContaining("This stays plain text."),
            sourceContentType: "text/plain",
            contentType: "text/markdown",
          },
        },
      ];

      for (const { label, body, type, expected } of cases) {
        site.page("/", body, { type });

        const events = await crawl({ maxDepth: 0 });

        expect
          .soft(events.find((event) => event.result)?.result, label)
          .toMatchObject(expected);
        endCase(label);
      }
    });

    it("processes content-negotiated plain text as Markdown", async () => {
      const body = `---\ntitle: React Community\n---\n\n<Intro>\n\n# Community {/*community*/}\n\nReact has a community.`;
      site.page("/community", body, PLAIN_TEXT);

      const events = await crawl({ url: `${ROOT}community`, maxDepth: 0 });
      const result = eventFor(events, `${ROOT}community`)?.result;

      expect(result).toMatchObject({
        title: "React Community",
        sourceContentType: "text/plain",
        contentType: "text/markdown",
      });
      expect(result?.chunks.some((chunk) => chunk.content.includes("<Intro>"))).toBe(
        false,
      );
      expect(
        result?.chunks.some((chunk) => chunk.content.includes("{/*community*/}")),
      ).toBe(false);
      expect(
        result?.chunks.some((chunk) => chunk.content.includes("React has a community.")),
      ).toBe(true);
    });

    it("skips a child no pipeline can read without failing the crawl", async () => {
      // Served as text, so the type gates let it through, but the body is
      // binary, so the text pipeline refuses it once it is read.
      site
        .page("/", html("Root", ["/data", "/page"]))
        .page("/data", new Uint8Array([0x41, 0x00, 0x42, 0x43]), PLAIN_TEXT)
        .page("/page", html("Page"));

      const events = await crawl();

      expect(pages()).toEqual(["/", "/data", "/page"]);
      // Skipped rather than empty: nothing read the body, so a refresh must not
      // treat it as a page that lost its content.
      expect(eventFor(events, `${ROOT}data`)).toMatchObject({
        outcome: PageOutcome.Skipped,
        result: null,
      });
      expect(eventFor(events, `${ROOT}data`)?.emptyPage).toBeUndefined();
      expect(storedUrls(events)).toEqual([ROOT, `${ROOT}page`]);
    });

    it("follows links found in Markdown content", async () => {
      site
        .page("/docs/", "# Start\n\nContinue to the [guide](guide).", MARKDOWN)
        .page("/docs/guide", "# Guide\n\nMarkdown linked page.", MARKDOWN);

      const events = await crawl({ url: `${ROOT}docs/` });

      expect(storedUrls(events)).toEqual([`${ROOT}docs`, `${ROOT}docs/guide`]);
    });
  });

  describe("page identity", () => {
    it("records Markdown reached through a redirect under the requested URL", async () => {
      // Judged on where the bytes came from: an extensionless URL that redirects
      // to a .md file is a published Markdown representation of that page.
      site
        .redirect("/guide", "/guide.md")
        .page("/guide.md", "# Guide\n\nBody.", PLAIN_TEXT);

      const events = await crawl({ url: `${ROOT}guide`, maxDepth: 0 });

      expect(events[0]?.result).toMatchObject({
        url: `${ROOT}guide`,
        contentUrl: `${ROOT}guide.md`,
        contentType: "text/markdown",
      });
    });

    it("records each page under its page identity", async () => {
      const cases = [
        {
          label: "a Markdown file",
          url: `${ROOT}guide/ssr.md`,
          body: "# Server-Side Rendering\n\nSome guidance about SSR.",
          type: "text/markdown",
          recorded: `${ROOT}guide/ssr`,
        },
        {
          // react.dev serves its .md alternates as text/plain.
          label: "a Markdown file served as plain text",
          url: `${ROOT}learn.md`,
          body: "# Quick Start\n\nWelcome.",
          type: "text/plain",
          recorded: `${ROOT}learn`,
        },
        {
          // A soft 404 answering HTML must not fold onto a page it does not serve.
          label: "a .md URL that answers HTML",
          url: `${ROOT}docs/flex.md`,
          body: html("Not found"),
          type: "text/html",
          recorded: `${ROOT}docs/flex.md`,
        },
        {
          label: "Markdown at an extensionless URL",
          url: `${ROOT}guide`,
          body: "# Guide\n\nBody text.",
          type: "text/markdown",
          recorded: `${ROOT}guide`,
        },
        {
          label: "a non-Markdown extension",
          url: `${ROOT}notes.txt`,
          body: "plain notes",
          type: "text/plain",
          recorded: `${ROOT}notes.txt`,
        },
        {
          label: "a directory URL",
          url: `${ROOT}docs/`,
          body: html("Docs"),
          type: "text/html",
          recorded: `${ROOT}docs`,
        },
        {
          label: "a bare origin",
          url: "https://example.com",
          body: html("Home"),
          type: "text/html",
          recorded: ROOT,
        },
      ];

      for (const { label, url, body, type, recorded } of cases) {
        site.page(pathOf(url), body, { type });

        const events = await crawl({ url, maxDepth: 0 });

        expect.soft(storedUrls(events), label).toEqual([recorded]);
        endCase(label);
      }
    });

    it("keeps the requested hash route when the server answers from another path spelling", async () => {
      const start = `${ROOT}docs#/guide`;
      const cases = [
        {
          label: "/docs",
          serve: () => site.page("/docs", html("Guide")),
          recorded: `${ROOT}docs#/guide`,
        },
        {
          label: "/docs/",
          serve: () => site.redirect("/docs", "/docs/").page("/docs/", html("Guide")),
          recorded: `${ROOT}docs/#/guide`,
        },
      ];

      for (const { label, serve, recorded } of cases) {
        serve();

        const events = await crawl({ url: start, preserveHashes: true, maxDepth: 0 });

        expect
          .soft(
            events.find((event) => event.result),
            label,
          )
          .toMatchObject({
            currentUrl: recorded,
            result: { url: recorded },
          });
        endCase(label);
      }
    });
  });

  describe("scope", () => {
    // Links outside the scope get no route: asking for one fails the case.
    it("follows only links within the configured scope", async () => {
      // The scope matrix itself is covered in utils/scope.test.ts; this checks
      // that the crawl applies the configured mode to discovered links.
      const cases = [
        {
          label: "the default subpages",
          scope: undefined,
          start: `${ROOT}api/`,
          follows: [`${ROOT}api/intro`],
          skips: [
            `${ROOT}blog/post`,
            "https://api.example.com/v1",
            "https://other.com/page",
          ],
        },
        {
          label: "hostname",
          scope: "hostname",
          start: `${ROOT}api`,
          follows: [`${ROOT}blog/post`],
          skips: ["https://api.example.com/v1"],
        },
        {
          label: "domain",
          scope: "domain",
          start: "https://docs.example.com/",
          follows: ["https://api.example.com/v1"],
          skips: ["https://example.org/page"],
        },
      ] as const;

      for (const { label, scope, start, follows, skips } of cases) {
        for (const url of follows) serveAt(url, html(url));
        serveAt(start, html("Start", [...follows, ...skips]));

        const events = await crawl({ url: start, scope });

        expect.soft(followed(events), label).toEqual(follows);
        endCase(label);
      }
    });

    it("anchors scope at the requested path after a redirect", async () => {
      const cases: Array<{
        label: string;
        start: string;
        final: string;
        follows: string[];
        skips: string[];
        preserveHashes?: boolean;
      }> = [
        {
          label: "to a hash-suffixed path",
          start: `${ROOT}foo`,
          final: `${ROOT}foo~abc`,
          follows: [`${ROOT}foo/child`],
          skips: [],
        },
        {
          label: "to a deeper page",
          start: `${ROOT}api`,
          final: `${ROOT}api/v2/intro`,
          follows: [`${ROOT}api/v1/intro`, `${ROOT}api/v2/intro/child`],
          skips: [],
        },
        {
          label: "to a sibling path",
          start: `${ROOT}v1/api`,
          final: `${ROOT}v2/api`,
          follows: [`${ROOT}v1/api/child`],
          skips: [`${ROOT}v2/api/child`],
        },
        {
          label: "to the homepage",
          start: `${ROOT}removed`,
          final: ROOT,
          follows: [],
          skips: [`${ROOT}home/intro`],
        },
        {
          label: "to https",
          start: "http://example.com/api",
          final: `${ROOT}api`,
          follows: [`${ROOT}api/child`],
          skips: [],
        },
        {
          label: "to the www host",
          start: `${ROOT}api`,
          final: "https://www.example.com/api",
          follows: ["https://www.example.com/api/child"],
          skips: [],
        },
        {
          label: "to another port",
          start: `${ROOT}api`,
          final: "https://example.com:8443/api",
          follows: ["https://example.com:8443/api/child"],
          skips: [],
        },
        {
          label: "to a deeper path, keeping the hash route",
          start: `${ROOT}docs#/guide`,
          final: `${ROOT}docs/`,
          follows: [`${ROOT}docs/#/api`],
          skips: [],
          preserveHashes: true,
        },
        {
          // `/bar` is served, so following the link would show in the events.
          label: "to a sibling path, dropping the hash route",
          start: `${ROOT}foo#/guide`,
          final: `${ROOT}bar`,
          follows: [],
          skips: [`${ROOT}bar#/api`],
          preserveHashes: true,
        },
      ];

      for (const { label, start, final, follows, skips, preserveHashes } of cases) {
        for (const url of follows) serveAt(url, html(url));
        siteFor(start).redirect(pathOf(start), final);
        serveAt(final, html("Start", [...follows, ...skips]));

        const events = await crawl({ url: start, preserveHashes });

        expect.soft(followed(events), label).toEqual(follows);
        endCase(label);
      }
    });

    it("warns once, naming the kept anchor, only when a redirect moves to a sibling path", async () => {
      const siblingwiseWarnings = (): string[] =>
        vi
          .mocked(logger.warn)
          .mock.calls.map(([message]) => String(message))
          .filter((message) => message.includes("siblingwise"));
      site
        .redirect("/v1/api", "/v2/api")
        .page("/v2/api", html("Start"))
        .redirect("/docs", "/docs/installation/using-vite")
        .page("/docs/installation/using-vite", html("Start"));

      vi.mocked(logger.warn).mockClear();
      await crawl({ url: `${ROOT}v1/api` });

      const warnings = siblingwiseWarnings();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(`Requested: ${ROOT}v1/api`);
      expect(warnings[0]).toContain("Scope anchor: /v1/api");

      // A redirect deeper below the requested path keeps the subtree in scope.
      vi.mocked(logger.warn).mockClear();
      await crawl({ url: `${ROOT}docs` });

      expect(siblingwiseWarnings()).toEqual([]);
    });

    it("resolves relative links against the URL the start page redirected to", async () => {
      // learn.microsoft.com answers its section URLs this way.
      const start = "/en-us/azure/bot-service";
      site
        .redirect(start, `${start}/?view=azure-bot-service-4.0`)
        .page(
          `${start}/?view=azure-bot-service-4.0`,
          html("Bot Service", ["bot-overview?view=azure-bot-service-4.0"]),
        )
        .page(`${start}/bot-overview?view=azure-bot-service-4.0`, html("Overview"));

      await crawl({ url: site.url(start) });

      expect(pages()).toEqual([
        start,
        `${start}/?view=azure-bot-service-4.0`,
        `${start}/bot-overview?view=azure-bot-service-4.0`,
      ]);
    });

    it("resolves relative links against <base href> before checking scope", async () => {
      // Against the page, `guide` would be an in-scope /app/guide; against the
      // cross-origin base it is out of scope.
      site.page(
        "/app/index.html",
        '<html><head><base href="https://cdn.example.com/lib/"></head><body><a href="guide">Guide</a></body></html>',
      );

      await crawl({ url: `${ROOT}app/index.html` });

      expect(pages()).toEqual(["/app/index.html"]);
    });

    it("follows only the links a custom shouldFollowLink accepts", async () => {
      site
        .page("/", html("Base", ["/allowed-page", "/blocked-page", "/also-allowed"]))
        .page("/allowed-page", html("Allowed"))
        .page("/also-allowed", html("Also allowed"));

      await crawl(
        {},
        following((_base, target) => target.pathname.includes("allowed")),
      );

      expect(pages()).toEqual(["/", "/allowed-page", "/also-allowed"]);
    });
  });

  describe("llms.txt discovery", () => {
    it("probes for llms.txt from the start URL up to the root, in order", async () => {
      const cases = [
        { start: "/docs/", expected: ["/docs/llms.txt", "/llms.txt"] },
        // A dotted version names a directory, not a file.
        {
          start: "/docs/v1.0",
          expected: ["/docs/v1.0/llms.txt", "/docs/llms.txt", "/llms.txt"],
        },
        // "index" and page files name a document, not a directory to descend into.
        { start: "/docs/index", expected: ["/docs/llms.txt", "/llms.txt"] },
        { start: "/docs/page.mdx", expected: ["/docs/llms.txt", "/llms.txt"] },
        { start: "/docs/page.html", expected: ["/docs/llms.txt", "/llms.txt"] },
      ];

      for (const { start, expected } of cases) {
        site.page(start, html("Start"));

        await crawl({ url: site.url(start), maxDepth: 0 });

        expect.soft(probes(), start).toEqual(expected);
        endCase(start);
      }
    });

    it("stops at the first llms.txt with links and seeds its in-scope entries", async () => {
      site
        .page("/docs/", html("Docs"))
        .page(
          "/docs/llms.txt",
          "# Docs\n\n- [Intro](intro)\n- [Other](https://example.com/other)",
          MARKDOWN,
        )
        .notFound("/docs/intro/index.html.md")
        .page("/docs/intro", html("Intro"));
      const headers = { Authorization: "Bearer token" };

      await crawl({ url: `${ROOT}docs/`, maxDepth: 0, headers });

      expect(probes()).toEqual(["/docs/llms.txt"]);
      expect(site.requestsTo("/docs/llms.txt")[0]?.headers.get("authorization")).toBe(
        "Bearer token",
      );
      // A seed is asked for its Markdown variant first, then for the page itself.
      expect(pages()).toEqual(["/docs/", "/docs/intro/index.html.md", "/docs/intro"]);
    });

    it("resolves llms.txt entries against the URL the index was served from", async () => {
      // The relative entry would be /docs/guide on example.com, which has no route.
      site
        .redirect("/docs/llms.txt", "https://www.example.com/docs/llms.txt")
        .redirect("/docs/start", "https://www.example.com/docs/start");
      www
        .page("/docs/llms.txt", "# Docs\n\n- [Guide](guide)", MARKDOWN)
        .page("/docs/start", html("Start"))
        .notFound("/docs/guide/index.html.md")
        .page("/docs/guide", html("Guide"));

      await crawl({ url: `${ROOT}docs/start`, scope: "hostname", maxDepth: 0 });

      expect(www.wasRequested("/docs/guide/index.html.md")).toBe(true);
    });

    it("admits llms.txt entries against the scope the start URL redirected to", async () => {
      httpSite
        .page("/docs/llms.txt", llmsTxt("https://www.example.com/docs/guide"), MARKDOWN)
        .redirect("/docs", "https://www.example.com/docs/");
      www
        .page("/docs/", html("Start"))
        .notFound("/docs/guide/index.html.md")
        .page("/docs/guide", html("Guide"));

      await crawl({ url: "http://example.com/docs", maxDepth: 0 });

      expect(www.wasRequested("/docs/guide/index.html.md")).toBe(true);
    });

    it("does not request the start URL again when llms.txt lists it", async () => {
      site
        .page("/docs/guide", html("Guide"))
        .page("/docs/llms.txt", llmsTxt(`${ROOT}docs/guide`), MARKDOWN);

      await crawl({ url: `${ROOT}docs/guide`, maxDepth: 0 });

      expect(pages()).toEqual(["/docs/guide"]);
    });

    it("never follows a link to llms.txt", async () => {
      site
        .page("/docs/", html("Docs", ["/docs/llms.txt", "/docs/page"]))
        .page("/docs/page", html("Page"));

      await crawl({ url: `${ROOT}docs/` });

      // Requested once, as the probe.
      expect(site.requestsTo("/docs/llms.txt")).toHaveLength(1);
      expect(pages()).toEqual(["/docs/", "/docs/page"]);
    });

    it("falls back to the page when its Markdown variant is not Markdown", async () => {
      const cases = [
        { label: "HTML", body: "<html>wrong</html>", type: "text/html" },
        {
          label: "a non-Markdown text type",
          body: "body { color: red; }",
          type: "text/css",
        },
      ];

      for (const { label, body, type } of cases) {
        site
          .page("/", html("Root"))
          .page("/llms.txt", llmsTxt(`${ROOT}docs/page.html`), MARKDOWN)
          .page("/docs/page.html.md", body, { type })
          .page("/docs/page.html", html("Page"));

        const events = await crawl({ maxDepth: 0 });

        expect
          .soft(pages(), label)
          .toEqual(["/", "/docs/page.html.md", "/docs/page.html"]);
        expect.soft(storedUrls(events), label).toEqual([ROOT, `${ROOT}docs/page.html`]);
        endCase(label);
      }
    });

    it("records a plain-text Markdown variant as Markdown under its page", async () => {
      // `/docs/guide/` has no route, so asking for it would fail the test.
      site
        .page("/", html("Root"))
        .page("/llms.txt", llmsTxt(`${ROOT}docs/guide/`), MARKDOWN)
        .page("/docs/guide/index.html.md", "# Guide\n\nMarkdown variant", PLAIN_TEXT);

      const events = await crawl({ maxDepth: 0 });

      // Fetched as `index.html.md`; the extension strips to `index.html`, which
      // canonicalises to the directory the page lives at.
      expect(eventFor(events, `${ROOT}docs/guide`)?.result).toMatchObject({
        url: `${ROOT}docs/guide`,
        contentUrl: `${ROOT}docs/guide/index.html.md`,
        contentType: "text/markdown",
      });
    });

    it("continues with llms.txt entries when the start URL is not found", async () => {
      site
        .notFound("/")
        .page("/llms.txt", llmsTxt(`${ROOT}guide.md`), MARKDOWN)
        .page("/guide.md", "# Guide\n\nMarkdown page", MARKDOWN);

      const events = await crawl({ maxDepth: 0 });

      expect(storedUrls(events)).toEqual([`${ROOT}guide`]);
    });

    it("fails when the start URL is not found and llms.txt lists only the start URL", async () => {
      site.notFound("/").page("/llms.txt", llmsTxt(ROOT), MARKDOWN);

      await expect(crawl({ maxDepth: 0 })).rejects.toThrow("Root page not found");
    });

    it("probes llms.txt during a refresh and seeds the entries it lists", async () => {
      // The start page is unchanged, which must not stop its llms.txt seeds.
      site
        .page("/", html("Root"), { etag: '"root-v1"' })
        .page("/llms.txt", llmsTxt(`${ROOT}new`), MARKDOWN)
        .page("/existing", html("Existing"))
        .notFound("/new/index.html.md")
        .page("/new", html("New"));

      await crawl({
        initialQueue: [
          { url: ROOT, depth: 0, pageId: 1, etag: '"root-v1"' },
          { url: `${ROOT}existing`, depth: 1, pageId: 2 },
        ],
      });

      expect(site.requestsTo("/")[0]?.ifNoneMatch).toBe('"root-v1"');
      expect(site.wasRequested("/new/index.html.md")).toBe(true);
    });

    it("admits llms.txt entries through the same gates as discovered links", async () => {
      site
        .page("/", html("Root"))
        .page(
          "/llms.txt",
          llmsTxt(`${ROOT}docs.zip`, `${ROOT}diagram.png`, `${ROOT}blocked`, `${ROOT}ok`),
          MARKDOWN,
        )
        .notFound("/ok/index.html.md")
        .page("/ok", html("OK"));

      await crawl(
        { maxDepth: 0 },
        following((_base, target) => !target.pathname.includes("blocked")),
      );

      expect(pages()).toEqual(["/", "/ok/index.html.md", "/ok"]);
    });

    it("probes llms.txt without the content-type gate pages are fetched with", async () => {
      // The index is parsed directly rather than by a pipeline, so the types the
      // pipelines read must not decide whether it is downloaded.
      site
        .page("/", html("Root"))
        .page("/llms.txt", llmsTxt(`${ROOT}guide`), { type: "application/octet-stream" })
        .notFound("/guide/index.html.md")
        .page("/guide", html("Guide"));

      const events = await crawl({ maxDepth: 0 });

      expect(storedUrls(events)).toEqual([ROOT, `${ROOT}guide`]);
    });
  });

  describe("queue-time link gate", () => {
    it("never requests a link to binary media or an archive", async () => {
      // None of these has a route, so a request for one would fail the test.
      site.page(
        "/",
        html("Root", [
          "/assets/diagram.png",
          "/assets/photo.jpg",
          "/assets/flame.svg",
          "/assets/demo.mp4",
          // Archives are readable as a start URL but deliberately not followed.
          "/downloads/docs.zip",
          "/downloads/docs.tar.gz",
        ]),
      );

      await crawl();

      expect(pages()).toEqual(["/"]);
    });

    it("requests a link a pipeline may read, or whose type only the response can tell", async () => {
      const links = [
        // Binary, but a pipeline reads it.
        "/guide.pdf",
        "/example.py",
        "/notes.txt",
        // No extension: the fetch-time gate decides on the served type.
        "/docs/getting-started",
        // Extensions detection has no opinion on (issue #490).
        "/Guess/guess.qbas",
        "/Guess/guess.ps",
        // The extension is in the query, not the path.
        "/download?file=diagram.png",
      ];
      site.page("/", html("Root", links));
      for (const link of links) site.notFound(link);

      await crawl();

      expect(pages()).toEqual(["/", ...links]);
    });

    it("keeps rejected links out of totalDiscovered", async () => {
      site
        .page("/", html("Root", ["/a.png", "/b.jpg", "/c.svg", "/real-page"]))
        .page("/real-page", html("Real page"));

      const events = await crawl();

      // The root plus the one processable link; the images never enter the queue.
      expect(events.at(-1)).toMatchObject({ totalDiscovered: 2, pagesScraped: 2 });
    });

    // Currently requested: links on a page that extracted no text bypass these gates.
    it.todo("applies the link gates to links on a page that extracted no text");
  });

  describe("archive start URL", () => {
    const archive = readFileSync(
      path.join(__dirname, "../../../test/fixtures/archive.zip"),
    );
    /** Temp copies of the downloaded archive named `name`. */
    const tempCopies = (name: string): string[] =>
      readdirSync(os.tmpdir()).filter((file) => file.endsWith(`-${name}`));

    it("reports a downloaded archive as a container rather than a page", async () => {
      site.page("/docs.zip", archive, { type: "application/zip" });
      const strategy = new WebScraperStrategy(config);

      const events = await crawl({ url: `${ROOT}docs.zip`, maxDepth: 0 }, strategy);
      await strategy.cleanup();

      expect(events.map((event) => event.outcome)).toEqual([PageOutcome.Empty]);
      expect(events[0]?.emptyPage).toBeUndefined();
    });

    it("deletes the downloaded archive on cleanup", async () => {
      const name = `cleanup-${Date.now()}.zip`;
      site.page(`/${name}`, archive, { type: "application/zip" });
      const strategy = new WebScraperStrategy(config);
      await crawl({ url: `${ROOT}${name}`, maxDepth: 0 }, strategy);
      expect(tempCopies(name)).toHaveLength(1);

      await strategy.cleanup();

      expect(tempCopies(name)).toEqual([]);
    });

    // The two tests above stop at the archive itself (maxDepth 0), so they hold
    // whether or not its members are crawled. Currently none is: the listing scopes
    // file:// entries against the https start URL and drops them all. Once queued,
    // a member would still fail, read through FileFetcher, which cannot stat a path
    // inside a zip (ENOTDIR).
    it.todo("indexes the members of an archive served at the start URL");
  });

  describe("cleanup", () => {
    const fakePipeline = (close: () => Promise<void>): ContentPipeline => ({
      canProcess: () => false,
      process: async () => ({}),
      close: vi.fn(close),
    });

    it("closes every pipeline even when one fails to close, and can be cleaned up again", async () => {
      const failing = fakePipeline(() => Promise.reject(new Error("close failed")));
      const healthy = fakePipeline(() => Promise.resolve());
      const factory = vi
        .spyOn(PipelineFactory, "createStandardPipelines")
        .mockReturnValueOnce([failing, healthy]);
      const strategy = new WebScraperStrategy(config);
      factory.mockRestore();

      await expect(strategy.cleanup()).resolves.toBeUndefined();
      expect(failing.close).toHaveBeenCalledOnce();
      expect(healthy.close).toHaveBeenCalledOnce();

      await expect(strategy.cleanup()).resolves.toBeUndefined();
    });
  });
});
