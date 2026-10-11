import https from "node:https";
import { Readable } from "node:stream";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { HttpFetcher } from "./HttpFetcher";
import { MARKDOWN_PREFERRED_ACCEPT } from "./headers";
import { FetchStatus } from "./types";

vi.mock("axios");

const mockedAxios = vi.mocked(axios, true);

const PAGE_URL = "https://example.com/page";

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

  describe("canFetch", () => {
    it.each([
      ["http://example.com", true],
      ["https://example.com", true],
      ["ftp://example.com", false],
      ["file:///path/to/file", false],
      ["mailto:test@example.com", false],
      ["relative/path", false],
    ])("%s -> %s", (source, expected) => {
      expect(fetcher.canFetch(source)).toBe(expected);
    });
  });

  describe("successful responses", () => {
    it.each([
      [
        "a single-chunk body",
        () => Readable.from([Buffer.from("Hello World")]),
        "Hello World",
      ],
      [
        "a multi-chunk body",
        () => Readable.from([Buffer.from('{"a":'), Buffer.from("1}")]),
        '{"a":1}',
      ],
      [
        "a lazily produced body",
        () => trackedStream("<html>hello</html>").stream,
        "<html>hello</html>",
      ],
    ])("reads %s in full", async (_label, body, expected) => {
      mockedAxios.get.mockResolvedValue(ok(body()));

      const result = await fetcher.fetch(PAGE_URL);

      expect(result.status).toBe(FetchStatus.SUCCESS);
      expect(result.content.toString()).toBe(expected);
      expect(result.source).toBe(PAGE_URL);
    });

    it("returns binary bodies byte for byte", async () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      mockedAxios.get.mockResolvedValue(ok(png, { "content-type": "image/png" }));

      const result = await fetcher.fetch(PAGE_URL);

      expect(result.content).toEqual(png);
      expect(result.mimeType).toBe("image/png");
    });

    it.each([
      ["text/html; charset=utf-8", undefined, "text/html", "utf-8", undefined],
      [
        "text/plain; charset=iso-8859-1",
        undefined,
        "text/plain",
        "iso-8859-1",
        undefined,
      ],
      ["text/plain", undefined, "text/plain", undefined, undefined],
      ["text/plain; charset=utf-8", "gzip", "text/plain", "utf-8", "gzip"],
      [undefined, undefined, "application/octet-stream", undefined, undefined],
    ])(
      "reads Content-Type %s and Content-Encoding %s as %s, charset %s, encoding %s",
      async (contentType, contentEncoding, mimeType, charset, encoding) => {
        const headers: Record<string, string> = {};
        if (contentType) headers["content-type"] = contentType;
        if (contentEncoding) headers["content-encoding"] = contentEncoding;
        mockedAxios.get.mockResolvedValue(ok("abc", headers));

        const result = await fetcher.fetch(PAGE_URL);

        expect(result.mimeType).toBe(mimeType);
        expect(result.charset).toBe(charset);
        expect(result.encoding).toBe(encoding);
      },
    );

    it.each([
      ["ETag", { etag: '"v1"' }, '"v1"', undefined],
      ["no caching headers", {}, undefined, undefined],
      [
        "Last-Modified",
        { "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT" },
        undefined,
        "2015-10-21T07:28:00.000Z",
      ],
    ])(
      "reports %s as etag and lastModified",
      async (_label, cacheHeaders, etag, lastModified) => {
        mockedAxios.get.mockResolvedValue(
          ok("content", { "content-type": "text/plain", ...cacheHeaders }),
        );

        const result = await fetcher.fetch(PAGE_URL);

        expect(result.etag).toBe(etag);
        expect(result.lastModified).toBe(lastModified);
      },
    );

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

    it.each([
      ['"abc123"', '"abc123"'],
      [undefined, undefined],
    ])("sends If-None-Match %s for etag %s", async (etag, expected) => {
      mockedAxios.get.mockResolvedValue(ok());

      await fetcher.fetch(PAGE_URL, { etag });

      expect(requestConfig()?.headers?.["If-None-Match"]).toBe(expected);
    });

    it.each([
      { allowInvalidTls: true, url: "https://example.com/", skipsVerification: true },
      { allowInvalidTls: true, url: "http://example.com/", skipsVerification: false },
      { allowInvalidTls: false, url: "https://example.com/", skipsVerification: false },
    ])(
      "allowInvalidTls=$allowInvalidTls on $url skips certificate verification: $skipsVerification",
      async ({ allowInvalidTls, url, skipsVerification }) => {
        mockedAxios.get.mockResolvedValue(ok());

        await new HttpFetcher(scraperConfig({ allowInvalidTls })).fetch(url);

        const agent = requestConfig()?.httpsAgent;
        if (skipsVerification) {
          expect(agent).toBeInstanceOf(https.Agent);
          expect(agent.options.rejectUnauthorized).toBe(false);
        } else {
          expect(agent).toBeUndefined();
        }
      },
    );
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

    it.each([408, 429, 500, 502, 503, 504, 525])("retries status %i", async (status) => {
      mockedAxios.get
        .mockRejectedValueOnce(httpError(status))
        .mockResolvedValueOnce(ok("success"));

      const result = await fetcher.fetch(PAGE_URL, { maxRetries: 1, retryDelay: 1 });

      expect(result.content.toString()).toBe("success");
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it.each([400, 401, 403, 405, 410])(
      "fails status %i with HttpStatusError without retrying",
      async (status) => {
        mockedAxios.get.mockRejectedValue(httpError(status));

        const error = await fetcher
          .fetch(PAGE_URL, { maxRetries: 2, retryDelay: 1 })
          .catch((e) => e);

        expect(error).toBeInstanceOf(HttpStatusError);
        expect(error.statusCode).toBe(status);
        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      },
    );

    it("retries a network error that has no status", async () => {
      mockedAxios.get
        .mockRejectedValueOnce(networkError("ECONNRESET"))
        .mockResolvedValueOnce(ok("success"));

      const result = await fetcher.fetch(PAGE_URL, { maxRetries: 1, retryDelay: 1 });

      expect(result.content.toString()).toBe("success");
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it.each(["ENOTFOUND", "ECONNREFUSED"])(
      "fails %s with ScraperError without retrying",
      async (code) => {
        mockedAxios.get.mockRejectedValue(networkError(code));

        const error = await fetcher
          .fetch(PAGE_URL, { maxRetries: 2, retryDelay: 1 })
          .catch((e) => e);

        expect(error).toBeInstanceOf(ScraperError);
        expect(error).not.toBeInstanceOf(HttpStatusError);
        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      },
    );

    it.each([
      ["the configured default", undefined, DEFAULT_CONFIG.scraper.fetcher.maxRetries],
      ["an explicit maxRetries", 2, 2],
    ])(
      "gives up after %s number of retries",
      async (_label, maxRetries, expectedRetries) => {
        mockedAxios.get.mockRejectedValue(httpError(500));

        const error = await fetcher
          .fetch(PAGE_URL, { maxRetries, retryDelay: 1 })
          .catch((e) => e);

        expect(error).toBeInstanceOf(HttpStatusError);
        expect(error.statusCode).toBe(500);
        expect(mockedAxios.get).toHaveBeenCalledTimes(expectedRetries + 1);
      },
    );

    it("fails a TLS certificate error with TlsCertificateError without retrying", async () => {
      mockedAxios.get.mockRejectedValue(networkError("UNABLE_TO_VERIFY_LEAF_SIGNATURE"));

      await expect(
        fetcher.fetch(PAGE_URL, { maxRetries: 2, retryDelay: 1 }),
      ).rejects.toBeInstanceOf(TlsCertificateError);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });
  });

  describe("Cloudflare challenge detection", () => {
    it.each([
      ["a cf-mitigated header", { "cf-mitigated": "challenge" }, ""],
      ["a cloudflare server header", { server: "cloudflare" }, ""],
      [
        "the Enable JavaScript marker",
        {},
        "<p>Enable JavaScript and cookies to continue</p>",
      ],
      // The body is a stream and has to be drained before these markers can match.
      ["the Just a moment marker", {}, "<html><body>Just a moment...</body></html>"],
      ["the cf_chl_opt marker", {}, "<script>window._cf_chl_opt={};</script>"],
    ])(
      "fails a 403 with %s as a ChallengeError without retrying",
      async (_label, headers, body) => {
        mockedAxios.get.mockRejectedValue(httpError(403, headers, body));

        await expect(
          fetcher.fetch(PAGE_URL, { maxRetries: 2, retryDelay: 1 }),
        ).rejects.toBeInstanceOf(ChallengeError);
        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      },
    );

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
