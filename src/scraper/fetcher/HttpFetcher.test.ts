import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RedirectError, ScraperError } from "../../utils/errors";

vi.mock("axios");
vi.mock("../../utils/logger");

import axios from "axios";
const mockedAxios = vi.mocked(axios, true);

import { HttpFetcher } from "./HttpFetcher";

describe("HttpFetcher", () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should normalize mimeType from content-type header", async () => {
    const fetcher = new HttpFetcher();

    // Test case 1: Markdown with charset
    mockedAxios.get.mockResolvedValueOnce({
      data: "Some markdown",
      headers: { "content-type": "text/markdown; charset=UTF-8" },
    });
    let result = await fetcher.fetch("https://example.com/test.md");
    expect(result.mimeType).toBe("text/markdown");

    // Test case 2: Plain text with charset and different casing
    mockedAxios.get.mockResolvedValueOnce({
      data: "Some text",
      headers: { "content-type": "Text/Plain; charset=iso-8859-1" },
    });
    result = await fetcher.fetch("https://example.com/test.txt");
    expect(result.mimeType).toBe("text/plain");

    // Test case 3: JSON with parameters
    mockedAxios.get.mockResolvedValueOnce({
      data: "{}",
      headers: { "content-type": "Application/JSON; version=2.0" },
    });
    result = await fetcher.fetch("https://example.com/api/data");
    expect(result.mimeType).toBe("application/json");

    // Test case 4: Simple HTML (no parameters)
    mockedAxios.get.mockResolvedValueOnce({
      data: "<p>Hello</p>",
      headers: { "content-type": "text/html" },
    });
    result = await fetcher.fetch("https://example.com/index.html");
    expect(result.mimeType).toBe("text/html");

    // Test case 5: Default to application/octet-stream if no content-type header
    mockedAxios.get.mockResolvedValueOnce({
      data: "binary data",
      headers: {
        /* No content-type header */
      },
    });
    result = await fetcher.fetch("https://example.com/somefile");
    expect(result.mimeType).toBe("application/octet-stream");
  });

  it("should fetch content successfully", async () => {
    const fetcher = new HttpFetcher();
    const mockResponse = {
      data: "<html><body><h1>Hello</h1></body></html>",
      headers: { "content-type": "text/html" },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    const result = await fetcher.fetch("https://example.com");
    expect(result.content).toBe(mockResponse.data);
    expect(result.mimeType).toBe("text/html");
    expect(result.source).toBe("https://example.com");
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

  it("should not retry on unretryable HTTP errors", async () => {
    const fetcher = new HttpFetcher();
    mockedAxios.get.mockRejectedValue({ response: { status: 404 } });

    await expect(
      fetcher.fetch("https://example.com", {
        retryDelay: 10,
      }),
    ).rejects.toThrow(ScraperError);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);

    vi.clearAllTimers();
  });

  it("should retry on retryable HTTP errors", async () => {
    const fetcher = new HttpFetcher();
    const retryableErrors = [429, 500, 503];
    for (const status of retryableErrors) {
      mockedAxios.get.mockRejectedValueOnce({ response: { status } });
    }

    mockedAxios.get.mockResolvedValueOnce({
      data: "<html><body><h1>Hello</h1></body></html>",
      headers: { "content-type": "text/html" },
    });

    const fetchPromise = fetcher.fetch("https://example.com", {
      retryDelay: 10,
    });

    // Advance timers by the expected delay for each retry
    await vi.runAllTimersAsync();

    expect(mockedAxios.get).toHaveBeenCalledTimes(retryableErrors.length + 1);
    expect((await fetchPromise).content).toBe("<html><body><h1>Hello</h1></body></html>");

    vi.clearAllTimers();
  });

  it("should throw error after max retries", async () => {
    const fetcher = new HttpFetcher();
    const maxRetries = 3;

    mockedAxios.get.mockRejectedValue({ response: { status: 502 } });

    const fetchPromise = fetcher.fetch("https://example.com", {
      maxRetries: maxRetries,
      retryDelay: 10,
    });

    // Advance timers by the expected delay for each retry
    // FIXME: If we use `await` here, the test will fail with an unhandled promise rejection
    vi.runAllTimersAsync();

    await expect(fetchPromise).rejects.toThrow(ScraperError);
    expect(mockedAxios.get).toHaveBeenCalledTimes(maxRetries + 1);

    vi.clearAllTimers();
  });

  it("should generate fingerprint headers", async () => {
    const fetcher = new HttpFetcher();
    const mockResponse = {
      data: "<html><body><h1>Hello</h1></body></html>",
      headers: { "content-type": "text/html" },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);

    await fetcher.fetch("https://example.com");
    expect(mockedAxios.get).toHaveBeenCalledWith("https://example.com", {
      responseType: "arraybuffer",
      // Test for the presence of fingerprint headers
      headers: expect.objectContaining({
        "user-agent": expect.any(String),
        accept: expect.any(String),
        "accept-encoding": expect.any(String),
        "accept-language": expect.any(String),
      }),
      timeout: undefined,
      maxRedirects: 5, // Default follows redirects
    });
  });

  it("should respect custom headers", async () => {
    const fetcher = new HttpFetcher();
    const mockResponse = {
      data: "<html><body><h1>Hello</h1></body></html>",
      headers: { "content-type": "text/html" },
    };
    mockedAxios.get.mockResolvedValue(mockResponse);
    const headers = { "X-Custom-Header": "value" };

    await fetcher.fetch("https://example.com", { headers });
    expect(mockedAxios.get).toHaveBeenCalledWith("https://example.com", {
      responseType: "arraybuffer",
      headers: expect.objectContaining(headers),
      timeout: undefined,
      maxRedirects: 5, // Default follows redirects
    });
  });

  describe("redirect handling", () => {
    it("should follow redirects by default", async () => {
      const fetcher = new HttpFetcher();
      const mockResponse = {
        data: "<html><body><h1>Hello</h1></body></html>",
        headers: { "content-type": "text/html" },
      };
      mockedAxios.get.mockResolvedValue(mockResponse);

      await fetcher.fetch("https://example.com");
      expect(mockedAxios.get).toHaveBeenCalledWith("https://example.com", {
        responseType: "arraybuffer",
        headers: expect.any(Object),
        timeout: undefined,
        maxRedirects: 5, // Default follows redirects
        signal: undefined,
      });
    });

    it("should follow redirects when followRedirects is true", async () => {
      const fetcher = new HttpFetcher();
      const mockResponse = {
        data: "<html><body><h1>Hello</h1></body></html>",
        headers: { "content-type": "text/html" },
      };
      mockedAxios.get.mockResolvedValue(mockResponse);

      await fetcher.fetch("https://example.com", { followRedirects: true });
      expect(mockedAxios.get).toHaveBeenCalledWith("https://example.com", {
        responseType: "arraybuffer",
        headers: expect.any(Object),
        timeout: undefined,
        maxRedirects: 5,
        signal: undefined,
      });
    });

    it("should not follow redirects when followRedirects is false", async () => {
      const fetcher = new HttpFetcher();
      const mockResponse = {
        data: "<html><body><h1>Hello</h1></body></html>",
        headers: { "content-type": "text/html" },
      };
      mockedAxios.get.mockResolvedValue(mockResponse);

      await fetcher.fetch("https://example.com", { followRedirects: false });
      expect(mockedAxios.get).toHaveBeenCalledWith("https://example.com", {
        responseType: "arraybuffer",
        headers: expect.any(Object),
        timeout: undefined,
        maxRedirects: 0, // No redirects allowed
        signal: undefined,
      });
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
  });
});
