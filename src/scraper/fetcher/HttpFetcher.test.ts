import { beforeEach, describe, expect, it, vi } from "vitest";
import { CancellationError } from "../../pipeline/errors";
import { RedirectError, ScraperError } from "../../utils/errors";

vi.mock("axios");

import axios from "axios";

const mockedAxios = vi.mocked(axios, true);

import { HttpFetcher } from "./HttpFetcher";

describe("HttpFetcher", () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
  });

  describe("canFetch", () => {
    it("should return true for HTTP URLs", () => {
      const fetcher = new HttpFetcher();
      expect(fetcher.canFetch("http://example.com")).toBe(true);
      expect(fetcher.canFetch("https://example.com")).toBe(true);
    });

    it("should return false for non-HTTP URLs", () => {
      const fetcher = new HttpFetcher();
      expect(fetcher.canFetch("ftp://example.com")).toBe(false);
      expect(fetcher.canFetch("file:///path/to/file")).toBe(false);
      expect(fetcher.canFetch("mailto:test@example.com")).toBe(false);
      expect(fetcher.canFetch("relative/path")).toBe(false);
    });
  });

  describe("data type handling", () => {
    it("should handle ArrayBuffer response data", async () => {
      const fetcher = new HttpFetcher();
      const textContent = "Hello World";
      const arrayBuffer = new TextEncoder().encode(textContent).buffer;
      const mockResponse = {
        data: arrayBuffer,
        headers: { "content-type": "text/plain" },
      };
      mockedAxios.get.mockResolvedValue(mockResponse);

      const result = await fetcher.fetch("https://example.com");
      expect(result.content).toEqual(Buffer.from(textContent, "utf-8"));
    });

    it("should handle string response data", async () => {
      const fetcher = new HttpFetcher();
      const textContent = "Hello World";
      const mockResponse = {
        data: textContent,
        headers: { "content-type": "text/plain" },
      };
      mockedAxios.get.mockResolvedValue(mockResponse);

      const result = await fetcher.fetch("https://example.com");
      expect(result.content).toEqual(Buffer.from(textContent, "utf-8"));
    });

    it("should handle other data types as fallback", async () => {
      const fetcher = new HttpFetcher();
      // Use an array instead of object to avoid Buffer.from() issues
      const arrayData = [1, 2, 3];
      const mockResponse = {
        data: arrayData,
        headers: { "content-type": "application/json" },
      };
      mockedAxios.get.mockResolvedValue(mockResponse);

      const result = await fetcher.fetch("https://example.com");
      expect(result.content).toBeInstanceOf(Buffer);
      expect(result.mimeType).toBe("application/json");
    });
  });

  describe("cancellation", () => {
    it("should throw CancellationError when signal is aborted", async () => {
      const fetcher = new HttpFetcher();
      const abortController = new AbortController();
      abortController.abort();

      mockedAxios.get.mockRejectedValue({ code: "ERR_CANCELED" });

      await expect(
        fetcher.fetch("https://example.com", { signal: abortController.signal }),
      ).rejects.toBeInstanceOf(CancellationError);
    });

    it("should throw CancellationError when axios returns ERR_CANCELED", async () => {
      const fetcher = new HttpFetcher();
      mockedAxios.get.mockRejectedValue({ code: "ERR_CANCELED" });

      await expect(fetcher.fetch("https://example.com")).rejects.toBeInstanceOf(
        CancellationError,
      );
    });
  });

  describe("error handling edge cases", () => {
    it("should handle network errors without response object", async () => {
      const fetcher = new HttpFetcher();
      const networkError = new Error("Network Error");
      mockedAxios.get.mockRejectedValue(networkError);

      await expect(
        fetcher.fetch("https://example.com", { maxRetries: 0 }),
      ).rejects.toThrow(ScraperError);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it("should handle redirects without location header when followRedirects is false", async () => {
      const fetcher = new HttpFetcher();
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
      const fetcher = new HttpFetcher();
      // Mock failure for all attempts - use a retryable error
      mockedAxios.get.mockRejectedValue({ response: { status: 500 } });

      await expect(
        fetcher.fetch("https://example.com", {
          retryDelay: 1, // Minimal delay for fast test
          maxRetries: undefined, // Explicitly test default
        }),
      ).rejects.toThrow(ScraperError);

      // Should call initial attempt + 6 retries (default FETCHER_MAX_RETRIES = 6)
      expect(mockedAxios.get).toHaveBeenCalledTimes(7);
    });

    it("should respect custom maxRetries option", async () => {
      const fetcher = new HttpFetcher();
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
      const fetcher = new HttpFetcher();
      const mockResponse = {
        data: Buffer.from("test", "utf-8"),
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
    const fetcher = new HttpFetcher();
    const htmlContent = "<html><body><h1>Hello</h1></body></html>";
    const mockResponse = {
      data: Buffer.from(htmlContent, "utf-8"), // HttpFetcher expects buffer from axios
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
    const fetcher = new HttpFetcher();
    const textContent = "abc";
    const mockResponse = {
      data: Buffer.from(textContent, "utf-8"),
      headers: { "content-type": "text/plain; charset=iso-8859-1" },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    const result = await fetcher.fetch("https://example.com/file.txt");
    expect(result.mimeType).toBe("text/plain");
    expect(result.charset).toBe("iso-8859-1");
  });

  it("should set charset undefined if not present in content-type", async () => {
    const fetcher = new HttpFetcher();
    const textContent = "abc";
    const mockResponse = {
      data: Buffer.from(textContent, "utf-8"),
      headers: { "content-type": "text/plain" },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    const result = await fetcher.fetch("https://example.com/file.txt");
    expect(result.mimeType).toBe("text/plain");
    expect(result.charset).toBeUndefined();
  });

  it("should extract encoding from content-encoding header", async () => {
    const fetcher = new HttpFetcher();
    const textContent = "abc";
    const mockResponse = {
      data: Buffer.from(textContent, "utf-8"),
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
    const fetcher = new HttpFetcher();
    const mockResponse = {
      data: Buffer.from([1, 2, 3]),
      headers: {},
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    const result = await fetcher.fetch("https://example.com/file.bin");
    expect(result.mimeType).toBe("application/octet-stream");
    expect(result.charset).toBeUndefined();
  });

  it("should handle different content types", async () => {
    const fetcher = new HttpFetcher();
    const mockResponse = {
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      headers: { "content-type": "image/png" },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    const result = await fetcher.fetch("https://example.com/image.png");
    expect(result.content).toEqual(mockResponse.data);
    expect(result.mimeType).toBe("image/png");
  });

  describe("retry logic", () => {
    it("should retry on retryable status codes [408, 429, 500, 502, 503, 504, 525]", async () => {
      const fetcher = new HttpFetcher();
      const retryableStatuses = [408, 429, 500, 502, 503, 504, 525];

      for (const status of retryableStatuses) {
        mockedAxios.get.mockReset();
        mockedAxios.get.mockRejectedValueOnce({ response: { status } });
        mockedAxios.get.mockResolvedValueOnce({
          data: Buffer.from("success", "utf-8"),
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
      const fetcher = new HttpFetcher();
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
  });

  it("should generate fingerprint headers", async () => {
    const fetcher = new HttpFetcher();
    const mockResponse = {
      data: Buffer.from("<html><body><h1>Hello</h1></body></html>", "utf-8"),
      headers: { "content-type": "text/html" },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    await fetcher.fetch("https://example.com");

    // Test behavior: verify that axios is called with required properties
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        responseType: "arraybuffer",
        headers: expect.objectContaining({
          "user-agent": expect.any(String),
          accept: expect.any(String),
          "accept-language": expect.any(String),
          // Verify that our custom Accept-Encoding header is set (excluding zstd)
          "Accept-Encoding": "gzip, deflate, br",
        }),
        timeout: undefined,
        maxRedirects: 5,
        signal: undefined,
        decompress: true,
      }),
    );
  });

  it("should respect custom headers", async () => {
    const fetcher = new HttpFetcher();
    const mockResponse = {
      data: Buffer.from("<html><body><h1>Hello</h1></body></html>", "utf-8"),
      headers: { "content-type": "text/html" },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);
    const headers = { "X-Custom-Header": "value" };

    await fetcher.fetch("https://example.com", { headers });

    // Test behavior: verify custom headers are included
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        responseType: "arraybuffer",
        headers: expect.objectContaining(headers),
        timeout: undefined,
        maxRedirects: 5,
        signal: undefined,
        decompress: true,
      }),
    );
  });

  describe("redirect handling", () => {
    it("should follow redirects by default", async () => {
      const fetcher = new HttpFetcher();
      const mockResponse = {
        data: Buffer.from("<html><body><h1>Hello</h1></body></html>", "utf-8"),
        headers: { "content-type": "text/html" },
      };
      mockedAxios.get.mockResolvedValue(mockResponse);

      const result = await fetcher.fetch("https://example.com");

      // Test behavior: verify result is correct and redirects are allowed
      expect(result.content).toEqual(
        Buffer.from("<html><body><h1>Hello</h1></body></html>", "utf-8"),
      );
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          maxRedirects: 5, // Should allow redirects by default
        }),
      );
    });

    it("should follow redirects when followRedirects is true", async () => {
      const fetcher = new HttpFetcher();
      const mockResponse = {
        data: Buffer.from("<html><body><h1>Hello</h1></body></html>", "utf-8"),
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
          maxRedirects: 5, // Should allow redirects
        }),
      );
    });

    it("should not follow redirects when followRedirects is false", async () => {
      const fetcher = new HttpFetcher();
      const mockResponse = {
        data: Buffer.from("<html><body><h1>Hello</h1></body></html>", "utf-8"),
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
      const fetcher = new HttpFetcher();
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
      const fetcher = new HttpFetcher();
      const original = "https://learn.microsoft.com/en-us/azure/bot-service";
      const finalUrl = `${original}/?view=azure-bot-service-4.0`;

      // Simulate axios response object after redirects (follow-redirects style)
      mockedAxios.get.mockResolvedValue({
        data: Buffer.from("<html><body>OK</body></html>", "utf-8"),
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
      const fetcher = new HttpFetcher();
      const mockResponse = {
        data: Buffer.from("content", "utf-8"),
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
      const fetcher = new HttpFetcher();
      const mockResponse = {
        data: Buffer.from("content", "utf-8"),
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
      const fetcher = new HttpFetcher();
      const etag = '"cached-etag-123"';

      // 304 is treated as successful by validateStatus, so axios resolves (not rejects)
      mockedAxios.get.mockResolvedValue({
        status: 304,
        data: Buffer.from(""), // 304 typically has no body
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
      const fetcher = new HttpFetcher();
      const etag = '"response-etag-456"';

      // Test with etag present
      mockedAxios.get.mockResolvedValue({
        data: Buffer.from("content", "utf-8"),
        headers: { "content-type": "text/plain", etag },
      });

      const resultWithEtag = await fetcher.fetch("https://example.com");
      expect(resultWithEtag.etag).toBe(etag);

      mockedAxios.get.mockReset();

      // Test with etag missing
      mockedAxios.get.mockResolvedValue({
        data: Buffer.from("content", "utf-8"),
        headers: { "content-type": "text/plain" },
      });

      const resultWithoutEtag = await fetcher.fetch("https://example.com");
      expect(resultWithoutEtag.etag).toBeUndefined();
    });
  });
});
