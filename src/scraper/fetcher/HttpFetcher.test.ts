import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CancellationError } from "../../pipeline/errors";
import { DEFAULT_CONFIG } from "../../utils/config";
import { RedirectError, ScraperError, TlsCertificateError } from "../../utils/errors";

vi.mock("axios");

import axios from "axios";

const mockedAxios = vi.mocked(axios, true);

import { HttpFetcher } from "./HttpFetcher";
import { FetchStatus } from "./types";

const createFetcher = () => new HttpFetcher(DEFAULT_CONFIG.scraper);

describe("HttpFetcher", () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
  });

  describe("canFetch", () => {
    it("should return true for HTTP URLs", () => {
      const fetcher = createFetcher();
      expect(fetcher.canFetch("http://example.com")).toBe(true);
      expect(fetcher.canFetch("https://example.com")).toBe(true);
    });

    it("should return false for non-HTTP URLs", () => {
      const fetcher = createFetcher();
      expect(fetcher.canFetch("ftp://example.com")).toBe(false);
      expect(fetcher.canFetch("file:///path/to/file")).toBe(false);
      expect(fetcher.canFetch("mailto:test@example.com")).toBe(false);
      expect(fetcher.canFetch("relative/path")).toBe(false);
    });
  });

  describe("data type handling", () => {
    it("should read a single-chunk stream body", async () => {
      const fetcher = createFetcher();
      const textContent = "Hello World";
      mockedAxios.get.mockResolvedValue({
        data: Readable.from(Buffer.from(textContent, "utf-8")),
        headers: { "content-type": "text/plain" },
      });

      const result = await fetcher.fetch("https://example.com");
      expect(result.content).toEqual(Buffer.from(textContent, "utf-8"));
    });

    it("should concatenate a multi-chunk stream body", async () => {
      const fetcher = createFetcher();
      const mockResponse = {
        data: Readable.from([Buffer.from('{"a":'), Buffer.from("1}")]),
        headers: { "content-type": "application/json" },
      };
      mockedAxios.get.mockResolvedValue(mockResponse);

      const result = await fetcher.fetch("https://example.com");
      expect(result.content.toString()).toBe('{"a":1}');
      expect(result.mimeType).toBe("application/json");
    });
  });

  describe("cancellation", () => {
    it("should throw CancellationError when signal is aborted", async () => {
      const fetcher = createFetcher();
      const abortController = new AbortController();
      abortController.abort();

      mockedAxios.get.mockRejectedValue({ code: "ERR_CANCELED" });

      await expect(
        fetcher.fetch("https://example.com", { signal: abortController.signal }),
      ).rejects.toBeInstanceOf(CancellationError);
    });

    it("should throw CancellationError when axios returns ERR_CANCELED", async () => {
      const fetcher = createFetcher();
      mockedAxios.get.mockRejectedValue({ code: "ERR_CANCELED" });

      await expect(fetcher.fetch("https://example.com")).rejects.toBeInstanceOf(
        CancellationError,
      );
    });
  });

  describe("error handling edge cases", () => {
    it("should handle network errors without response object", async () => {
      const fetcher = createFetcher();
      const networkError = new Error("Network Error");
      mockedAxios.get.mockRejectedValue(networkError);

      await expect(
        fetcher.fetch("https://example.com", { maxRetries: 0 }),
      ).rejects.toThrow(ScraperError);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it("should handle redirects without location header when followRedirects is false", async () => {
      const fetcher = createFetcher();
      mockedAxios.get.mockRejectedValue({
        response: {
          status: 301,
          headers: {}, // No location header
        },
      });

      // Should not throw RedirectError without location, should retry or throw ScraperError
      await expect(
        fetcher.fetch("https://example.com", { followRedirects: false, maxRetries: 0 }),
      ).rejects.toThrow(ScraperError);
    });
  });

  describe("configuration defaults", () => {
    it("should use default max retries when not specified", async () => {
      const fetcher = createFetcher();
      // Mock failure for all attempts - use a retryable error
      mockedAxios.get.mockRejectedValue({ response: { status: 500 } });

      await expect(
        fetcher.fetch("https://example.com", {
          retryDelay: 1, // Minimal delay for fast test
          maxRetries: undefined, // Explicitly test default
        }),
      ).rejects.toThrow(ScraperError);

      // Should call initial attempt + 3 retries (default SCRAPER_FETCHER_MAX_RETRIES = 3)
      expect(mockedAxios.get).toHaveBeenCalledTimes(4);
    });

    it("should respect custom maxRetries option", async () => {
      const fetcher = createFetcher();
      mockedAxios.get.mockRejectedValue({ response: { status: 500 } });

      await expect(
        fetcher.fetch("https://example.com", {
          maxRetries: 2,
          retryDelay: 1,
        }),
      ).rejects.toThrow(ScraperError);

      // Should call initial attempt + 2 custom retries
      expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    });

    it("should pass timeout option to axios", async () => {
      const fetcher = createFetcher();
      const mockResponse = {
        data: Readable.from(Buffer.from("test", "utf-8")),
        headers: { "content-type": "text/plain" },
      };
      mockedAxios.get.mockResolvedValue(mockResponse);

      await fetcher.fetch("https://example.com", { timeout: 5000 });

      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          timeout: 5000,
        }),
      );
    });
  });

  it("should fetch content successfully", async () => {
    const fetcher = createFetcher();
    const htmlContent = "<html><body><h1>Hello</h1></body></html>";
    const mockResponse = {
      data: Readable.from(Buffer.from(htmlContent, "utf-8")), // HttpFetcher expects buffer from axios
      headers: { "content-type": "text/html; charset=utf-8" },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    const result = await fetcher.fetch("https://example.com");
    expect(result.content).toEqual(Buffer.from(htmlContent, "utf-8"));
    expect(result.mimeType).toBe("text/html");
    expect(result.charset).toBe("utf-8");
    expect(result.source).toBe("https://example.com");
  });

  it("should extract charset from content-type header", async () => {
    const fetcher = createFetcher();
    const textContent = "abc";
    const mockResponse = {
      data: Readable.from(Buffer.from(textContent, "utf-8")),
      headers: { "content-type": "text/plain; charset=iso-8859-1" },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    const result = await fetcher.fetch("https://example.com/file.txt");
    expect(result.mimeType).toBe("text/plain");
    expect(result.charset).toBe("iso-8859-1");
  });

  it("should set charset undefined if not present in content-type", async () => {
    const fetcher = createFetcher();
    const textContent = "abc";
    const mockResponse = {
      data: Readable.from(Buffer.from(textContent, "utf-8")),
      headers: { "content-type": "text/plain" },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    const result = await fetcher.fetch("https://example.com/file.txt");
    expect(result.mimeType).toBe("text/plain");
    expect(result.charset).toBeUndefined();
  });

  it("should extract encoding from content-encoding header", async () => {
    const fetcher = createFetcher();
    const textContent = "abc";
    const mockResponse = {
      data: Readable.from(Buffer.from(textContent, "utf-8")),
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-encoding": "gzip",
      },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    const result = await fetcher.fetch("https://example.com/file.txt");
    expect(result.encoding).toBe("gzip");
    expect(result.mimeType).toBe("text/plain");
    expect(result.charset).toBe("utf-8");
  });

  it("should default mimeType to application/octet-stream if content-type header is missing", async () => {
    const fetcher = createFetcher();
    const mockResponse = {
      data: Readable.from(Buffer.from([1, 2, 3])),
      headers: {},
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    const result = await fetcher.fetch("https://example.com/file.bin");
    expect(result.mimeType).toBe("application/octet-stream");
    expect(result.charset).toBeUndefined();
  });

  it("should handle different content types", async () => {
    const fetcher = createFetcher();
    const mockResponse = {
      data: Readable.from(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
      headers: { "content-type": "image/png" },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    const result = await fetcher.fetch("https://example.com/image.png");
    expect(result.content).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(result.mimeType).toBe("image/png");
  });

  describe("retry logic", () => {
    it("should retry on retryable status codes [408, 429, 500, 502, 503, 504, 525]", async () => {
      const fetcher = createFetcher();
      const retryableStatuses = [408, 429, 500, 502, 503, 504, 525];

      for (const status of retryableStatuses) {
        mockedAxios.get.mockReset();
        mockedAxios.get.mockRejectedValueOnce({ response: { status } });
        mockedAxios.get.mockResolvedValueOnce({
          data: Readable.from(Buffer.from("success", "utf-8")),
          headers: { "content-type": "text/plain" },
        });

        const result = await fetcher.fetch("https://example.com", {
          maxRetries: 1,
          retryDelay: 1,
        });

        expect(result.content).toEqual(Buffer.from("success", "utf-8"));
        expect(mockedAxios.get).toHaveBeenCalledTimes(2); // Initial + 1 retry
      }
    });

    it("should not retry on non-retryable status codes [400, 401, 403, 404, 405, 410]", async () => {
      const fetcher = createFetcher();
      const nonRetryableStatuses = [400, 401, 403, 405, 410];

      for (const status of nonRetryableStatuses) {
        mockedAxios.get.mockReset();
        mockedAxios.get.mockRejectedValue({ response: { status } });

        await expect(
          fetcher.fetch("https://example.com", {
            maxRetries: 2,
            retryDelay: 1,
          }),
        ).rejects.toThrow(ScraperError);

        expect(mockedAxios.get).toHaveBeenCalledTimes(1); // No retries
      }

      // 404 has special handling - returns result instead of throwing
      mockedAxios.get.mockReset();
      mockedAxios.get.mockRejectedValue({ response: { status: 404 } });

      const result = await fetcher.fetch("https://example.com", {
        maxRetries: 2,
        retryDelay: 1,
      });

      expect(result.status).toBe("not_found");
      expect(mockedAxios.get).toHaveBeenCalledTimes(1); // No retries for 404
    });

    it("should not retry on TLS certificate validation errors", async () => {
      const fetcher = createFetcher();
      const tlsError = Object.assign(
        new Error("unable to verify the first certificate"),
        {
          code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        },
      );
      mockedAxios.get.mockRejectedValue(tlsError);

      await expect(
        fetcher.fetch("https://example.com", {
          maxRetries: 2,
          retryDelay: 1,
        }),
      ).rejects.toBeInstanceOf(TlsCertificateError);

      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });
  });

  it("should generate fingerprint headers", async () => {
    const fetcher = createFetcher();
    const mockResponse = {
      data: Readable.from(
        Buffer.from("<html><body><h1>Hello</h1></body></html>", "utf-8"),
      ),
      headers: { "content-type": "text/html" },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    await fetcher.fetch("https://example.com");

    // Test behavior: verify that axios is called with required properties.
    // Redirects are handled manually so every target can pass the access
    // policy before connect, so axios is always invoked with maxRedirects: 0.
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        responseType: "stream",
        headers: expect.objectContaining({
          "user-agent": expect.any(String),
          Accept: "text/markdown, text/html;q=0.9, */*;q=0.8",
          "accept-language": expect.any(String),
          // Verify that our custom Accept-Encoding header is set (excluding zstd)
          "Accept-Encoding": "gzip, deflate, br",
        }),
        timeout: undefined,
        maxRedirects: 0,
        signal: undefined,
        decompress: true,
      }),
    );
  });

  it("should respect custom headers", async () => {
    const fetcher = createFetcher();
    const mockResponse = {
      data: Readable.from(
        Buffer.from("<html><body><h1>Hello</h1></body></html>", "utf-8"),
      ),
      headers: { "content-type": "text/html" },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);
    const headers = { "X-Custom-Header": "value" };

    await fetcher.fetch("https://example.com", { headers });

    // Test behavior: verify custom headers are included
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        responseType: "stream",
        headers: expect.objectContaining(headers),
        timeout: undefined,
        maxRedirects: 0,
        signal: undefined,
        decompress: true,
      }),
    );
  });

  it("should preserve caller-supplied Accept headers", async () => {
    const fetcher = createFetcher();
    mockedAxios.get.mockResolvedValue({
      data: Readable.from(Buffer.from("ok", "utf-8")),
      headers: { "content-type": "text/plain" },
    });

    await fetcher.fetch("https://example.com", {
      headers: { accept: "application/json" },
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        headers: expect.objectContaining({ accept: "application/json" }),
      }),
    );
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Accept: "text/markdown, text/html;q=0.9, */*;q=0.8",
        }),
      }),
    );
  });

  describe("redirect handling", () => {
    it("should follow redirects by default", async () => {
      const fetcher = createFetcher();
      const mockResponse = {
        data: Readable.from(
          Buffer.from("<html><body><h1>Hello</h1></body></html>", "utf-8"),
        ),
        headers: { "content-type": "text/html" },
      };
      mockedAxios.get.mockResolvedValue(mockResponse);

      const result = await fetcher.fetch("https://example.com");

      // Test behavior: verify result is correct and redirects are allowed
      expect(result.content).toEqual(
        Buffer.from("<html><body><h1>Hello</h1></body></html>", "utf-8"),
      );
      // Redirects are followed manually so axios is always invoked with
      // maxRedirects: 0; the follow-by-default behavior is exercised inside
      // HttpFetcher's own loop.
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          maxRedirects: 0,
        }),
      );
    });

    it("should follow redirects when followRedirects is true", async () => {
      const fetcher = createFetcher();
      const mockResponse = {
        data: Readable.from(
          Buffer.from("<html><body><h1>Hello</h1></body></html>", "utf-8"),
        ),
        headers: { "content-type": "text/html" },
      };
      mockedAxios.get.mockResolvedValue(mockResponse);

      const result = await fetcher.fetch("https://example.com", {
        followRedirects: true,
      });

      // Test behavior: verify result is correct and redirects are allowed
      expect(result.content).toEqual(
        Buffer.from("<html><body><h1>Hello</h1></body></html>", "utf-8"),
      );
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          maxRedirects: 0,
        }),
      );
    });

    it("should not follow redirects when followRedirects is false", async () => {
      const fetcher = createFetcher();
      const mockResponse = {
        data: Readable.from(
          Buffer.from("<html><body><h1>Hello</h1></body></html>", "utf-8"),
        ),
        headers: { "content-type": "text/html" },
      };
      mockedAxios.get.mockResolvedValue(mockResponse);

      const result = await fetcher.fetch("https://example.com", {
        followRedirects: false,
      });

      // Test behavior: verify result is correct and redirects are disabled
      expect(result.content).toEqual(
        Buffer.from("<html><body><h1>Hello</h1></body></html>", "utf-8"),
      );
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          maxRedirects: 0, // Should not allow redirects
        }),
      );
    });

    it("should throw RedirectError when a redirect is encountered and followRedirects is false", async () => {
      const fetcher = createFetcher();
      const redirectError = {
        response: {
          status: 301,
          headers: {
            location: "https://new-example.com",
          },
        },
      };
      mockedAxios.get.mockRejectedValue(redirectError);

      await expect(
        fetcher.fetch("https://example.com", { followRedirects: false }),
      ).rejects.toBeInstanceOf(RedirectError);

      await expect(
        fetcher.fetch("https://example.com", { followRedirects: false }),
      ).rejects.toMatchObject({
        originalUrl: "https://example.com",
        redirectUrl: "https://new-example.com",
        statusCode: 301,
      });
    });

    it("should expose final redirect URL as source (canonical trailing slash + query)", async () => {
      const fetcher = createFetcher();
      const original = "https://learn.microsoft.com/en-us/azure/bot-service";
      const finalUrl = `${original}/?view=azure-bot-service-4.0`;

      // Simulate axios response object after redirects (follow-redirects style)
      mockedAxios.get.mockResolvedValue({
        data: Readable.from(Buffer.from("<html><body>OK</body></html>", "utf-8")),
        headers: { "content-type": "text/html" },
        request: { res: { responseUrl: finalUrl } },
        config: { url: finalUrl },
      });

      const result = await fetcher.fetch(original);

      // Expected to FAIL before implementation change (currently returns original)
      expect(result.source).toBe(finalUrl);
    });
  });

  describe("Conditional request headers", () => {
    beforeEach(() => {
      mockedAxios.get.mockReset();
    });

    it("should send If-None-Match header when etag is provided", async () => {
      const fetcher = createFetcher();
      const mockResponse = {
        data: Readable.from(Buffer.from("content", "utf-8")),
        headers: { "content-type": "text/plain" },
      };
      mockedAxios.get.mockResolvedValue(mockResponse);

      await fetcher.fetch("https://example.com", { etag: '"abc123"' });

      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          headers: expect.objectContaining({
            "If-None-Match": '"abc123"',
          }),
        }),
      );
    });

    it("should NOT send If-None-Match header when etag is not provided", async () => {
      const fetcher = createFetcher();
      const mockResponse = {
        data: Readable.from(Buffer.from("content", "utf-8")),
        headers: { "content-type": "text/plain" },
      };
      mockedAxios.get.mockResolvedValue(mockResponse);

      await fetcher.fetch("https://example.com");

      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          headers: expect.not.objectContaining({
            "If-None-Match": expect.anything(),
          }),
        }),
      );
    });
  });

  describe("304 Not Modified response handling", () => {
    beforeEach(() => {
      mockedAxios.get.mockReset();
    });

    it("should handle 304 responses with status='not_modified', empty content, and no retry", async () => {
      const fetcher = createFetcher();
      const etag = '"cached-etag-123"';

      // 304 is treated as successful by validateStatus, so axios resolves (not rejects)
      mockedAxios.get.mockResolvedValue({
        status: 304,
        data: Readable.from(Buffer.from("")), // 304 typically has no body
        headers: { etag },
        config: {},
        statusText: "Not Modified",
      });

      const result = await fetcher.fetch("https://example.com", { etag });

      expect(result.status).toBe("not_modified");
      expect(result.etag).toBeUndefined(); // 304 response doesn't extract etag from headers
      expect(result.content).toEqual(Buffer.from(""));
      expect(mockedAxios.get).toHaveBeenCalledTimes(1); // No retries for 304
    });
  });

  describe("ETag extraction from responses", () => {
    beforeEach(() => {
      mockedAxios.get.mockReset();
    });

    it("should extract etag from response headers (or undefined if missing)", async () => {
      const fetcher = createFetcher();
      const etag = '"response-etag-456"';

      // Test with etag present
      mockedAxios.get.mockResolvedValue({
        data: Readable.from(Buffer.from("content", "utf-8")),
        headers: { "content-type": "text/plain", etag },
      });

      const resultWithEtag = await fetcher.fetch("https://example.com");
      expect(resultWithEtag.etag).toBe(etag);

      mockedAxios.get.mockReset();

      // Test with etag missing
      mockedAxios.get.mockResolvedValue({
        data: Readable.from(Buffer.from("content", "utf-8")),
        headers: { "content-type": "text/plain" },
      });

      const resultWithoutEtag = await fetcher.fetch("https://example.com");
      expect(resultWithoutEtag.etag).toBeUndefined();
    });
  });
});

describe("HttpFetcher fetch-time unprocessable-content gate", () => {
  /** A Readable that records whether it was destroyed before being drained. */
  const streamOf = (body: string) => {
    let delivered = false;
    const stream = new Readable({
      read() {
        delivered = true;
        this.push(body);
        this.push(null);
      },
    });
    return { stream, wasDrained: () => delivered };
  };

  const respond = (mimeType: string, body: string, status = 200) => {
    const { stream, wasDrained } = streamOf(body);
    mockedAxios.get.mockResolvedValue({
      status,
      headers: { "content-type": mimeType },
      data: stream,
      request: { res: { responseUrl: "https://example.com/resource" } },
    });
    return { stream, wasDrained };
  };

  beforeEach(() => {
    mockedAxios.get.mockReset();
  });

  it("reads a processable response in full from a real stream", async () => {
    respond("text/html", "<html><body>hello</body></html>");

    const result = await createFetcher().fetch("https://example.com/resource", {
      acceptsMimeType: (m) => m === "text/html",
    });

    expect(result.status).toBe(FetchStatus.SUCCESS);
    expect(result.content.toString()).toBe("<html><body>hello</body></html>");
    expect(result.mimeType).toBe("text/html");
  });

  it("abandons an unprocessable response without draining the body", async () => {
    const { stream, wasDrained } = respond("image/png", "PNGDATA".repeat(1000));

    const result = await createFetcher().fetch("https://example.com/resource", {
      acceptsMimeType: (m) => m !== "image/png",
    });

    expect(result.status).toBe(FetchStatus.SKIPPED);
    expect(result.content.toString()).toBe("");
    expect(result.mimeType).toBe("image/png");
    expect(wasDrained()).toBe(false);
    expect(stream.destroyed).toBe(true);
  });

  it("treats a missing Content-Type as unprocessable", async () => {
    const { stream } = streamOf("body");
    mockedAxios.get.mockResolvedValue({
      status: 200,
      headers: {},
      data: stream,
      request: { res: { responseUrl: "https://example.com/resource" } },
    });

    const result = await createFetcher().fetch("https://example.com/resource", {
      // parseContentType resolves an absent header to application/octet-stream,
      // which no pipeline claims — the same outcome as today, reached sooner.
      acceptsMimeType: (m) => m !== "application/octet-stream",
    });

    expect(result.status).toBe(FetchStatus.SKIPPED);
    expect(result.mimeType).toBe("application/octet-stream");
  });

  it("does no gating when no predicate is supplied", async () => {
    respond("image/png", "PNGDATA");

    const result = await createFetcher().fetch("https://example.com/resource");

    expect(result.status).toBe(FetchStatus.SUCCESS);
    expect(result.content.toString()).toBe("PNGDATA");
  });

  it("does not consult the gate for 304 Not Modified", async () => {
    mockedAxios.get.mockResolvedValue({
      status: 304,
      headers: {},
      data: null,
      request: { res: { responseUrl: "https://example.com/resource" } },
    });
    const predicate = vi.fn().mockReturnValue(false);

    const result = await createFetcher().fetch("https://example.com/resource", {
      etag: '"abc"',
      acceptsMimeType: predicate,
    });

    expect(result.status).toBe(FetchStatus.NOT_MODIFIED);
    expect(predicate).not.toHaveBeenCalled();
  });

  it("does not consult the gate for 404 Not Found", async () => {
    mockedAxios.get.mockRejectedValue(
      Object.assign(new Error("Not Found"), {
        isAxiosError: true,
        response: { status: 404, headers: {}, data: null },
      }),
    );
    const predicate = vi.fn().mockReturnValue(false);

    const result = await createFetcher().fetch("https://example.com/resource", {
      acceptsMimeType: predicate,
    });

    expect(result.status).toBe(FetchStatus.NOT_FOUND);
    expect(predicate).not.toHaveBeenCalled();
  });

  it("gates on the final hop of a redirect chain", async () => {
    const { stream, wasDrained } = streamOf("PNGDATA");
    mockedAxios.get
      .mockResolvedValueOnce({
        status: 301,
        headers: { location: "https://example.com/final.png" },
        data: null,
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { "content-type": "image/png" },
        data: stream,
        request: { res: { responseUrl: "https://example.com/final.png" } },
      });

    const result = await createFetcher().fetch("https://example.com/start", {
      acceptsMimeType: (m) => m !== "image/png",
    });

    expect(result.status).toBe(FetchStatus.SKIPPED);
    expect(result.source).toBe("https://example.com/final.png");
    expect(wasDrained()).toBe(false);
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it("does not retry a skipped response", async () => {
    respond("image/png", "PNGDATA");

    const result = await createFetcher().fetch("https://example.com/resource", {
      acceptsMimeType: () => false,
    });

    expect(result.status).toBe(FetchStatus.SKIPPED);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });
});

describe("HttpFetcher Cloudflare challenge detection", () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
  });

  it("detects a challenge from the response body when headers are absent", async () => {
    // Regression guard for the streaming conversion: under responseType "stream"
    // the error body is a Readable, so it must be drained before the body-text
    // markers can match. Without this the three content checks silently no-op and
    // only header-based detection survives.
    mockedAxios.get.mockRejectedValue(
      Object.assign(new Error("Forbidden"), {
        isAxiosError: true,
        response: {
          status: 403,
          headers: {},
          data: Readable.from("<html><body>Just a moment...</body></html>"),
        },
      }),
    );

    await expect(createFetcher().fetch("https://example.com")).rejects.toThrow(
      /challenge/i,
    );
  });

  it("detects a challenge from the cf_chl_opt marker", async () => {
    mockedAxios.get.mockRejectedValue(
      Object.assign(new Error("Forbidden"), {
        isAxiosError: true,
        response: {
          status: 403,
          headers: {},
          data: Readable.from("<script>window._cf_chl_opt={};</script>"),
        },
      }),
    );

    await expect(createFetcher().fetch("https://example.com")).rejects.toThrow(
      /challenge/i,
    );
  });

  it("does not treat an ordinary 403 as a challenge", async () => {
    mockedAxios.get.mockRejectedValue(
      Object.assign(new Error("Forbidden"), {
        isAxiosError: true,
        response: {
          status: 403,
          headers: { server: "nginx" },
          data: Readable.from("<html><body>Access denied</body></html>"),
        },
      }),
    );

    await expect(createFetcher().fetch("https://example.com")).rejects.toThrow(
      /Failed to fetch/,
    );
  });
});

describe("HttpFetcher response stream cleanup", () => {
  // A body that is never read pins its socket, because Node will not return a
  // partially-consumed response to the keep-alive pool. Only the success path
  // consumes the stream, so every other exit must tear it down.
  beforeEach(() => {
    mockedAxios.get.mockReset();
  });

  it("destroys the body of a 304 response", async () => {
    const body = Readable.from("unused");
    mockedAxios.get.mockResolvedValue({
      status: 304,
      headers: {},
      data: body,
      request: { res: { responseUrl: "https://example.com" } },
    });

    const result = await createFetcher().fetch("https://example.com", {
      etag: '"abc"',
    });

    expect(result.status).toBe(FetchStatus.NOT_MODIFIED);
    expect(body.destroyed).toBe(true);
  });

  it("destroys the body of each redirect hop", async () => {
    const hop = Readable.from("redirect body");
    const final = Readable.from("<html>done</html>");
    mockedAxios.get
      .mockResolvedValueOnce({
        status: 301,
        headers: { location: "https://example.com/final" },
        data: hop,
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { "content-type": "text/html" },
        data: final,
        request: { res: { responseUrl: "https://example.com/final" } },
      });

    const result = await createFetcher().fetch("https://example.com/start");

    expect(result.status).toBe(FetchStatus.SUCCESS);
    expect(hop.destroyed).toBe(true);
  });

  it("destroys the body when the content-type gate rejects it", async () => {
    const body = Readable.from("PNGDATA");
    mockedAxios.get.mockResolvedValue({
      status: 200,
      headers: { "content-type": "image/png" },
      data: body,
      request: { res: { responseUrl: "https://example.com/x" } },
    });

    const result = await createFetcher().fetch("https://example.com/x", {
      acceptsMimeType: () => false,
    });

    expect(result.status).toBe(FetchStatus.SKIPPED);
    expect(body.destroyed).toBe(true);
  });
});
