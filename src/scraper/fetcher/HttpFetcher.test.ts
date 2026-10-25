import { readFileSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import { Readable } from "node:stream";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CancellationError } from "../../pipeline/errors";
import { type AppConfig, DEFAULT_CONFIG } from "../../utils/config";
import {
  AccessPolicyError,
  ChallengeError,
  HttpStatusError,
  RedirectError,
  ScraperError,
  TlsCertificateError,
} from "../../utils/errors";
import { FingerprintGenerator } from "./FingerprintGenerator";
import { HttpFetcher } from "./HttpFetcher";
import { MARKDOWN_PREFERRED_ACCEPT } from "./headers";
import { FetchStatus } from "./types";

vi.mock("axios");

const mockedAxios = vi.mocked(axios, true);

const PAGE_URL = "https://example.com/page";

/** The page Fastly serves in place of the document (pypi.org, trimmed). */
const FASTLY_CHALLENGE_PAGE = readFileSync(
  path.join(__dirname, "../../../test/fixtures/fastly-client-challenge.html"),
  "utf-8",
);

/**
 * Builds a scraper config whose access policy lists the test host, so the
 * policy accepts it without a DNS lookup and the suite runs offline. IP
 * literals are still checked against the special-use ranges.
 */
function scraperConfig(
  network: Partial<AppConfig["scraper"]["security"]["network"]> = {},
): AppConfig["scraper"] {
  return {
    ...DEFAULT_CONFIG.scraper,
    security: {
      ...DEFAULT_CONFIG.scraper.security,
      network: {
        ...DEFAULT_CONFIG.scraper.security.network,
        allowedHosts: ["example.com"],
        ...network,
      },
    },
  };
}

const fetcher = new HttpFetcher(scraperConfig());

/** A resolved 2xx response carrying a streamed body. */
function ok(
  body: string | Buffer | Readable = "ok",
  headers: Record<string, string> = { "content-type": "text/plain" },
) {
  return {
    status: 200,
    headers,
    data: body instanceof Readable ? body : Readable.from([Buffer.from(body)]),
  };
}

/** A resolved 3xx response, which axios returns because validateStatus accepts it. */
function redirect(location: string | undefined, status = 301) {
  return {
    status,
    headers: location === undefined ? {} : { location },
    data: Readable.from(["redirect body"]),
  };
}

/** The rejection axios produces for a 4xx/5xx response. */
function httpError(status: number, headers: Record<string, string> = {}, body = "") {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, headers, data: Readable.from([body]) },
  });
}

/** The rejection axios produces for a transport failure with no response. */
function networkError(code: string) {
  return Object.assign(new Error(`connect ${code}`), { isAxiosError: true, code });
}

/** A Readable that records whether any of its body was read. */
function trackedStream(body: string) {
  let read = false;
  const stream = new Readable({
    read() {
      read = true;
      this.push(body);
      this.push(null);
    },
  });
  return { stream, wasRead: () => read };
}

/** The request config passed to the nth axios call. */
function requestConfig(call = 0) {
  return mockedAxios.get.mock.calls[call]?.[1];
}

describe("HttpFetcher", () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
  });

  it("fetches only http and https URLs", () => {
    const cases: Array<[source: string, expected: boolean]> = [
      ["http://example.com", true],
      ["https://example.com", true],
      ["ftp://example.com", false],
      ["file:///path/to/file", false],
      ["mailto:test@example.com", false],
      ["relative/path", false],
    ];

    for (const [source, expected] of cases) {
      expect.soft(fetcher.canFetch(source), source).toBe(expected);
    }
  });

  describe("successful responses", () => {
    it("reads a single-chunk, multi-chunk or lazily produced body in full", async () => {
      const cases: Array<{ label: string; body: () => Readable; expected: string }> = [
        {
          label: "a single-chunk body",
          body: () => Readable.from([Buffer.from("Hello World")]),
          expected: "Hello World",
        },
        {
          label: "a multi-chunk body",
          body: () => Readable.from([Buffer.from('{"a":'), Buffer.from("1}")]),
          expected: '{"a":1}',
        },
        {
          label: "a lazily produced body",
          body: () => trackedStream("<html>hello</html>").stream,
          expected: "<html>hello</html>",
        },
      ];

      for (const { label, body, expected } of cases) {
        mockedAxios.get.mockResolvedValue(ok(body()));

        const result = await fetcher.fetch(PAGE_URL);

        expect.soft(result.status, label).toBe(FetchStatus.SUCCESS);
        expect.soft(result.content.toString(), label).toBe(expected);
        expect.soft(result.source, label).toBe(PAGE_URL);
      }
    });

    it("returns binary bodies byte for byte", async () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      mockedAxios.get.mockResolvedValue(ok(png, { "content-type": "image/png" }));

      const result = await fetcher.fetch(PAGE_URL);

      expect(result.content).toEqual(png);
      expect(result.mimeType).toBe("image/png");
    });

    it("reads the MIME type, charset and encoding from Content-Type and Content-Encoding", async () => {
      const cases: Array<{
        contentType?: string;
        contentEncoding?: string;
        expected: { mimeType: string; charset?: string; encoding?: string };
      }> = [
        {
          contentType: "text/html; charset=utf-8",
          expected: { mimeType: "text/html", charset: "utf-8" },
        },
        {
          contentType: "text/plain; charset=iso-8859-1",
          expected: { mimeType: "text/plain", charset: "iso-8859-1" },
        },
        { contentType: "text/plain", expected: { mimeType: "text/plain" } },
        {
          contentType: "text/plain; charset=utf-8",
          contentEncoding: "gzip",
          expected: { mimeType: "text/plain", charset: "utf-8", encoding: "gzip" },
        },
        { expected: { mimeType: "application/octet-stream" } },
      ];

      for (const { contentType, contentEncoding, expected } of cases) {
        const headers: Record<string, string> = {};
        if (contentType) headers["content-type"] = contentType;
        if (contentEncoding) headers["content-encoding"] = contentEncoding;
        mockedAxios.get.mockResolvedValue(ok("abc", headers));

        const { mimeType, charset, encoding } = await fetcher.fetch(PAGE_URL);

        expect
          .soft({ mimeType, charset, encoding }, `${contentType} / ${contentEncoding}`)
          .toEqual({ charset: undefined, encoding: undefined, ...expected });
      }
    });

    it("reports ETag and Last-Modified as etag and lastModified", async () => {
      const cases: Array<{
        label: string;
        headers: Record<string, string>;
        etag?: string;
        lastModified?: string;
      }> = [
        { label: "ETag", headers: { etag: '"v1"' }, etag: '"v1"' },
        { label: "no caching headers", headers: {} },
        {
          label: "Last-Modified",
          headers: { "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT" },
          lastModified: "2015-10-21T07:28:00.000Z",
        },
      ];

      for (const { label, headers, etag, lastModified } of cases) {
        mockedAxios.get.mockResolvedValue(
          ok("content", { "content-type": "text/plain", ...headers }),
        );

        const result = await fetcher.fetch(PAGE_URL);

        expect.soft(result.etag, label).toBe(etag);
        expect.soft(result.lastModified, label).toBe(lastModified);
      }
    });

    it("reports the URL the response was served from as the source", async () => {
      const finalUrl = "https://example.com/docs/?view=4.0";
      mockedAxios.get.mockResolvedValue({
        ...ok("<html>OK</html>", { "content-type": "text/html" }),
        request: { res: { responseUrl: finalUrl } },
      });

      const result = await fetcher.fetch("https://example.com/docs");

      expect(result.source).toBe(finalUrl);
    });
  });

  describe("request", () => {
    it("sends a streamed request with browser headers, a Markdown-preferred Accept and the default timeout", async () => {
      mockedAxios.get.mockResolvedValue(ok());

      await fetcher.fetch(PAGE_URL);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        PAGE_URL,
        expect.objectContaining({
          responseType: "stream",
          headers: expect.objectContaining({
            "user-agent": expect.any(String),
            "accept-language": expect.any(String),
            Accept: MARKDOWN_PREFERRED_ACCEPT,
            // zstd is left out because axios does not decompress it.
            "Accept-Encoding": "gzip, deflate, br",
          }),
          // axios has no timeout of its own, so a stalled server would hold the
          // worker indefinitely without this default.
          timeout: DEFAULT_CONFIG.scraper.fetcher.timeoutMs,
          // Redirects are followed by HttpFetcher so each hop passes the access policy.
          maxRedirects: 0,
          decompress: true,
        }),
      );
    });

    it("uses the caller's timeout and signal", async () => {
      mockedAxios.get.mockResolvedValue(ok());
      const controller = new AbortController();

      await fetcher.fetch(PAGE_URL, { timeout: 5000, signal: controller.signal });

      expect(requestConfig()).toMatchObject({ timeout: 5000, signal: controller.signal });
    });

    it("sends caller headers and keeps a caller Accept header", async () => {
      mockedAxios.get.mockResolvedValue(ok());

      await fetcher.fetch(PAGE_URL, {
        headers: { "X-Custom-Header": "value", accept: "application/json" },
      });

      const headers = requestConfig()?.headers;
      expect(headers).toMatchObject({
        "X-Custom-Header": "value",
        accept: "application/json",
      });
      expect(headers).not.toHaveProperty("Accept");
    });

    it("leaves the fingerprint's connection-level headers to Node's HTTP client", async () => {
      // A few generated fingerprints carry `Connection: keep-alive`. MSW never
      // ends a mocked response without Content-Length on a kept-alive
      // connection, so the crawl suites hung on the rare request that sent it.
      const generateHeaders = vi
        .spyOn(FingerprintGenerator.prototype, "generateHeaders")
        .mockReturnValue({
          "user-agent": "Fingerprint/1.0",
          Connection: "keep-alive",
          te: "trailers",
        });
      try {
        mockedAxios.get.mockResolvedValue(ok());

        await fetcher.fetch(PAGE_URL);

        const headers = requestConfig()?.headers;
        expect(headers).toMatchObject({ "user-agent": "Fingerprint/1.0" });
        expect(headers).not.toHaveProperty("Connection");
        expect(headers).not.toHaveProperty("te");
      } finally {
        generateHeaders.mockRestore();
      }
    });

    it("skips certificate verification only for https with allowInvalidTls", async () => {
      const cases = [
        { allowInvalidTls: true, url: "https://example.com/", skipsVerification: true },
        { allowInvalidTls: true, url: "http://example.com/", skipsVerification: false },
        { allowInvalidTls: false, url: "https://example.com/", skipsVerification: false },
      ];

      for (const { allowInvalidTls, url, skipsVerification } of cases) {
        const label = `allowInvalidTls=${allowInvalidTls} on ${url}`;
        mockedAxios.get.mockReset();
        mockedAxios.get.mockResolvedValue(ok());

        await new HttpFetcher(scraperConfig({ allowInvalidTls })).fetch(url);

        const agent = requestConfig()?.httpsAgent;
        if (skipsVerification) {
          expect.soft(agent, label).toBeInstanceOf(https.Agent);
          expect.soft(agent?.options.rejectUnauthorized, label).toBe(false);
        } else {
          expect.soft(agent, label).toBeUndefined();
        }
      }
    });
  });

  describe("304 Not Modified", () => {
    it("returns NOT_MODIFIED without retrying, gating or reading the body", async () => {
      const body = Readable.from(["unused"]);
      mockedAxios.get.mockResolvedValue({
        status: 304,
        headers: { etag: '"v1"' },
        data: body,
      });
      const acceptsMimeType = vi.fn().mockReturnValue(false);

      const result = await fetcher.fetch(PAGE_URL, { etag: '"v1"', acceptsMimeType });

      expect(result.status).toBe(FetchStatus.NOT_MODIFIED);
      // The 304's own headers are not read, so the caller keeps its stored etag.
      expect(result.etag).toBeUndefined();
      expect(result.content).toEqual(Buffer.from(""));
      expect(acceptsMimeType).not.toHaveBeenCalled();
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      // An unread body pins its socket, so it is torn down.
      expect(body.destroyed).toBe(true);
    });
  });

  describe("redirects", () => {
    it("follows a relative Location and destroys the body of the redirect hop", async () => {
      const hop = redirect("/final", 302);
      mockedAxios.get
        .mockResolvedValueOnce(hop)
        .mockResolvedValueOnce(ok("<html>done</html>", { "content-type": "text/html" }));

      const result = await fetcher.fetch("https://example.com/start");

      expect(result.status).toBe(FetchStatus.SUCCESS);
      expect(result.source).toBe("https://example.com/final");
      expect(result.content.toString()).toBe("<html>done</html>");
      expect(mockedAxios.get).toHaveBeenNthCalledWith(
        2,
        "https://example.com/final",
        expect.anything(),
      );
      expect(hop.data.destroyed).toBe(true);
    });

    it("rejects with RedirectError instead of following when followRedirects is false", async () => {
      mockedAxios.get.mockResolvedValue(redirect("https://new.example.com/", 308));

      const error = await fetcher
        .fetch(PAGE_URL, { followRedirects: false })
        .catch((e) => e);

      expect(error).toBeInstanceOf(RedirectError);
      expect(error).toMatchObject({
        originalUrl: PAGE_URL,
        redirectUrl: "https://new.example.com/",
        statusCode: 308,
      });
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it("rejects a redirect without a Location header and does not retry", async () => {
      mockedAxios.get.mockResolvedValue(redirect(undefined));

      await expect(fetcher.fetch(PAGE_URL, { retryDelay: 1 })).rejects.toThrow(
        /did not include a location header/,
      );
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it("rejects after five hops and does not retry", async () => {
      mockedAxios.get.mockImplementation(async () => redirect("/again"));

      await expect(fetcher.fetch(PAGE_URL, { retryDelay: 1 })).rejects.toThrow(
        /Too many redirects/,
      );
      // The original request plus five followed hops.
      expect(mockedAxios.get).toHaveBeenCalledTimes(6);
    });

    it("blocks a hop to an address the access policy denies before requesting it", async () => {
      mockedAxios.get.mockResolvedValue(
        redirect("http://169.254.169.254/latest/meta-data"),
      );

      await expect(fetcher.fetch(PAGE_URL)).rejects.toBeInstanceOf(AccessPolicyError);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it("rejects a response whose final URL the access policy denies", async () => {
      mockedAxios.get.mockResolvedValue({
        ...ok(),
        request: { res: { responseUrl: "http://127.0.0.1/admin" } },
      });

      await expect(fetcher.fetch(PAGE_URL)).rejects.toBeInstanceOf(AccessPolicyError);
    });
  });

  describe("unprocessable-content gate", () => {
    it("abandons an unprocessable response without reading or retrying it", async () => {
      const { stream, wasRead } = trackedStream("PNGDATA".repeat(1000));
      mockedAxios.get.mockResolvedValue(ok(stream, { "content-type": "image/png" }));

      const result = await fetcher.fetch(PAGE_URL, {
        acceptsMimeType: (mimeType) => mimeType !== "image/png",
      });

      expect(result).toMatchObject({
        status: FetchStatus.SKIPPED,
        mimeType: "image/png",
      });
      expect(result.content.toString()).toBe("");
      expect(wasRead()).toBe(false);
      expect(stream.destroyed).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it("gates a missing Content-Type as application/octet-stream", async () => {
      mockedAxios.get.mockResolvedValue(ok("body", {}));

      const result = await fetcher.fetch(PAGE_URL, {
        acceptsMimeType: (mimeType) => mimeType !== "application/octet-stream",
      });

      expect(result).toMatchObject({
        status: FetchStatus.SKIPPED,
        mimeType: "application/octet-stream",
      });
    });

    it("reads every response when no predicate is supplied", async () => {
      mockedAxios.get.mockResolvedValue(ok("PNGDATA", { "content-type": "image/png" }));

      const result = await fetcher.fetch(PAGE_URL);

      expect(result.status).toBe(FetchStatus.SUCCESS);
      expect(result.content.toString()).toBe("PNGDATA");
    });

    it("gates the final hop of a redirect chain", async () => {
      const { stream, wasRead } = trackedStream("PNGDATA");
      mockedAxios.get
        .mockResolvedValueOnce(redirect("https://example.com/final.png"))
        .mockResolvedValueOnce(ok(stream, { "content-type": "image/png" }));

      const result = await fetcher.fetch("https://example.com/start", {
        acceptsMimeType: (mimeType) => mimeType !== "image/png",
      });

      expect(result).toMatchObject({
        status: FetchStatus.SKIPPED,
        source: "https://example.com/final.png",
      });
      expect(wasRead()).toBe(false);
    });
  });

  describe("errors and retries", () => {
    it("returns NOT_FOUND for a 404 without retrying or consulting the gate", async () => {
      mockedAxios.get.mockRejectedValue(httpError(404));
      const acceptsMimeType = vi.fn().mockReturnValue(false);

      const result = await fetcher.fetch(PAGE_URL, { retryDelay: 1, acceptsMimeType });

      expect(result).toMatchObject({ status: FetchStatus.NOT_FOUND, source: PAGE_URL });
      expect(acceptsMimeType).not.toHaveBeenCalled();
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it("retries a timeout, rate limit or server error status", async () => {
      for (const status of [408, 429, 500, 502, 503, 504, 525]) {
        mockedAxios.get.mockReset();
        mockedAxios.get
          .mockRejectedValueOnce(httpError(status))
          .mockResolvedValueOnce(ok("success"));

        const result = await fetcher.fetch(PAGE_URL, { maxRetries: 1, retryDelay: 1 });

        expect.soft(result.content.toString(), `${status}`).toBe("success");
        expect.soft(mockedAxios.get, `${status}`).toHaveBeenCalledTimes(2);
      }
    });

    it("fails any other error status with HttpStatusError without retrying", async () => {
      for (const status of [400, 401, 403, 405, 410]) {
        mockedAxios.get.mockReset();
        mockedAxios.get.mockRejectedValue(httpError(status));

        const error = await fetcher
          .fetch(PAGE_URL, { maxRetries: 2, retryDelay: 1 })
          .catch((e) => e);

        expect.soft(error, `${status}`).toBeInstanceOf(HttpStatusError);
        expect.soft(error.statusCode, `${status}`).toBe(status);
        expect.soft(mockedAxios.get, `${status}`).toHaveBeenCalledTimes(1);
      }
    });

    it("retries a network error that has no status", async () => {
      mockedAxios.get
        .mockRejectedValueOnce(networkError("ECONNRESET"))
        .mockResolvedValueOnce(ok("success"));

      const result = await fetcher.fetch(PAGE_URL, { maxRetries: 1, retryDelay: 1 });

      expect(result.content.toString()).toBe("success");
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it("fails ENOTFOUND or ECONNREFUSED with ScraperError without retrying", async () => {
      for (const code of ["ENOTFOUND", "ECONNREFUSED"]) {
        mockedAxios.get.mockReset();
        mockedAxios.get.mockRejectedValue(networkError(code));

        const error = await fetcher
          .fetch(PAGE_URL, { maxRetries: 2, retryDelay: 1 })
          .catch((e) => e);

        expect.soft(error, code).toBeInstanceOf(ScraperError);
        expect.soft(error, code).not.toBeInstanceOf(HttpStatusError);
        expect.soft(mockedAxios.get, code).toHaveBeenCalledTimes(1);
      }
    });

    it("gives up after the configured or the explicit number of retries", async () => {
      const cases = [
        {
          label: "the configured default",
          maxRetries: undefined,
          expectedRetries: DEFAULT_CONFIG.scraper.fetcher.maxRetries,
        },
        { label: "an explicit maxRetries", maxRetries: 2, expectedRetries: 2 },
      ];

      for (const { label, maxRetries, expectedRetries } of cases) {
        mockedAxios.get.mockReset();
        mockedAxios.get.mockRejectedValue(httpError(500));

        const error = await fetcher
          .fetch(PAGE_URL, { maxRetries, retryDelay: 1 })
          .catch((e) => e);

        expect.soft(error, label).toBeInstanceOf(HttpStatusError);
        expect.soft(error.statusCode, label).toBe(500);
        expect.soft(mockedAxios.get, label).toHaveBeenCalledTimes(expectedRetries + 1);
      }
    });

    it("fails a TLS certificate error with TlsCertificateError without retrying", async () => {
      mockedAxios.get.mockRejectedValue(networkError("UNABLE_TO_VERIFY_LEAF_SIGNATURE"));

      await expect(
        fetcher.fetch(PAGE_URL, { maxRetries: 2, retryDelay: 1 }),
      ).rejects.toBeInstanceOf(TlsCertificateError);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });
  });

  describe("Cloudflare challenge detection", () => {
    it("fails a 403 carrying a challenge marker as a ChallengeError without retrying", async () => {
      const cases: Array<{
        label: string;
        headers: Record<string, string>;
        body: string;
      }> = [
        {
          label: "a cf-mitigated header",
          headers: { "cf-mitigated": "challenge" },
          body: "",
        },
        {
          label: "a cloudflare server header",
          headers: { server: "cloudflare" },
          body: "",
        },
        {
          label: "the Enable JavaScript marker",
          headers: {},
          body: "<p>Enable JavaScript and cookies to continue</p>",
        },
        // The body is a stream and has to be drained before these markers can match.
        {
          label: "the Just a moment marker",
          headers: {},
          body: "<html><body>Just a moment...</body></html>",
        },
        {
          label: "the cf_chl_opt marker",
          headers: {},
          body: "<script>window._cf_chl_opt={};</script>",
        },
      ];

      for (const { label, headers, body } of cases) {
        mockedAxios.get.mockReset();
        mockedAxios.get.mockRejectedValue(httpError(403, headers, body));

        await expect
          .soft(fetcher.fetch(PAGE_URL, { maxRetries: 2, retryDelay: 1 }), label)
          .rejects.toBeInstanceOf(ChallengeError);
        expect.soft(mockedAxios.get, label).toHaveBeenCalledTimes(1);
      }
    });

    it("fails a 429 carrying a challenge marker as a ChallengeError without retrying", async () => {
      // The response docs.godotengine.org sent once Cloudflare rate limited the crawl.
      const cases: Array<{
        label: string;
        headers: Record<string, string>;
        body: string;
      }> = [
        {
          label: "a cf-mitigated header",
          headers: { "cf-mitigated": "challenge", server: "cloudflare" },
          body: "",
        },
        {
          label: "the Just a moment marker",
          headers: {},
          body: "<html><head><title>Just a moment...</title></head></html>",
        },
      ];

      for (const { label, headers, body } of cases) {
        mockedAxios.get.mockReset();
        mockedAxios.get.mockRejectedValue(httpError(429, headers, body));

        const error = await new HttpFetcher(scraperConfig())
          .fetch(PAGE_URL, { maxRetries: 2, retryDelay: 1 })
          .catch((e) => e);

        expect.soft(error, label).toBeInstanceOf(ChallengeError);
        expect.soft(error.statusCode, label).toBe(429);
        expect.soft(mockedAxios.get, label).toHaveBeenCalledTimes(1);
      }
    });

    it("retries a 429 whose only Cloudflare marker is the server header", async () => {
      // A plain rate limit on a Cloudflare-fronted site, not a challenge.
      mockedAxios.get
        .mockRejectedValueOnce(
          httpError(429, { server: "cloudflare" }, "Too many requests"),
        )
        .mockResolvedValueOnce(ok("success"));

      const result = await new HttpFetcher(scraperConfig()).fetch(PAGE_URL, {
        maxRetries: 1,
        retryDelay: 1,
      });

      expect(result.content.toString()).toBe("success");
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it("fails an ordinary 403 as an HttpStatusError", async () => {
      mockedAxios.get.mockRejectedValue(
        httpError(403, { server: "nginx" }, "<html><body>Access denied</body></html>"),
      );

      const error = await fetcher.fetch(PAGE_URL).catch((e) => e);

      expect(error).toBeInstanceOf(HttpStatusError);
      expect(error).not.toBeInstanceOf(ChallengeError);
      expect(error.statusCode).toBe(403);
    });
  });

  describe("throttling", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      // On a whole second, so an HTTP-date names the delay exactly.
      vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** The URLs axios was asked for, in order. */
    function requestedUrls() {
      return mockedAxios.get.mock.calls.map(([url]) => url);
    }

    it("waits for the Retry-After delay before retrying a 429 or 503", async () => {
      const cases = [
        { label: "a 429 with delta-seconds", status: 429, retryAfter: () => "7" },
        { label: "a 503 with delta-seconds", status: 503, retryAfter: () => "7" },
        {
          label: "a 429 with an HTTP-date",
          status: 429,
          retryAfter: () => new Date(Date.now() + 7_000).toUTCString(),
        },
      ];

      for (const { label, status, retryAfter } of cases) {
        mockedAxios.get.mockReset();
        mockedAxios.get
          .mockRejectedValueOnce(httpError(status, { "retry-after": retryAfter() }))
          .mockResolvedValueOnce(ok("success"));

        const result = new HttpFetcher(scraperConfig()).fetch(PAGE_URL, {
          maxRetries: 1,
        });

        await vi.advanceTimersByTimeAsync(6_999);
        expect.soft(mockedAxios.get, label).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect.soft((await result).content.toString(), label).toBe("success");
        expect.soft(mockedAxios.get, label).toHaveBeenCalledTimes(2);
      }
    });

    it("waits between half and all of five times the retry delay when a 429 names no delay", async () => {
      mockedAxios.get
        .mockRejectedValueOnce(httpError(429))
        .mockResolvedValueOnce(ok("success"));

      const result = new HttpFetcher(scraperConfig()).fetch(PAGE_URL, {
        maxRetries: 1,
        retryDelay: 1_000,
      });

      await vi.advanceTimersByTimeAsync(2_499);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2_501);
      expect((await result).content.toString()).toBe("success");
    });

    it("retries a 503 without Retry-After on the ordinary schedule", async () => {
      mockedAxios.get
        .mockRejectedValueOnce(httpError(503))
        .mockResolvedValueOnce(ok("success"));

      const result = new HttpFetcher(scraperConfig()).fetch(PAGE_URL, {
        maxRetries: 1,
        retryDelay: 1_000,
      });

      await vi.advanceTimersByTimeAsync(1_000);
      expect((await result).content.toString()).toBe("success");
    });

    it("holds the host's other requests until its pause ends", async () => {
      const fetcher = new HttpFetcher(
        scraperConfig({ allowedHosts: ["example.com", "example.org"] }),
      );
      let throttled = false;
      mockedAxios.get.mockImplementation(async (url) => {
        if (url === PAGE_URL && !throttled) {
          throttled = true;
          throw httpError(429, { "retry-after": "10" });
        }
        return ok(`body of ${url}`);
      });

      const first = fetcher.fetch(PAGE_URL, { maxRetries: 1 });
      await vi.advanceTimersByTimeAsync(0);
      const sameHost = fetcher.fetch("https://example.com/other");
      const otherHost = fetcher.fetch("https://example.org/page");
      await vi.advanceTimersByTimeAsync(9_999);

      expect(requestedUrls()).toEqual([PAGE_URL, "https://example.org/page"]);
      expect((await otherHost).content.toString()).toBe(
        "body of https://example.org/page",
      );

      await vi.advanceTimersByTimeAsync(1);
      await Promise.all([first, sameHost]);
      expect(requestedUrls().slice(2).sort()).toEqual([
        "https://example.com/other",
        PAGE_URL,
      ]);
    });

    it("pauses the host on a 429 challenge it does not retry", async () => {
      const fetcher = new HttpFetcher(scraperConfig());
      mockedAxios.get
        .mockRejectedValueOnce(
          httpError(429, { "cf-mitigated": "challenge", "retry-after": "10" }),
        )
        .mockResolvedValue(ok("success"));

      const challenge = await fetcher.fetch(PAGE_URL).catch((e) => e);
      const next = fetcher.fetch("https://example.com/other");
      await vi.advanceTimersByTimeAsync(9_999);

      expect(challenge).toBeInstanceOf(ChallengeError);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect((await next).content.toString()).toBe("success");
    });

    it("fails with CancellationError when the signal aborts while the host is paused", async () => {
      mockedAxios.get.mockRejectedValueOnce(httpError(429, { "retry-after": "30" }));
      const controller = new AbortController();

      const error = new HttpFetcher(scraperConfig())
        .fetch(PAGE_URL, { maxRetries: 1, signal: controller.signal })
        .catch((e) => e);
      await vi.advanceTimersByTimeAsync(1_000);
      controller.abort();

      expect(await error).toBeInstanceOf(CancellationError);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });
  });

  describe("Fastly client challenge detection", () => {
    it("fails a 200 challenge page as a ChallengeError without retrying", async () => {
      mockedAxios.get.mockResolvedValue(
        ok(FASTLY_CHALLENGE_PAGE, { "content-type": "text/html; charset=utf-8" }),
      );

      const error = await fetcher
        .fetch(PAGE_URL, { maxRetries: 2, retryDelay: 1 })
        .catch((e) => e);

      expect(error).toBeInstanceOf(ChallengeError);
      expect(error).toMatchObject({ statusCode: 200, challengeType: "fastly" });
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it("returns a page that only looks like a challenge", async () => {
      const cases = [
        {
          label: "an HTML page titled Client Challenge that loads no challenge assets",
          body: "<html><head><title>Client Challenge</title></head></html>",
          type: "text/html",
        },
        {
          label: "a non-HTML response that contains the challenge markup",
          body: FASTLY_CHALLENGE_PAGE,
          type: "text/plain",
        },
      ];

      for (const { label, body, type } of cases) {
        mockedAxios.get.mockResolvedValue(ok(body, { "content-type": type }));

        const result = await fetcher.fetch(PAGE_URL);

        expect.soft(result.status, label).toBe(FetchStatus.SUCCESS);
        expect.soft(result.content.toString(), label).toBe(body);
      }
    });
  });

  describe("cancellation", () => {
    it("fails with CancellationError when axios cancels the request", async () => {
      mockedAxios.get.mockRejectedValue(networkError("ERR_CANCELED"));

      await expect(fetcher.fetch(PAGE_URL, { retryDelay: 1 })).rejects.toBeInstanceOf(
        CancellationError,
      );
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it("fails with CancellationError and destroys the body when the signal aborts during the read", async () => {
      const controller = new AbortController();
      let started = false;
      const body = new Readable({
        read() {
          if (started) return;
          started = true;
          this.push("partial");
          controller.abort();
        },
      });
      mockedAxios.get.mockResolvedValue(ok(body, { "content-type": "text/html" }));

      await expect(
        fetcher.fetch(PAGE_URL, { signal: controller.signal, retryDelay: 1 }),
      ).rejects.toBeInstanceOf(CancellationError);
      expect(body.destroyed).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });
  });
});
