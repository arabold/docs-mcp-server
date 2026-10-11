import { describe, expect, it } from "vitest";
import { CancellationError } from "../../pipeline/errors";
import { type AppConfig, loadConfig } from "../../utils/config";
import { FetchStatus } from "../fetcher/types";
import {
  PageOutcome,
  type QueueItem,
  type ScraperOptions,
  type ScraperProgressEvent,
} from "../types";
import { BaseScraperStrategy, type ProcessItemResult } from "./BaseScraperStrategy";

const ROOT = "https://example.com/";

/** What the fake answers for an item; `url` defaults to the item's own URL. */
type Reply = Omit<ProcessItemResult, "url"> & { url?: string };
type Responder = (item: QueueItem) => Reply | Error | Promise<Reply | Error>;
/** A site as a URL-keyed map, or as a function of the queued item. */
type Site = Record<string, Reply | Error> | Responder;

interface CrawlSetup {
  abortOnFailureRate?: number;
  signal?: AbortSignal;
  /** Stands in for a strategy's own URL canonicalization. */
  canonicalize?: (url: string) => string;
}

interface CrawlRun {
  /** Every progress event, in the order it was reported. */
  events: ScraperProgressEvent[];
  /** Every item handed to `processItem`, in order. */
  processed: QueueItem[];
  /** Settles when the crawl ends. */
  done: Promise<void>;
}

/** Drives the base crawl loop with a scripted site in place of a fetcher. */
class TestScraperStrategy extends BaseScraperStrategy {
  readonly processed: QueueItem[] = [];

  constructor(
    config: AppConfig,
    private readonly respond: Responder,
    private readonly canonicalize?: (url: string) => string,
  ) {
    super(config);
  }

  canHandle(): boolean {
    return true;
  }

  protected override canonicalizeStoredUrl(url: string, options: ScraperOptions): string {
    return this.canonicalize
      ? this.canonicalize(url)
      : super.canonicalizeStoredUrl(url, options);
  }

  protected override async processItem(item: QueueItem): Promise<ProcessItemResult> {
    this.processed.push(item);
    const reply = await this.respond(item);
    if (reply instanceof Error) throw reply;
    return { url: item.url, ...reply };
  }
}

const baseConfig = loadConfig();

const opts = (overrides: Partial<ScraperOptions> = {}): ScraperOptions => ({
  url: ROOT,
  library: "test",
  version: "1.0",
  maxPages: 100,
  maxDepth: 3,
  ...overrides,
});

/** Starts a crawl and returns its live record; await `done` for the outcome. */
function startCrawl(
  site: Site,
  overrides: Partial<ScraperOptions> = {},
  setup: CrawlSetup = {},
): CrawlRun {
  const respond: Responder =
    typeof site === "function"
      ? site
      : (item) => site[item.url] ?? new Error(`unexpected request: ${item.url}`);
  const config: AppConfig =
    setup.abortOnFailureRate === undefined
      ? baseConfig
      : {
          ...baseConfig,
          scraper: {
            ...baseConfig.scraper,
            abortOnFailureRate: setup.abortOnFailureRate,
          },
        };
  const strategy = new TestScraperStrategy(config, respond, setup.canonicalize);
  const events: ScraperProgressEvent[] = [];
  const done = strategy.scrape(
    opts(overrides),
    async (event) => {
      events.push(event);
    },
    setup.signal,
  );
  return { events, processed: strategy.processed, done };
}

/** Runs a crawl that is expected to finish. */
async function crawl(
  site: Site,
  overrides: Partial<ScraperOptions> = {},
  setup: CrawlSetup = {},
): Promise<CrawlRun> {
  const run = startCrawl(site, overrides, setup);
  await run.done;
  return run;
}

/** A page that produced content and links to `links`. */
const page = (links: string[] = [], extra: Partial<ProcessItemResult> = {}): Reply => ({
  links,
  status: FetchStatus.SUCCESS,
  content: { textContent: "content", chunks: [], links: [], errors: [] },
  ...extra,
});
/** A page that was fetched but produced no text. */
const empty = (extra: Partial<ProcessItemResult> = {}): Reply => ({
  links: [],
  status: FetchStatus.SUCCESS,
  ...extra,
});
const notFound = (): Reply => ({ links: [], status: FetchStatus.NOT_FOUND });
const unchanged = (): Reply => ({ links: [], status: FetchStatus.NOT_MODIFIED });
const skipped = (sourceContentType?: string): Reply => ({
  links: [],
  status: FetchStatus.SKIPPED,
  sourceContentType,
});

/** A refresh queue item for a page the store already holds. */
const stored = (
  url: string,
  pageId: number,
  extra: Partial<QueueItem> = {},
): QueueItem => ({
  url,
  depth: 1,
  pageId,
  ...extra,
});

/** `count` child URLs under the root: p0, p1, ... */
const children = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${ROOT}p${i}`);
/** The index of a child URL produced by {@link children}. */
const childIndex = (item: QueueItem): number => Number(item.url.split("/p").at(-1));

const urls = (items: QueueItem[]): string[] => items.map((item) => item.url);
const storedUrls = (events: ScraperProgressEvent[]): string[] =>
  events.filter((e) => e.outcome === PageOutcome.Stored).map((e) => e.currentUrl);
const eventFor = (events: ScraperProgressEvent[], url: string) =>
  events.find((e) => e.currentUrl === url);
const lastEvent = (events: ScraperProgressEvent[]) => events.at(-1);

describe("BaseScraperStrategy", () => {
  describe("start URL failures", () => {
    it.each([
      ["throws", new Error("Root URL failed"), "Root URL failed"],
      ["is not found", notFound(), "Root page not found"],
      ["is unprocessable", skipped("application/zip"), "Cannot process application/zip"],
      // Reported without a type, the failure must still read legibly rather than
      // interpolating "undefined".
      ["is unprocessable without a type", skipped(), "unknown content type"],
    ])(
      "fails the job when the start URL %s, even with ignoreErrors",
      async (_label, reply, message) => {
        const run = startCrawl({ [ROOT]: reply }, { ignoreErrors: true });

        await expect(run.done).rejects.toThrow(message);
        expect(run.events).toEqual([]);
      },
    );

    it.each([
      ["not found", notFound()],
      ["unprocessable", skipped("image/png")],
    ])("does not fail the job when an llms.txt seed is %s", async (_label, reply) => {
      // A seed is one of several discovery hints; a dead entry must not abort a
      // scrape whose real start URL resolved fine.
      const seed = `${ROOT}seed`;
      const run = await crawl({
        [ROOT]: page([], { queueItems: [{ url: seed, depth: 0, fromLlmsTxt: true }] }),
        [seed]: reply,
      });

      expect(storedUrls(run.events)).toEqual([ROOT]);
      expect(eventFor(run.events, seed)?.deleted).toBeUndefined();
    });

    it("treats a tracked start URL that is now missing as a deletion", async () => {
      const run = await crawl(
        { [ROOT]: notFound() },
        { initialQueue: [stored(ROOT, 123, { depth: 0 })] },
      );

      expect(run.events).toEqual([
        expect.objectContaining({
          currentUrl: ROOT,
          outcome: PageOutcome.Absent,
          deleted: true,
          pageId: 123,
          result: null,
        }),
      ]);
    });

    it("does not fail a refresh when a tracked start URL becomes unprocessable", async () => {
      const run = await crawl(
        { [ROOT]: skipped("application/zip") },
        { initialQueue: [stored(ROOT, 42, { depth: 0 })] },
      );

      expect(run.events.map((e) => e.outcome)).toEqual([PageOutcome.Skipped]);
    });

    it("does not fail the job while a missing start URL can fall back to its page", async () => {
      // The start URL is a stored page's Markdown representation; a 404 there
      // says nothing about the page until the page itself has been asked.
      const start = `${ROOT}guide.md`;
      const run = await crawl(
        { [start]: notFound(), [`${ROOT}guide`]: page() },
        {
          url: start,
          initialQueue: [stored(start, 7, { depth: 0, identityUrl: `${ROOT}guide` })],
        },
      );

      expect(storedUrls(run.events)).toEqual([`${ROOT}guide`]);
    });
  });

  describe("child failures", () => {
    it("reports a missing child as absent rather than deleted and keeps crawling", async () => {
      const run = await crawl({
        [ROOT]: page([`${ROOT}missing`, `${ROOT}valid`]),
        [`${ROOT}missing`]: notFound(),
        [`${ROOT}valid`]: page(),
      });

      expect(storedUrls(run.events)).toEqual([ROOT, `${ROOT}valid`]);
      expect(eventFor(run.events, `${ROOT}missing`)).toMatchObject({
        outcome: PageOutcome.Absent,
        result: null,
      });
      expect(run.events.some((e) => e.deleted)).toBe(false);
    });

    it("reports a throwing child as failed and keeps crawling when ignoreErrors is on", async () => {
      const run = await crawl(
        {
          [ROOT]: page([`${ROOT}broken`, `${ROOT}valid`]),
          [`${ROOT}broken`]: new Error("Child page error"),
          [`${ROOT}valid`]: page(),
        },
        { ignoreErrors: true },
      );

      expect(eventFor(run.events, `${ROOT}broken`)).toMatchObject({
        outcome: PageOutcome.Failed,
        result: null,
      });
      expect(storedUrls(run.events)).toEqual([ROOT, `${ROOT}valid`]);
    });

    it("fails the job with the child's error when ignoreErrors is off", async () => {
      const run = startCrawl({
        [ROOT]: page([`${ROOT}broken`]),
        [`${ROOT}broken`]: new Error("Child page error"),
      });

      await expect(run.done).rejects.toThrow("Child page error");
      expect(storedUrls(run.events)).toEqual([ROOT]);
    });
  });

  describe("failure-rate threshold", () => {
    const failing = (kind: "error" | "404"): Reply | Error =>
      kind === "error" ? new Error("child failed") : notFound();

    /** A root linking `total` children, the first `failures` of which fail. */
    const siteWithFailures =
      (total: number, failures: number, kind: "error" | "404"): Responder =>
      (item) => {
        if (item.depth === 0) return page(children(total));
        return childIndex(item) < failures ? failing(kind) : page();
      };

    it.each([
      ["6 of 10 children throw", 10, 6, "error"],
      ["6 of 10 children are not found", 10, 6, "404"],
    ] as const)("aborts the crawl when %s", async (_label, total, failures, kind) => {
      const run = startCrawl(
        siteWithFailures(total, failures, kind),
        { ignoreErrors: true },
        { abortOnFailureRate: 0.5 },
      );

      await expect(run.done).rejects.toThrow(
        /Scrape aborted after \d+\/\d+ child pages failed/,
      );
    });

    it.each([
      // Exactly at the threshold is not past it.
      ["5 of 10 children throw", 10, 5],
      // Fewer than ten attempts is too small a sample to judge.
      ["9 of 9 children throw", 9, 9],
    ] as const)("finishes the crawl when %s", async (_label, total, failures) => {
      const run = await crawl(
        siteWithFailures(total, failures, "error"),
        { ignoreErrors: true },
        { abortOnFailureRate: 0.5 },
      );

      expect(run.processed).toHaveLength(total + 1);
    });

    it("does not count refresh deletions as failures", async () => {
      const deletions = children(10).map((url, i) => stored(url, i + 1));
      const run = await crawl(
        (item) => (item.depth === 0 ? page() : notFound()),
        { initialQueue: deletions },
        { abortOnFailureRate: 0 },
      );

      expect(run.events.filter((e) => e.deleted)).toHaveLength(10);
    });

    it("does not count dead llms.txt seeds as failures", async () => {
      // Counting them would abort the scrape by the back door, which is exactly
      // what treating seed 404s as non-fatal is meant to prevent.
      const seeds = children(20).map((url) => ({ url, depth: 0, fromLlmsTxt: true }));
      const run = await crawl(
        (item) => (item.url === ROOT ? page([], { queueItems: seeds }) : notFound()),
        {},
        { abortOnFailureRate: 0 },
      );

      expect(run.processed).toHaveLength(21);
    });

    it("does not count unprocessable children as failures", async () => {
      // 15 skips against 5 pages: counted as failures that is a 0.75 rate.
      const run = await crawl(
        (item) => {
          if (item.depth === 0) return page(children(20));
          return childIndex(item) < 15 ? skipped("image/png") : page();
        },
        {},
        { abortOnFailureRate: 0.5 },
      );

      expect(run.processed).toHaveLength(21);
    });

    it("still aborts on genuine failures among unprocessable children", async () => {
      const run = startCrawl(
        (item) => {
          if (item.depth === 0) return page(children(40));
          return childIndex(item) < 20 ? skipped("image/png") : new Error("boom");
        },
        { ignoreErrors: true },
        { abortOnFailureRate: 0.5 },
      );

      await expect(run.done).rejects.toThrow(/Scrape aborted/);
    });

    it("drops the rest of a concurrent batch once the threshold trips", async () => {
      // Ten children fail at once; an eleventh in the same batch succeeds only
      // after the threshold has tripped, and must not be reported as stored.
      let release = (): void => {};
      const late = new Promise<void>((resolve) => {
        release = resolve;
      });
      const run = startCrawl(
        async (item) => {
          if (item.depth === 0) return page(children(11));
          if (childIndex(item) < 10) return new Error("child failed");
          await late;
          return page();
        },
        { ignoreErrors: true, maxConcurrency: 11 },
        { abortOnFailureRate: 0.5 },
      );

      await expect(run.done).rejects.toThrow(/Scrape aborted after 10\/10/);
      release();
      await new Promise(setImmediate);

      expect(eventFor(run.events, `${ROOT}p10`)).toBeUndefined();
    });

    // Currently counted: a refresh of a site that withdrew its Markdown files aborts.
    it.todo("does not count a missing representation with a page to fall back to");
  });

  describe("refresh", () => {
    it("processes stored items before newly discovered links", async () => {
      const run = await crawl(
        {
          [ROOT]: page([`${ROOT}new-page`]),
          [`${ROOT}existing1`]: page(),
          [`${ROOT}existing2`]: page(),
          [`${ROOT}new-page`]: page(),
        },
        {
          initialQueue: [
            stored(`${ROOT}existing1`, 101, { etag: "etag1" }),
            stored(`${ROOT}existing2`, 102, { etag: "etag2" }),
          ],
        },
      );

      expect(urls(run.processed)).toEqual([
        ROOT,
        `${ROOT}existing1`,
        `${ROOT}existing2`,
        `${ROOT}new-page`,
      ]);
    });

    it("hands stored items to processItem as stored, without a second copy of the start URL", async () => {
      const initialQueue = [
        stored(ROOT, 100, { depth: 0, etag: '"root-etag"' }),
        stored(`${ROOT}page1`, 101, { etag: '"page1-etag"' }),
      ];
      const run = await crawl(() => page(), { initialQueue });

      expect(run.processed).toEqual(initialQueue);
    });

    it("reports stored items with their pageId and stored depth", async () => {
      const run = await crawl(() => page(), {
        initialQueue: [
          stored(`${ROOT}page1`, 101),
          stored(`${ROOT}deep`, 102, { depth: 2 }),
        ],
      });

      expect(eventFor(run.events, `${ROOT}page1`)).toMatchObject({
        pageId: 101,
        depth: 1,
      });
      expect(eventFor(run.events, `${ROOT}deep`)).toMatchObject({
        pageId: 102,
        depth: 2,
      });
    });

    it("reports a stored page that is now missing as deleted", async () => {
      const run = await crawl(
        { [ROOT]: page(), [`${ROOT}deleted`]: notFound() },
        { initialQueue: [stored(`${ROOT}deleted`, 101, { etag: "etag1" })] },
      );

      expect(eventFor(run.events, `${ROOT}deleted`)).toMatchObject({
        outcome: PageOutcome.Absent,
        deleted: true,
        pageId: 101,
        result: null,
      });
    });

    it("asks the page itself, without the stale validator, when its representation is gone", async () => {
      const run = await crawl(
        { [ROOT]: page(), [`${ROOT}guide.md`]: notFound(), [`${ROOT}guide`]: page() },
        {
          initialQueue: [
            stored(`${ROOT}guide.md`, 7, {
              etag: '"md-etag"',
              identityUrl: `${ROOT}guide`,
            }),
          ],
        },
      );

      expect(run.processed.at(-1)).toEqual({
        url: `${ROOT}guide`,
        depth: 1,
        pageId: 7,
        etag: null,
      });
      expect(run.events.some((e) => e.deleted)).toBe(false);
    });

    it("deletes the page when neither its representation nor the page is served", async () => {
      const run = await crawl(
        { [ROOT]: page(), [`${ROOT}guide.md`]: notFound(), [`${ROOT}guide`]: notFound() },
        {
          initialQueue: [stored(`${ROOT}guide.md`, 7, { identityUrl: `${ROOT}guide` })],
        },
      );

      expect(run.events.filter((e) => e.deleted)).toEqual([
        expect.objectContaining({ currentUrl: `${ROOT}guide`, pageId: 7 }),
      ]);
    });
  });

  describe("page identity", () => {
    it("sends a second representation of a stored page without counting it again", async () => {
      // `/guide` and `/guide.md` are queued together; the second resolves to the
      // identity the first already stored.
      const run = await crawl({
        [ROOT]: page([`${ROOT}guide`, `${ROOT}guide.md`]),
        [`${ROOT}guide`]: page(),
        [`${ROOT}guide.md`]: page([], { url: `${ROOT}guide` }),
      });

      const guide = run.events.filter((e) => e.result?.url === `${ROOT}guide`);
      expect(guide.map((e) => e.result?.isAdditionalRepresentation)).toEqual([
        false,
        true,
      ]);
      expect(lastEvent(run.events)).toMatchObject({ pagesScraped: 3, pagesIndexed: 2 });
    });

    it("does not queue a page already stored under another spelling", async () => {
      const run = await crawl({
        [ROOT]: page([`${ROOT}guide.md`]),
        [`${ROOT}guide.md`]: page([`${ROOT}guide`], { url: `${ROOT}guide` }),
      });

      expect(urls(run.processed)).toEqual([ROOT, `${ROOT}guide.md`]);
    });

    it.each([
      ["stored", page()],
      ["empty", empty()],
    ])(
      "records where a %s page was read from when its identity moves",
      async (_label, reply) => {
        const run = await crawl(
          { [`${ROOT}docs/`]: reply },
          { url: `${ROOT}docs/`, maxDepth: 0 },
          { canonicalize: (url) => url.replace(/\/+$/, "") },
        );

        const event = lastEvent(run.events);
        expect(event?.result?.url ?? event?.emptyPage?.url).toBe(`${ROOT}docs`);
        expect(event?.result?.contentUrl ?? event?.emptyPage?.contentUrl).toBe(
          `${ROOT}docs/`,
        );
      },
    );

    it("keeps the retrieval location a strategy reports", async () => {
      const run = await crawl({ [ROOT]: page([], { contentUrl: `${ROOT}index.md` }) });

      expect(lastEvent(run.events)?.result?.contentUrl).toBe(`${ROOT}index.md`);
    });
  });

  describe("link admission", () => {
    it("processes each normalized URL once", async () => {
      // Duplicates, a trailing slash and a fragment collapse; a query does not.
      const run = await crawl({
        [ROOT]: page([
          `${ROOT}page1`,
          `${ROOT}page1`,
          `${ROOT}page2`,
          `${ROOT}page2/`,
          `${ROOT}page2?q=1`,
          `${ROOT}page2?q=1#anchor`,
        ]),
        [`${ROOT}page1`]: page(),
        [`${ROOT}page2`]: page(),
        [`${ROOT}page2?q=1`]: page(),
      });

      expect(urls(run.processed)).toEqual([
        ROOT,
        `${ROOT}page1`,
        `${ROOT}page2`,
        `${ROOT}page2?q=1`,
      ]);
    });

    it("keeps distinct hash routes apart when preserveHashes is enabled", async () => {
      const run = await crawl(
        {
          [ROOT]: page([`${ROOT}#/guide`, `${ROOT}#/api`, `${ROOT}#/guide`]),
          [`${ROOT}#/guide`]: page(),
          [`${ROOT}#/api`]: page(),
        },
        { preserveHashes: true },
      );

      expect(urls(run.processed)).toEqual([ROOT, `${ROOT}#/guide`, `${ROOT}#/api`]);
    });

    it("visits pages breadth-first, each at its shallowest depth", async () => {
      // / -> A, B, D;  A -> B;  B -> C, E;  C -> X;  D -> E;  E -> X.
      // D and E finish after their batch-mates, which must not reorder the queue.
      const links: Record<string, string[]> = {
        [ROOT]: [`${ROOT}A`, `${ROOT}B`, `${ROOT}D`],
        [`${ROOT}A`]: [`${ROOT}B`],
        [`${ROOT}B`]: [`${ROOT}C`, `${ROOT}E`],
        [`${ROOT}C`]: [`${ROOT}X`],
        [`${ROOT}D`]: [`${ROOT}E`],
        [`${ROOT}E`]: [`${ROOT}X`],
      };
      const run = await crawl(
        async (item) => {
          if (item.url.endsWith("/D") || item.url.endsWith("/E")) {
            await new Promise(setImmediate);
          }
          return page(links[item.url] ?? []);
        },
        { maxConcurrency: 3 },
      );

      expect(
        run.processed.map((item) => [item.url.slice(ROOT.length), item.depth]),
      ).toEqual([
        ["", 0],
        ["A", 1],
        ["B", 1],
        ["D", 1],
        ["C", 2],
        ["E", 2],
        ["X", 3],
      ]);
    });

    it("applies include patterns with exclude patterns taking precedence", async () => {
      const start = `${ROOT}docs/start`;
      const run = await crawl(
        {
          [start]: page([
            `${ROOT}docs/intro`,
            `${ROOT}docs/private/secret`,
            `${ROOT}api/reference`,
          ]),
          [`${ROOT}docs/intro`]: page(),
        },
        {
          url: start,
          scope: "hostname",
          includePatterns: ["docs/**"],
          excludePatterns: ["docs/private/**"],
        },
      );

      expect(urls(run.processed)).toEqual([start, `${ROOT}docs/intro`]);
    });
  });

  describe("progress reporting", () => {
    it("reports a stored page with the full progress event", async () => {
      const run = await crawl({ [ROOT]: page() }, { maxDepth: 1 });

      expect(run.events).toEqual([
        {
          pagesScraped: 1,
          totalPages: 1,
          totalDiscovered: 1,
          pagesIndexed: 1,
          currentUrl: ROOT,
          depth: 0,
          maxDepth: 1,
          outcome: PageOutcome.Stored,
          pageId: undefined,
          result: {
            url: ROOT,
            contentUrl: undefined,
            title: "",
            sourceContentType: "",
            contentType: "",
            textContent: "content",
            etag: null,
            lastModified: null,
            links: [],
            errors: [],
            chunks: [],
            // The first representation of this identity in the crawl, so the
            // store takes it unconditionally.
            isAdditionalRepresentation: false,
          },
        } satisfies ScraperProgressEvent,
      ]);
    });

    it("reaches its denominator, counting a page linked from two pages once", async () => {
      const run = await crawl({
        [ROOT]: page([`${ROOT}a`, `${ROOT}b`]),
        [`${ROOT}a`]: page([`${ROOT}shared`]),
        [`${ROOT}b`]: page([`${ROOT}shared`]),
        [`${ROOT}shared`]: page(),
      });

      expect(lastEvent(run.events)).toMatchObject({
        pagesScraped: 4,
        totalPages: 4,
        totalDiscovered: 4,
        pagesIndexed: 4,
      });
    });

    it.each([
      // Links past maxDepth are never queued, so they never inflate the total.
      [2, 3],
      [0, 1],
    ])("queues links no deeper than maxDepth %i", async (maxDepth, expected) => {
      const run = await crawl((item) => page([`${item.url}deeper/`]), { maxDepth });

      expect(lastEvent(run.events)).toMatchObject({
        pagesScraped: expected,
        totalPages: expected,
        totalDiscovered: expected,
        pagesIndexed: expected,
      });
    });

    it("delivers maxPages indexed pages even when items produce nothing", async () => {
      // maxPages is a request for pages, not a budget for attempts, and the
      // denominator stretches to keep the fraction whole.
      const run = await crawl(
        (item) => {
          if (item.depth === 0) return page(children(40));
          return childIndex(item) % 2 === 0 ? skipped("image/png") : page();
        },
        { maxPages: 5, maxConcurrency: 1 },
      );

      const final = lastEvent(run.events);
      expect(final?.pagesIndexed).toBe(5);
      expect(final?.pagesScraped).toBeGreaterThan(5);
      expect(final?.pagesScraped).toBe(final?.totalPages);
      expect(final?.totalDiscovered).toBeGreaterThan(final?.totalPages ?? 0);
    });

    it("clamps an initial queue larger than maxPages", async () => {
      const initialQueue = children(30).map((url, i) => stored(url, i + 1, { depth: 0 }));
      const run = await crawl(() => page(), { maxPages: 10, initialQueue });

      expect(lastEvent(run.events)).toMatchObject({
        pagesIndexed: 10,
        pagesScraped: 10,
        totalPages: 10,
      });
    });

    it("advances only the processed count for each non-content outcome", async () => {
      const run = await crawl({
        [ROOT]: page([`${ROOT}unchanged`, `${ROOT}gone`, `${ROOT}asset`]),
        [`${ROOT}unchanged`]: unchanged(),
        [`${ROOT}gone`]: notFound(),
        [`${ROOT}asset`]: skipped("image/png"),
      });

      expect(run.events.map((e) => [e.currentUrl, e.outcome, e.result])).toEqual([
        [ROOT, PageOutcome.Stored, expect.any(Object)],
        [`${ROOT}unchanged`, PageOutcome.Unchanged, null],
        [`${ROOT}gone`, PageOutcome.Absent, null],
        [`${ROOT}asset`, PageOutcome.Skipped, null],
      ]);
      expect(lastEvent(run.events)).toMatchObject({
        pagesScraped: 4,
        totalPages: 4,
        pagesIndexed: 1,
      });
    });

    it("leaves the counters short when a crawl is cancelled", async () => {
      const controller = new AbortController();
      let childrenSeen = 0;
      const run = startCrawl(
        (item) => {
          if (item.depth === 0) return page(children(10));
          // Let one child report first: the root's own event fires before its
          // links are counted, so it legitimately reads 1/1.
          childrenSeen += 1;
          if (childrenSeen > 1) controller.abort();
          return page();
        },
        { maxConcurrency: 1 },
        { signal: controller.signal },
      );

      await expect(run.done).rejects.toBeInstanceOf(CancellationError);
      const final = lastEvent(run.events);
      expect(final?.pagesScraped).toBeLessThan(final?.totalPages ?? 0);
    });
  });

  describe("empty pages", () => {
    const validators = {
      etag: '"v2"',
      lastModified: "2026-01-01T00:00:00.000Z",
    };

    it("carries the validators for a clean empty result", async () => {
      const run = await crawl({
        [ROOT]: empty({
          title: "Empty",
          sourceContentType: "text/html",
          contentType: "text/markdown",
          ...validators,
          pipelineFailed: false,
        }),
      });

      expect(lastEvent(run.events)).toMatchObject({
        outcome: PageOutcome.Empty,
        pagesIndexed: 0,
        emptyPage: { ...validators, pipelineFailed: false },
      });
    });

    it("withholds the validators when the pipeline failed", async () => {
      // A stored etag would make every later refresh answer 304 and never retry,
      // turning a transient extraction fault into permanent data loss.
      const run = await crawl({ [ROOT]: empty({ ...validators, pipelineFailed: true }) });

      expect(lastEvent(run.events)?.emptyPage).toMatchObject({
        etag: null,
        lastModified: null,
        pipelineFailed: true,
      });
    });

    it("does not record a container as an empty page", async () => {
      // A directory listing yields links and no content; it is not a page.
      const run = await crawl({ [ROOT]: empty({ isContainer: true }) });

      expect(lastEvent(run.events)).toMatchObject({ outcome: PageOutcome.Empty });
      expect(lastEvent(run.events)?.emptyPage).toBeUndefined();
    });
  });
});
