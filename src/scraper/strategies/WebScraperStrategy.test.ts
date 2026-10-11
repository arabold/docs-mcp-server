import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../utils/config";
import { logger } from "../../utils/logger";
import { HttpFetcher } from "../fetcher/HttpFetcher";
import { FetchStatus, type RawContent } from "../fetcher/types";
import { PipelineFactory } from "../pipelines/PipelineFactory";
import type { ContentPipeline } from "../pipelines/types";
import {
  PageOutcome,
  ScrapeMode,
  type ScraperOptions,
  type ScraperProgressEvent,
} from "../types";
import { isLlmsTxtUrl } from "../utils/llmsTxtParser";
import { WebScraperStrategy, type WebScraperStrategyOptions } from "./WebScraperStrategy";

// Building realistic request headers loads a large browser-fingerprint model on
// every fetcher construction. Requests never leave the spy below, so the model
// only costs time.
vi.mock("../fetcher/FingerprintGenerator");

const fetchSpy = vi.spyOn(HttpFetcher.prototype, "fetch");
const config = loadConfig();
const ROOT = "https://example.com/";

type Response = Partial<RawContent>;

/** Answers requests from `site`; every other URL, llms.txt included, is a 404. */
function serve(site: Record<string, Response>): void {
  fetchSpy.mockImplementation(async (url: string) => ({
    content: "",
    mimeType: "text/html",
    source: url,
    ...(site[url]
      ? { status: FetchStatus.SUCCESS, ...site[url] }
      : { status: FetchStatus.NOT_FOUND }),
  }));
}

/** An HTML page headed `title` that links each of `hrefs`. */
const html = (title: string, hrefs: string[] = []): Response => ({
  content: `<html><head><title>${title}</title></head><body><h1>${title}</h1>${hrefs
    .map((href) => `<a href="${href}">${href}</a>`)
    .join("")}</body></html>`,
  mimeType: "text/html",
});
const markdown = (text: string): Response => ({
  content: text,
  mimeType: "text/markdown",
});
/** An llms.txt index listing `links`. */
const llmsTxt = (...links: string[]): Response =>
  markdown(`# Docs\n\n${links.map((link) => `- [${link}](${link})`).join("\n")}`);

const opts = (overrides: Partial<ScraperOptions> = {}): ScraperOptions => ({
  url: ROOT,
  library: "test",
  version: "1.0",
  maxPages: 50,
  maxDepth: 1,
  scrapeMode: ScrapeMode.Fetch,
  ...overrides,
});

/** Crawls with a fresh strategy and returns every progress event. */
async function crawl(
  overrides: Partial<ScraperOptions> = {},
  strategyOptions: WebScraperStrategyOptions = {},
): Promise<ScraperProgressEvent[]> {
  const events: ScraperProgressEvent[] = [];
  await new WebScraperStrategy(config, strategyOptions).scrape(
    opts(overrides),
    async (event) => {
      events.push(event);
    },
  );
  return events;
}

const fetchedUrls = (): string[] => fetchSpy.mock.calls.map(([url]) => url);
/** Requested URLs other than llms.txt probes, in request order. */
const fetchedPages = (): string[] => fetchedUrls().filter((url) => !isLlmsTxtUrl(url));
const probes = (): string[] => fetchedUrls().filter((url) => isLlmsTxtUrl(url));
const requestOptions = (url: string) => fetchSpy.mock.calls.find(([u]) => u === url)?.[1];
const storedUrls = (events: ScraperProgressEvent[]): string[] =>
  events.flatMap((event) => (event.result ? [event.result.url] : []));
const eventFor = (events: ScraperProgressEvent[], url: string) =>
  events.find((event) => event.currentUrl === url);

beforeEach(() => {
  vi.clearAllMocks();
  serve({});
});

describe("WebScraperStrategy", () => {
  it("handles only http and https URLs", () => {
    const strategy = new WebScraperStrategy(config);

    expect(strategy.canHandle("https://example.com")).toBe(true);
    expect(strategy.canHandle("http://example.com")).toBe(true);
    expect(strategy.canHandle("file:///path/to/file.txt")).toBe(false);
    expect(strategy.canHandle("invalid://example.com")).toBe(false);
    expect(strategy.canHandle("any_string")).toBe(false);
  });

  it("sends followRedirects and the custom headers with every page request", async () => {
    serve({ [ROOT]: html("Root", ["/child"]), [`${ROOT}child`]: html("Child") });
    const headers = { Authorization: "Bearer test-token", "X-Test-Header": "test-value" };

    await crawl({ followRedirects: false, headers });

    for (const url of [ROOT, `${ROOT}child`]) {
      expect(requestOptions(url)).toMatchObject({ followRedirects: false, headers });
    }
  });

  describe("content processing", () => {
    it.each([
      [
        "HTML",
        html("HTML Test"),
        {
          title: "HTML Test",
          textContent: expect.stringContaining("# HTML Test"),
          sourceContentType: "text/html",
        },
      ],
      [
        "Markdown",
        markdown("# Markdown Title\n\nThis is already markdown content."),
        {
          textContent: expect.stringContaining("This is already markdown content."),
          sourceContentType: "text/markdown",
          contentType: "text/markdown",
        },
      ],
      [
        "plain text",
        { content: "# Plain Title\n\nThis stays plain text.", mimeType: "text/plain" },
        {
          textContent: expect.stringContaining("This stays plain text."),
          contentType: "text/plain",
        },
      ],
    ])("processes %s through its pipeline", async (_label, response, expected) => {
      serve({ [ROOT]: response });

      const events = await crawl({ maxDepth: 0 });

      expect(events.find((event) => event.result)?.result).toMatchObject(expected);
    });

    it("follows links found in Markdown content", async () => {
      serve({
        [`${ROOT}docs/`]: markdown("# Start\n\nContinue to the [guide](guide)."),
        [`${ROOT}docs/guide`]: markdown("# Guide\n\nMarkdown linked page."),
      });

      const events = await crawl({ url: `${ROOT}docs/` });

      expect(storedUrls(events)).toEqual([`${ROOT}docs`, `${ROOT}docs/guide`]);
    });

    it("fails the job, naming the type, when no pipeline reads the start URL", async () => {
      // Completing with zero documents would not tell the user whether they
      // mistyped the URL or asked for a format this server cannot read.
      serve({
        [`${ROOT}image.png`]: {
          content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          mimeType: "image/png",
        },
      });

      await expect(crawl({ url: `${ROOT}image.png` })).rejects.toThrow(
        /Cannot process image\/png/,
      );
    });

    it("skips a child no pipeline can read without failing the crawl", async () => {
      serve({
        [ROOT]: html("Root", ["/asset", "/page"]),
        [`${ROOT}asset`]: {
          content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          mimeType: "image/png",
        },
        [`${ROOT}page`]: html("Page"),
      });

      const events = await crawl();

      // Skipped rather than empty: nothing read the body, so a refresh must not
      // treat it as a page that lost its content.
      expect(eventFor(events, `${ROOT}asset`)).toMatchObject({
        outcome: PageOutcome.Skipped,
        result: null,
      });
      expect(eventFor(events, `${ROOT}asset`)?.emptyPage).toBeUndefined();
      expect(storedUrls(events)).toEqual([ROOT, `${ROOT}page`]);
    });

    it("reports a clean empty extraction as an empty page carrying its validators", async () => {
      // A pipeline that runs cleanly and extracts nothing is a statement that the
      // page is empty, so the validators describe that state accurately.
      serve({
        [`${ROOT}page`]: {
          content: "<html><body></body></html>",
          etag: '"v2"',
          lastModified: "2026-01-01T00:00:00.000Z",
        },
      });

      const events = await crawl({ url: `${ROOT}page`, maxDepth: 0 });

      expect(events).toEqual([
        expect.objectContaining({
          outcome: PageOutcome.Empty,
          pagesIndexed: 0,
          emptyPage: expect.objectContaining({
            url: `${ROOT}page`,
            etag: '"v2"',
            lastModified: "2026-01-01T00:00:00.000Z",
            pipelineFailed: false,
          }),
        }),
      ]);
    });
  });

  describe("page identity", () => {
    it.each([
      [
        "a Markdown file",
        "https://vite.dev/guide/ssr.md",
        markdown("# Server-Side Rendering\n\nSome guidance about SSR."),
        "https://vite.dev/guide/ssr",
      ],
      [
        // react.dev serves its .md alternates as text/plain.
        "a Markdown file served as plain text",
        "https://react.dev/learn.md",
        { content: "# Quick Start\n\nWelcome.", mimeType: "text/plain" },
        "https://react.dev/learn",
      ],
      [
        // A soft 404 answering HTML must not fold onto a page it does not serve.
        "a .md URL that answers HTML",
        "https://tailwindcss.com/docs/flex.md",
        html("Not found"),
        "https://tailwindcss.com/docs/flex.md",
      ],
      [
        "Markdown at an extensionless URL",
        `${ROOT}guide`,
        markdown("# Guide\n\nBody text."),
        `${ROOT}guide`,
      ],
      [
        "a non-Markdown extension",
        `${ROOT}notes.txt`,
        { content: "plain notes", mimeType: "text/plain" },
        `${ROOT}notes.txt`,
      ],
      ["a directory URL", `${ROOT}docs/`, html("Docs"), `${ROOT}docs`],
      ["a bare origin", "https://example.com", html("Home"), ROOT],
    ])("records %s under its page identity", async (_label, url, response, recorded) => {
      serve({ [url]: response });

      const events = await crawl({ url, maxDepth: 0 });

      expect(storedUrls(events)).toEqual([recorded]);
    });

    it.each([
      ["/docs", `${ROOT}docs#/guide`],
      ["/docs/", `${ROOT}docs/#/guide`],
    ])(
      "keeps the requested hash route when the server answers from %s",
      async (path, recorded) => {
        const start = `${ROOT}docs#/guide`;
        serve({ [start]: { ...html("Guide"), source: `https://example.com${path}` } });

        const events = await crawl({ url: start, preserveHashes: true, maxDepth: 0 });

        expect(events.find((event) => event.result)).toMatchObject({
          currentUrl: recorded,
          result: { url: recorded },
        });
      },
    );
  });

  describe("scope", () => {
    // The scope matrix itself is covered in utils/scope.test.ts; these check that
    // the crawl applies the configured mode to discovered links.
    it.each([
      [
        "the default subpages",
        undefined,
        `${ROOT}api/`,
        [`${ROOT}api/intro`],
        [`${ROOT}blog/post`, "https://api.example.com/v1", "https://other.com/page"],
      ],
      [
        "hostname",
        "hostname",
        `${ROOT}api`,
        [`${ROOT}blog/post`],
        ["https://api.example.com/v1"],
      ],
      [
        "domain",
        "domain",
        "https://docs.example.com/",
        ["https://api.example.com/v1"],
        ["https://example.org/page"],
      ],
    ] as const)(
      "follows only links within %s scope",
      async (_label, scope, start, follows, skips) => {
        serve({ [start]: html("Start", [...follows, ...skips]) });

        await crawl({ url: start, scope });

        expect(fetchedPages()).toEqual([start, ...follows]);
      },
    );

    it.each([
      {
        to: "a hash-suffixed path",
        start: `${ROOT}foo`,
        final: `${ROOT}foo~abc`,
        follows: [`${ROOT}foo/child`],
        skips: [],
      },
      {
        to: "a deeper page",
        start: `${ROOT}api`,
        final: `${ROOT}api/v2/intro`,
        follows: [`${ROOT}api/v1/intro`, `${ROOT}api/v2/intro/child`],
        skips: [],
      },
      {
        to: "a sibling path",
        start: `${ROOT}v1/api`,
        final: `${ROOT}v2/api`,
        follows: [`${ROOT}v1/api/child`],
        skips: [`${ROOT}v2/api/child`],
      },
      {
        to: "the homepage",
        start: `${ROOT}removed`,
        final: ROOT,
        follows: [],
        skips: [`${ROOT}home/intro`],
      },
      {
        to: "https",
        start: "http://example.com/api",
        final: `${ROOT}api`,
        follows: [`${ROOT}api/child`],
        skips: [],
      },
      {
        to: "the www host",
        start: `${ROOT}api`,
        final: "https://www.example.com/api",
        follows: ["https://www.example.com/api/child"],
        skips: [],
      },
      {
        to: "another port",
        start: `${ROOT}api`,
        final: "https://example.com:8443/api",
        follows: ["https://example.com:8443/api/child"],
        skips: [],
      },
      {
        to: "a deeper path, keeping the hash route",
        start: `${ROOT}docs#/guide`,
        final: `${ROOT}docs/`,
        follows: [`${ROOT}docs/#/api`],
        skips: [],
        preserveHashes: true,
      },
      {
        to: "a sibling path, dropping the hash route",
        start: `${ROOT}foo#/guide`,
        final: `${ROOT}bar`,
        follows: [],
        skips: [`${ROOT}bar#/api`],
        preserveHashes: true,
      },
    ])(
      "anchors scope at the requested path after a redirect to $to",
      async ({ start, final, follows, skips, preserveHashes }) => {
        serve({ [start]: { ...html("Start", [...follows, ...skips]), source: final } });

        await crawl({ url: start, preserveHashes });

        expect(fetchedPages()).toEqual([start, ...follows]);
      },
    );

    const siblingwiseWarnings = (): string[] =>
      vi
        .mocked(logger.warn)
        .mock.calls.map(([message]) => String(message))
        .filter((message) => message.includes("siblingwise"));

    it("warns once, naming the kept anchor, when a redirect moves to a sibling path", async () => {
      serve({ [`${ROOT}v1/api`]: { ...html("Start"), source: `${ROOT}v2/api` } });

      await crawl({ url: `${ROOT}v1/api` });

      const warnings = siblingwiseWarnings();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(`Requested: ${ROOT}v1/api`);
      expect(warnings[0]).toContain("Scope anchor: /v1/api");
    });

    it("does not warn when a redirect moves deeper below the requested path", async () => {
      serve({
        [`${ROOT}docs`]: {
          ...html("Start"),
          source: `${ROOT}docs/installation/using-vite`,
        },
      });

      await crawl({ url: `${ROOT}docs` });

      expect(siblingwiseWarnings()).toEqual([]);
    });

    it("resolves relative links against the URL the start page redirected to", async () => {
      const start = "https://learn.microsoft.com/en-us/azure/bot-service";
      serve({
        [start]: {
          ...html("Bot Service", ["bot-overview?view=azure-bot-service-4.0"]),
          source: `${start}/?view=azure-bot-service-4.0`,
        },
      });

      await crawl({ url: start });

      expect(fetchedPages()).toEqual([
        start,
        `${start}/bot-overview?view=azure-bot-service-4.0`,
      ]);
    });

    it("resolves relative links against <base href> before checking scope", async () => {
      // Against the page, `guide` would be an in-scope /app/guide; against the
      // cross-origin base it is out of scope.
      const start = `${ROOT}app/index.html`;
      serve({
        [start]: {
          content:
            '<html><head><base href="https://cdn.example.com/lib/"></head><body><a href="guide">Guide</a></body></html>',
          mimeType: "text/html",
        },
      });

      await crawl({ url: start });

      expect(fetchedPages()).toEqual([start]);
    });

    it("follows hash-route links as distinct pages when preserveHashes is enabled", async () => {
      serve({ [ROOT]: html("Docs", ["#/Docs/welcome", "#/Docs/api"]) });

      await crawl({ preserveHashes: true });

      expect(fetchedPages()).toEqual([
        ROOT,
        `${ROOT}#/Docs/welcome`,
        `${ROOT}#/Docs/api`,
      ]);
    });

    it("follows only the links a custom shouldFollowLink accepts", async () => {
      serve({
        [ROOT]: html("Base", ["/allowed-page", "/blocked-page", "/also-allowed"]),
      });

      await crawl(
        {},
        { shouldFollowLink: (_base, target) => target.pathname.includes("allowed") },
      );

      expect(fetchedPages()).toEqual([
        ROOT,
        `${ROOT}allowed-page`,
        `${ROOT}also-allowed`,
      ]);
    });
  });

  describe("llms.txt discovery", () => {
    it.each([
      [`${ROOT}docs/`, [`${ROOT}docs/llms.txt`, `${ROOT}llms.txt`]],
      // A dotted version names a directory, not a file.
      [
        `${ROOT}docs/v1.0`,
        [`${ROOT}docs/v1.0/llms.txt`, `${ROOT}docs/llms.txt`, `${ROOT}llms.txt`],
      ],
      // "index" and page files name a document, not a directory to descend into.
      [`${ROOT}docs/index`, [`${ROOT}docs/llms.txt`, `${ROOT}llms.txt`]],
      [`${ROOT}docs/page.mdx`, [`${ROOT}docs/llms.txt`, `${ROOT}llms.txt`]],
      [`${ROOT}docs/page.html`, [`${ROOT}docs/llms.txt`, `${ROOT}llms.txt`]],
    ])("probes for llms.txt from %s in order", async (start, expected) => {
      serve({ [start]: html("Start") });

      await crawl({ url: start, maxDepth: 0 });

      expect(probes()).toEqual(expected);
    });

    it("stops at the first llms.txt with links and seeds its in-scope entries", async () => {
      const start = `${ROOT}docs/`;
      serve({
        [start]: html("Docs"),
        [`${ROOT}docs/llms.txt`]: markdown(
          "# Docs\n\n- [Intro](intro)\n- [Other](https://example.com/other)",
        ),
      });
      const headers = { Authorization: "Bearer token" };

      await crawl({ url: start, maxDepth: 0, followRedirects: true, headers });

      expect(probes()).toEqual([`${ROOT}docs/llms.txt`]);
      expect(requestOptions(`${ROOT}docs/llms.txt`)).toMatchObject({
        followRedirects: true,
        headers,
      });
      // A seed is asked for its Markdown variant first, then for the page itself.
      expect(fetchedPages()).toEqual([
        start,
        `${ROOT}docs/intro/index.html.md`,
        `${ROOT}docs/intro`,
      ]);
    });

    it("resolves llms.txt entries against the URL the index was served from", async () => {
      const start = `${ROOT}docs/start`;
      serve({
        [`${ROOT}docs/llms.txt`]: {
          ...markdown("# Docs\n\n- [Guide](guide)"),
          source: "https://www.example.com/docs/llms.txt",
        },
        [start]: { ...html("Start"), source: "https://www.example.com/docs/start" },
      });

      await crawl({ url: start, scope: "hostname", maxDepth: 0 });

      expect(fetchedPages()).toContain(
        "https://www.example.com/docs/guide/index.html.md",
      );
      expect(fetchedPages()).not.toContain(`${ROOT}docs/guide/index.html.md`);
    });

    it("admits llms.txt entries against the scope the start URL redirected to", async () => {
      serve({
        "http://example.com/docs/llms.txt": llmsTxt("https://www.example.com/docs/guide"),
        "http://example.com/docs": {
          ...html("Start"),
          source: "https://www.example.com/docs/",
        },
      });

      await crawl({ url: "http://example.com/docs", maxDepth: 0 });

      expect(fetchedPages()).toContain(
        "https://www.example.com/docs/guide/index.html.md",
      );
    });

    it("does not request the start URL again when llms.txt lists it", async () => {
      const start = `${ROOT}docs/guide`;
      serve({ [start]: html("Guide"), [`${ROOT}docs/llms.txt`]: llmsTxt(start) });

      await crawl({ url: start, maxDepth: 0 });

      expect(fetchedPages()).toEqual([start]);
    });

    it("never follows a link to llms.txt", async () => {
      serve({ [`${ROOT}docs/`]: html("Docs", ["/docs/llms.txt", "/docs/page"]) });

      await crawl({ url: `${ROOT}docs/` });

      // Requested once, as the probe.
      expect(fetchedUrls().filter((url) => url === `${ROOT}docs/llms.txt`)).toHaveLength(
        1,
      );
      expect(fetchedPages()).toEqual([`${ROOT}docs/`, `${ROOT}docs/page`]);
    });

    it.each([
      ["HTML", { content: "<html>wrong</html>", mimeType: "text/html" }],
      [
        "a non-Markdown text type",
        { content: "body { color: red; }", mimeType: "text/css" },
      ],
    ])(
      "falls back to the page when its Markdown variant answers %s",
      async (_label, variant) => {
        serve({
          [ROOT]: html("Root"),
          [`${ROOT}llms.txt`]: llmsTxt(`${ROOT}docs/page.html`),
          [`${ROOT}docs/page.html.md`]: variant,
          [`${ROOT}docs/page.html`]: html("Page"),
        });

        const events = await crawl({ maxDepth: 0 });

        expect(fetchedPages()).toEqual([
          ROOT,
          `${ROOT}docs/page.html.md`,
          `${ROOT}docs/page.html`,
        ]);
        expect(storedUrls(events)).toEqual([ROOT, `${ROOT}docs/page.html`]);
      },
    );

    it("records a plain-text Markdown variant as Markdown under its page", async () => {
      serve({
        [ROOT]: html("Root"),
        [`${ROOT}llms.txt`]: llmsTxt(`${ROOT}docs/guide/`),
        [`${ROOT}docs/guide/index.html.md`]: {
          content: "# Guide\n\nMarkdown variant",
          mimeType: "text/plain",
        },
      });

      const events = await crawl({ maxDepth: 0 });

      // Fetched as `index.html.md`; the extension strips to `index.html`, which
      // canonicalises to the directory the page lives at.
      expect(eventFor(events, `${ROOT}docs/guide`)?.result).toMatchObject({
        url: `${ROOT}docs/guide`,
        contentUrl: `${ROOT}docs/guide/index.html.md`,
        contentType: "text/markdown",
      });
      expect(fetchedPages()).not.toContain(`${ROOT}docs/guide/`);
    });

    it("requests a Markdown entry as listed, without another .md suffix", async () => {
      serve({
        [ROOT]: html("Root"),
        [`${ROOT}llms.txt`]: llmsTxt(`${ROOT}docs/intro.md`),
        [`${ROOT}docs/intro.md`]: markdown("# Intro\n\nMarkdown page"),
      });

      await crawl({ maxDepth: 0 });

      expect(fetchedPages()).toEqual([ROOT, `${ROOT}docs/intro.md`]);
    });

    it("continues with llms.txt entries when the start URL is not found", async () => {
      serve({
        [`${ROOT}llms.txt`]: llmsTxt(`${ROOT}guide.md`),
        [`${ROOT}guide.md`]: markdown("# Guide\n\nMarkdown page"),
      });

      const events = await crawl({ maxDepth: 0 });

      expect(storedUrls(events)).toEqual([`${ROOT}guide`]);
    });

    it("fails when the start URL is not found and llms.txt lists only the start URL", async () => {
      serve({ [`${ROOT}llms.txt`]: llmsTxt(ROOT) });

      await expect(crawl({ maxDepth: 0 })).rejects.toThrow("Root page not found");
    });

    it("probes llms.txt during a refresh and seeds the entries it lists", async () => {
      serve({
        [ROOT]: { status: FetchStatus.NOT_MODIFIED },
        [`${ROOT}llms.txt`]: llmsTxt(`${ROOT}new`),
        [`${ROOT}existing`]: html("Existing"),
      });

      await crawl({ initialQueue: [{ url: `${ROOT}existing`, depth: 1, pageId: 1 }] });

      expect(fetchedPages()).toContain(`${ROOT}new/index.html.md`);
    });
  });

  describe("queue-time link gate", () => {
    it.each([
      "/assets/diagram.png",
      "/assets/photo.jpg",
      "/assets/flame.svg",
      "/assets/demo.mp4",
    ])("never requests a link to %s", async (href) => {
      serve({ [ROOT]: html("Root", [href]) });

      await crawl();

      expect(fetchedPages()).toEqual([ROOT]);
    });

    it.each([
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
    ])("requests a link to %s", async (href) => {
      serve({ [ROOT]: html("Root", [href]) });

      await crawl();

      expect(fetchedPages()).toEqual([ROOT, new URL(href, ROOT).href]);
    });

    it("keeps rejected links out of totalDiscovered", async () => {
      serve({ [ROOT]: html("Root", ["/a.png", "/b.jpg", "/c.svg", "/real-page"]) });

      const events = await crawl();

      // The root plus the one processable link; the images never enter the queue.
      expect(events.at(-1)).toMatchObject({ totalDiscovered: 2, pagesScraped: 2 });
    });
  });

  describe("refresh", () => {
    it("sends each stored validator and reports unchanged, deleted and updated pages", async () => {
      serve({
        [ROOT]: html("Root"),
        [`${ROOT}unchanged`]: { status: FetchStatus.NOT_MODIFIED },
        [`${ROOT}updated`]: { ...html("Updated"), etag: "new-etag" },
      });
      const initialQueue = [
        { url: `${ROOT}unchanged`, depth: 1, pageId: 1, etag: "etag-1" },
        { url: `${ROOT}deleted`, depth: 1, pageId: 2, etag: "etag-2" },
        { url: `${ROOT}updated`, depth: 1, pageId: 3, etag: "etag-3" },
      ];

      const events = await crawl({ initialQueue });

      for (const item of initialQueue) {
        expect(requestOptions(item.url)).toMatchObject({ etag: item.etag });
      }
      expect(eventFor(events, `${ROOT}unchanged`)).toMatchObject({
        outcome: PageOutcome.Unchanged,
        pageId: 1,
        result: null,
      });
      expect(eventFor(events, `${ROOT}deleted`)).toMatchObject({
        outcome: PageOutcome.Absent,
        pageId: 2,
        deleted: true,
      });
      expect(eventFor(events, `${ROOT}updated`)).toMatchObject({
        outcome: PageOutcome.Stored,
        pageId: 3,
        result: { url: `${ROOT}updated`, title: "Updated", etag: "new-etag" },
      });
    });
  });

  describe("cleanup", () => {
    const fakePipeline = (close: () => Promise<void>): ContentPipeline => ({
      canProcess: () => false,
      process: async () => ({}),
      close: vi.fn(close),
    });

    it("closes every pipeline even when one fails to close", async () => {
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
    });

    it("can be cleaned up more than once", async () => {
      const strategy = new WebScraperStrategy(config);

      await strategy.cleanup();
      await expect(strategy.cleanup()).resolves.toBeUndefined();
    });
  });
});
