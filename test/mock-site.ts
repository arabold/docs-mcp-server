/**
 * A mock website for the crawl E2E suites, served through the global MSW server.
 *
 * Each site owns one origin and answers every request to it from a route table:
 * the path of a request selects its response, and a path with no route fails
 * the request and is recorded as unmatched. Every request is logged, so a test
 * can show which pages were fetched, in what order, and with which validator.
 *
 * Routes describe the site's current state rather than a queue of replies. A
 * page that has an ETag answers `304 Not Modified` to a request carrying that
 * ETag, the way a real server does, so a refresh against an unchanged site
 * needs no extra setup. To change the site between a scrape and a refresh,
 * redefine the routes that changed, or call `reset()` and describe the new site
 * from scratch.
 */

import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, expect, onTestFinished } from "vitest";
import { server } from "./mock-server";

/** A request the site received. */
export interface RecordedRequest {
  /** Path and query string, e.g. `/guide` or `/search?q=x`. */
  path: string;
  /** The `If-None-Match` validator the request carried, or null. */
  ifNoneMatch: string | null;
  /** Every header the request carried. */
  headers: Headers;
}

/** How a page is served. */
export interface PageOptions {
  /** The `Content-Type` header. Defaults to `text/html`. */
  type?: string;
  /** The page's ETag. A request carrying it in `If-None-Match` is answered `304`. */
  etag?: string;
}

/** Answers one request to a route. */
export type Responder = (request: Request) => Response | Promise<Response>;

/** A mock website. See the module documentation. */
export interface MockSite {
  /** The site's origin, e.g. `http://docs.example.com`. */
  readonly origin: string;
  /** Every request the site received in this test, in arrival order. */
  readonly requests: readonly RecordedRequest[];
  /** Requests for paths that had no route. Must be empty when a test ends. */
  readonly unmatched: readonly RecordedRequest[];
  /** Resolves a path against the origin. */
  url(path: string): string;
  /** Serves `body` at `path`, with `200` or `304` depending on the validator sent. */
  page(path: string, body: string | Uint8Array, options?: PageOptions): MockSite;
  /** Answers `404 Not Found` at `path`. */
  notFound(path: string): MockSite;
  /** Redirects `from` to `to` (a path on this site or an absolute URL). */
  redirect(from: string, to: string, status?: number): MockSite;
  /**
   * Accepts requests to `path` and never answers them.
   *
   * The request stays open until the test ends. A client that gives up first
   * (a fetch timeout, a cancelled job) sees its own error; the scraper's axios
   * requests do not signal that to the mock, so only `fetch` callers release
   * the request early.
   */
  stall(path: string): MockSite;
  /** Answers requests to `path` with a custom responder. */
  respond(path: string, responder: Responder): MockSite;
  /** Removes every route and clears the request log. */
  reset(): MockSite;
  /** The requests received for `path`, in arrival order. */
  requestsTo(path: string): RecordedRequest[];
  /** True when the site received at least one request for `path`. */
  wasRequested(path: string): boolean;
  /** Resolves once the site has received a request for `path`. */
  waitForRequest(path: string): Promise<RecordedRequest>;
}

/**
 * Creates a mock website at `origin` for every test in the enclosing suite.
 *
 * Call it at describe level. It registers its own hooks: before each test the
 * site starts empty and is attached to the MSW server; after each test any
 * stalled requests are released and the test fails if the site received a
 * request it had no route for. `llms.txt` answers `404` unless a test defines
 * it, which is what a site without one serves.
 *
 * @param origin The site's origin, without a trailing slash.
 * @returns The site, whose routes and request log are reset for each test.
 */
export function mockSite(origin: string): MockSite {
  const routes = new Map<string, Responder>();
  const requests: RecordedRequest[] = [];
  const unmatched: RecordedRequest[] = [];
  const waiters: Array<{ path: string; resolve: (r: RecordedRequest) => void }> = [];
  const stalled = new Set<() => void>();

  const absolute = (target: string): string =>
    target.startsWith("/") ? `${origin}${target}` : target;

  /** Logs a request and answers it from the route table. */
  const answer = async (request: Request): Promise<Response> => {
    const { pathname, search } = new URL(request.url);
    const recorded: RecordedRequest = {
      path: `${pathname}${search}`,
      ifNoneMatch: request.headers.get("if-none-match"),
      headers: request.headers,
    };
    requests.push(recorded);
    for (const waiter of waiters.filter((w) => w.path === recorded.path)) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(recorded);
    }

    const responder = routes.get(recorded.path);
    if (responder) return responder(request);
    if (pathname.endsWith("/llms.txt")) return new HttpResponse(null, { status: 404 });

    unmatched.push(recorded);
    return HttpResponse.error();
  };
  const handler = http.all(new RegExp(`^${escapeRegExp(origin)}/`), ({ request }) =>
    answer(request),
  );

  beforeEach(() => {
    routes.clear();
    requests.length = 0;
    unmatched.length = 0;
    waiters.length = 0;
    server.use(handler);
    onTestFinished(() => {
      expect(
        unmatched.map((r) => r.path),
        `${origin} received requests it has no route for`,
      ).toEqual([]);
    });
  });

  afterEach(() => {
    for (const release of stalled) release();
    stalled.clear();
  });

  const site: MockSite = {
    origin,
    requests,
    unmatched,
    url: absolute,
    page(path, body, options = {}) {
      const { type = "text/html", etag } = options;
      return site.respond(path, (request) => {
        if (etag !== undefined && request.headers.get("if-none-match") === etag) {
          return new HttpResponse(null, { status: 304, headers: { ETag: etag } });
        }
        const headers: Record<string, string> = { "Content-Type": type };
        if (etag !== undefined) headers.ETag = etag;
        return new HttpResponse(body, { status: 200, headers });
      });
    },
    notFound(path) {
      return site.respond(path, () => new HttpResponse(null, { status: 404 }));
    },
    redirect(from, to, status = 301) {
      return site.respond(
        from,
        () => new HttpResponse(null, { status, headers: { Location: absolute(to) } }),
      );
    },
    stall(path) {
      return site.respond(
        path,
        (request) =>
          new Promise<Response>((resolve) => {
            const release = () => {
              stalled.delete(release);
              resolve(HttpResponse.error());
            };
            stalled.add(release);
            request.signal.addEventListener("abort", release, { once: true });
          }),
      );
    },
    respond(path, responder) {
      routes.set(path, responder);
      return site;
    },
    reset() {
      routes.clear();
      requests.length = 0;
      unmatched.length = 0;
      return site;
    },
    requestsTo(path) {
      return requests.filter((r) => r.path === path);
    },
    wasRequested(path) {
      return requests.some((r) => r.path === path);
    },
    waitForRequest(path) {
      const seen = requests.find((r) => r.path === path);
      if (seen) return Promise.resolve(seen);
      return new Promise((resolve) => waiters.push({ path, resolve }));
    },
  };
  return site;
}

/**
 * Builds an HTML page linking to each of `links`, so a crawl fans out
 * predictably from it.
 *
 * @param links Hrefs to link to, in document order.
 * @param title The page heading.
 * @returns The HTML document.
 */
export function hubPage(links: string[], title = "Hub"): string {
  const anchors = links.map((href) => `<a href="${href}">${href}</a>`).join("");
  return `<html><body><h1>${title}</h1>${anchors}</body></html>`;
}

/**
 * Builds an HTML page with a heading and one paragraph.
 *
 * @param title The page heading.
 * @param body The paragraph text. Defaults to a phrase naming the page.
 * @returns The HTML document.
 */
export function leafPage(title: string, body = `Body text for ${title}.`): string {
  return `<html><body><h1>${title}</h1><p>${body}</p></body></html>`;
}

/**
 * Valid HTML that yields no extractable text: empty, but not broken.
 *
 * A `<title>` would not change that: the title is kept as the page's metadata,
 * not as its text.
 *
 * @returns The HTML document.
 */
export function emptyPage(): string {
  return "<html><body></body></html>";
}

/**
 * Builds an `llms.txt` index listing each of `urls`.
 *
 * @param urls Absolute URLs to list.
 * @returns The index in llms.txt format.
 */
export function llmsTxt(urls: string[]): string {
  const entries = urls.map((url, i) => `- [Entry ${i + 1}](${url})`).join("\n");
  return `# Docs\n\n${entries}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
