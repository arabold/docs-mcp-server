import { describe, expect, it, vi } from "vitest";
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
type Responder = (
  item: QueueItem,
  signal?: AbortSignal,
) => Reply | Error | Promise<Reply | Error>;
/** A site as a URL-keyed map, or as a function of the queued item. */
type Site = Record<string, Reply | Error> | Responder;

interface CrawlSetup {
  abortOnFailureRate?: number;
  signal?: AbortSignal;
  /** Stands in for a strategy's own URL canonicalization. */
  canonicalize?: (url: string) => string;
  /** Runs after each progress event is recorded, the way a job stores the page. */
  report?: (event: ScraperProgressEvent) => Promise<void>;
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

  protected override canonicalizeStoredUrl(url: string, options: ScraperOptions): string {
    return this.canonicalize
      ? this.canonicalize(url)
      : super.canonicalizeStoredUrl(url, options);
  }

  protected override async processItem(
    item: QueueItem,
    _options: ScraperOptions,
    signal?: AbortSignal,
  ): Promise<ProcessItemResult> {
    this.processed.push(item);
    const reply = await this.respond(item, signal);
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
      await setup.report?.(event);
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
    it("fails the job when the start URL fails, even with ignoreErrors", async () => {
      const cases: Array<{ label: string; reply: Reply | Error; message: string }> = [
        {
          label: "throws",
          reply: new Error("Root URL failed"),
          message: "Root URL failed",
        },
        { label: "is not found", reply: notFound(), message: "Root page not found" },
        {
          label: "is unprocessable",
          reply: skipped("application/zip"),
          message: "Cannot process application/zip",
        },
        // Reported without a type, the failure must still read legibly rather than
        // interpolating "undefined".
        {
          label: "is unprocessable without a type",
          reply: skipped(),
          message: "unknown content type",
        },
      ];

      for (const { label, reply, message } of cases) {
        const run = startCrawl({ [ROOT]: reply }, { ignoreErrors: true });

        await expect.soft(run.done, label).rejects.toThrow(message);
        expect.soft(run.events, label).toEqual([]);
      }
    });

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
    it("fails the job with the child's error when ignoreErrors is off", async () => {
      const run = startCrawl({
        [ROOT]: page([`${ROOT}broken`]),
        [`${ROOT}broken`]: new Error("Child page error"),
      });

      await expect(run.done).rejects.toThrow("Child page error");
      expect(storedUrls(run.events)).toEqual([ROOT]);
    });

    it("stops and waits for running items before a failed crawl rejects", async () => {
      // The caller cleans up (closes the browser, deletes temp files) as soon as
      // the crawl rejects, so no item may still be running at that point.
      let slowItemSettled = false;
      const run = startCrawl(
        async (item, signal) => {
          if (item.depth === 0) return page([`${ROOT}fails`, `${ROOT}slow`]);
          if (item.url === `${ROOT}fails`) return new Error("Child failed");
          // Still loading when its sibling fails; it ends only once aborted.
          await new Promise<void>((resolve) => {
            signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          slowItemSettled = true;
          return new Error("Slow item aborted");
        },
        { maxPages: 5, maxDepth: 1, ignoreErrors: false },
      );

      await expect(run.done).rejects.toThrow("Child failed");
      expect(slowItemSettled).toBe(true);
    });
  });

  describe("failure-rate threshold", () => {
    /** A root linking `total` children, the first `failures` of which throw. */
    const siteWithFailures =
      (total: number, failures: number): Responder =>
      (item) => {
        if (item.depth === 0) return page(children(total));
        return childIndex(item) < failures ? new Error("child failed") : page();
      };

    it("aborts the crawl when 6 of 10 children throw", async () => {
      const run = startCrawl(
        siteWithFailures(10, 6),
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
        siteWithFailures(total, failures),
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

    it("does not report an item that finishes after the threshold trips", async () => {
      // Ten children fail at once; an eleventh running alongside them succeeds
      // only once the tripped threshold stops it, and must not be reported as
      // stored. The crawl waits for it before rejecting.
      const run = startCrawl(
        async (item, signal) => {
          if (item.depth === 0) return page(children(11));
          if (childIndex(item) < 10) return new Error("child failed");
          await new Promise<void>((resolve) => {
            signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          return page();
        },
        { ignoreErrors: true, maxConcurrency: 11 },
        { abortOnFailureRate: 0.5 },
      );

      await expect(run.done).rejects.toThrow(/Scrape aborted after 10\/10/);

      expect(run.processed.map((item) => item.url)).toContain(`${ROOT}p10`);
      expect(eventFor(run.events, `${ROOT}p10`)).toBeUndefined();
    });

    // Currently counted: a refresh of a site that withdrew its Markdown files aborts.
    it.todo("does not count a missing representation with a page to fall back to");
  });

  describe("concurrent processing", () => {
    const at = (path: string) => `${ROOT}${path}`;

    /** A promise the test resolves by hand, to hold one item mid-flight. */
    const gate = () => {
      let open = (): void => {};
      const closed = new Promise<void>((resolve) => {
        open = resolve;
      });
      return { closed, open };
    };

    it("keeps the other slots working while one item is slow", async () => {
      // A URL stuck in retry backoff used to hold its whole batch, so the crawl
      // looked frozen on whichever page had finished last (#490).
      const slow = gate();
      const others = ["a", "b", "c", "d"].map(at);
      const run = startCrawl(
        async (item) => {
          if (item.depth === 0) return page([at("slow"), ...others]);
          if (item.url === at("slow")) await slow.closed;
          return page();
        },
        { maxConcurrency: 3 },
      );

      await vi.waitFor(() =>
        expect(run.events.map((e) => e.currentUrl)).toEqual(
          expect.arrayContaining(others),
        ),
      );
      expect(eventFor(run.events, at("slow"))).toBeUndefined();
      slow.open();
      await run.done;

      expect(run.events.at(-1)).toMatchObject({
        pagesScraped: 6,
        totalPages: 6,
        pagesIndexed: 6,
      });
    });

    it("offers each URL at its shortest depth when items finish out of order", async () => {
      // A links straight to X; B reaches X only through C. B finishing first must
      // not let C claim X one level deeper than A offers it.
      const a = gate();
      const links: Record<string, string[]> = {
        [ROOT]: [at("A"), at("B")],
        [at("A")]: [at("X")],
        [at("B")]: [at("C")],
        [at("C")]: [at("X")],
      };
      const run = startCrawl(
        async (item) => {
          if (item.url === at("A")) await a.closed;
          return page(links[item.url] ?? []);
        },
        { maxConcurrency: 3 },
      );

      await vi.waitFor(() => expect(eventFor(run.events, at("B"))).toBeDefined());
      a.open();
      await run.done;

      expect(run.processed.map((item) => item.url)).toEqual([
        ROOT,
        at("A"),
        at("B"),
        at("X"),
        at("C"),
      ]);
      expect(run.processed.find((item) => item.url === at("X"))?.depth).toBe(2);
    });

    it("does not finish while a page at the limit is still being stored", async () => {
      // Reaching maxPages stops new items from starting, but a running item may
      // have counted its page and still be storing it. The crawl must not resolve
      // before that write settles, or the job completes with a write pending.
      const store = gate();
      const run = startCrawl(
        (item) => page(item.depth === 0 ? [at("a"), at("b")] : []),
        { maxPages: 3, maxConcurrency: 3 },
        {
          report: async (event) => {
            if (event.currentUrl === at("a")) await store.closed;
          },
        },
      );
      let settled = false;
      const watched = run.done.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      await vi.waitFor(() => expect(eventFor(run.events, at("b"))).toBeDefined());
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(settled).toBe(false);
      store.open();
      await watched;
      await run.done;
      expect(run.events.at(-1)).toMatchObject({ pagesIndexed: 3 });
    });

    it("refills a freed slot without indexing past maxPages", async () => {
      // A slot freed by an item that stored nothing may be refilled, but only
      // while the running items could not already reach the limit between them.
      // More slots than the budget leaves, so the limit itself has to hold.
      const run = await crawl(
        async (item) => {
          if (item.depth === 0) return page(["skip", "p1", "p2", "p3", "p4"].map(at));
          if (item.url === at("skip")) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return skipped();
          }
          return page();
        },
        { maxPages: 3, maxConcurrency: 4 },
      );

      expect(Math.max(...run.events.map((e) => e.pagesIndexed ?? 0))).toBe(3);
      expect(run.processed).toHaveLength(4);
      expect(run.events.at(-1)).toMatchObject({
        pagesScraped: 4,
        totalPages: 4,
        pagesIndexed: 3,
      });
    });
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

    it("hands stored items to processItem as stored and reports their pageId and stored depth", async () => {
      // The start URL is among the stored items, so it is not queued a second time.
      const initialQueue = [
        stored(ROOT, 100, { depth: 0, etag: '"root-etag"' }),
        stored(`${ROOT}page1`, 101, { etag: '"page1-etag"' }),
        stored(`${ROOT}deep`, 102, { depth: 2 }),
      ];
      const run = await crawl(() => page(), { initialQueue });

      expect(run.processed).toEqual(initialQueue);
      expect(eventFor(run.events, `${ROOT}page1`)).toMatchObject({
        pageId: 101,
        depth: 1,
      });
      expect(eventFor(run.events, `${ROOT}deep`)).toMatchObject({
        pageId: 102,
        depth: 2,
      });
    });
  });

  describe("page identity", () => {
    it("does not queue a page already stored under another spelling", async () => {
      const run = await crawl({
        [ROOT]: page([`${ROOT}guide.md`]),
        [`${ROOT}guide.md`]: page([`${ROOT}guide`], { url: `${ROOT}guide` }),
      });

      expect(urls(run.processed)).toEqual([ROOT, `${ROOT}guide.md`]);
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

    it("visits pages breadth-first, each at its shallowest depth", async () => {
      // / -> A, B, D;  A -> B;  B -> C, E;  C -> X;  D -> E;  E -> X.
      const links: Record<string, string[]> = {
        [ROOT]: [`${ROOT}A`, `${ROOT}B`, `${ROOT}D`],
        [`${ROOT}A`]: [`${ROOT}B`],
        [`${ROOT}B`]: [`${ROOT}C`, `${ROOT}E`],
        [`${ROOT}C`]: [`${ROOT}X`],
        [`${ROOT}D`]: [`${ROOT}E`],
        [`${ROOT}E`]: [`${ROOT}X`],
      };
      const run = await crawl((item) => page(links[item.url] ?? []), {
        maxConcurrency: 3,
      });

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

    it("follows file links only inside the roots an archive declares, carrying them on", async () => {
      // A web archive unpacks into file:// members. Those cross the protocol
      // scope as continuations of the accepted scrape, but a link the archive
      // content points outside its own root must stay out of the queue.
      const archive = "https://example.com/docs.zip";
      const roots = ["/tmp/scraper-docs.zip"];
      const member = "file:///tmp/scraper-docs.zip/guide.md";
      const nested = "file:///tmp/scraper-docs.zip/api.md";
      const run = await crawl(
        {
          [archive]: empty({
            links: ["file:///etc/passwd", member],
            internalAllowedFileRoots: roots,
            isContainer: true,
          }),
          [member]: page([nested, "file:///etc/hosts"]),
          [nested]: page(),
        },
        { url: archive },
      );

      expect(run.processed.slice(1)).toEqual([
        { url: member, depth: 1, internalAllowedFileRoots: roots },
        { url: nested, depth: 2, internalAllowedFileRoots: roots },
      ]);
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

    it("queues links no deeper than maxDepth", async () => {
      // Links past maxDepth are never queued, so they never inflate the total.
      const cases = [
        { maxDepth: 2, expected: 3 },
        { maxDepth: 0, expected: 1 },
      ];

      for (const { maxDepth, expected } of cases) {
        const run = await crawl((item) => page([`${item.url}deeper/`]), { maxDepth });

        expect.soft(lastEvent(run.events), `maxDepth ${maxDepth}`).toMatchObject({
          pagesScraped: expected,
          totalPages: expected,
          totalDiscovered: expected,
          pagesIndexed: expected,
        });
      }
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
  });
});
