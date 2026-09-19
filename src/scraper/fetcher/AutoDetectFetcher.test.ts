import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../utils/config";
import {
  ChallengeError,
  HttpStatusError,
  ScraperError,
  TlsCertificateError,
} from "../../utils/errors";
import { AutoDetectFetcher } from "./AutoDetectFetcher";
import { BrowserFetcher } from "./BrowserFetcher";
import { HttpFetcher } from "./HttpFetcher";
import { FetchStatus } from "./types";

describe("AutoDetectFetcher", () => {
  const scraperConfig = loadConfig().scraper;
  const source = "https://example.com/docs";
  const browserResult = {
    content: Buffer.from("browser", "utf-8"),
    mimeType: "text/html",
    source,
    status: FetchStatus.SUCCESS,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should fall back to browser fetcher on TLS certificate errors", async () => {
    vi.spyOn(HttpFetcher.prototype, "fetch").mockRejectedValue(
      new TlsCertificateError(source, "UNABLE_TO_VERIFY_LEAF_SIGNATURE"),
    );
    const browserSpy = vi
      .spyOn(BrowserFetcher.prototype, "fetch")
      .mockResolvedValue(browserResult);

    const fetcher = new AutoDetectFetcher(scraperConfig);
    const result = await fetcher.fetch(source);

    expect(result).toBe(browserResult);
    expect(browserSpy).toHaveBeenCalledWith(source, undefined);
  });

  it("should fall back to browser fetcher on challenge errors", async () => {
    vi.spyOn(HttpFetcher.prototype, "fetch").mockRejectedValue(
      new ChallengeError(source, 403, "cloudflare"),
    );
    const browserSpy = vi
      .spyOn(BrowserFetcher.prototype, "fetch")
      .mockResolvedValue(browserResult);

    const fetcher = new AutoDetectFetcher(scraperConfig);
    const result = await fetcher.fetch(source);

    expect(result).toBe(browserResult);
    expect(browserSpy).toHaveBeenCalledWith(source, undefined);
  });

  it.each([403, 429])(
    "should fall back to browser fetcher on a %i response",
    async (statusCode) => {
      vi.spyOn(HttpFetcher.prototype, "fetch").mockRejectedValue(
        new HttpStatusError(
          `Failed to fetch ${source} after 1 attempts: Request failed with status code ${statusCode}`,
          true,
          statusCode,
        ),
      );
      const browserSpy = vi
        .spyOn(BrowserFetcher.prototype, "fetch")
        .mockResolvedValue(browserResult);

      const fetcher = new AutoDetectFetcher(scraperConfig);

      expect(await fetcher.fetch(source)).toBe(browserResult);
      expect(browserSpy).toHaveBeenCalledWith(source, undefined);
    },
  );

  it("should not fall back when a non-anti-bot failure mentions 403 in the url", async () => {
    // The error message embeds the source url, so a substring check would
    // misread this connection failure as an anti-bot block.
    const errorSource = "https://example.com/errors/403";
    const error = new ScraperError(
      `Failed to fetch ${errorSource} after 3 attempts: connect ECONNREFUSED`,
      true,
    );
    vi.spyOn(HttpFetcher.prototype, "fetch").mockRejectedValue(error);
    const browserSpy = vi.spyOn(BrowserFetcher.prototype, "fetch");

    const fetcher = new AutoDetectFetcher(scraperConfig);

    await expect(fetcher.fetch(errorSource)).rejects.toThrow(error);
    expect(browserSpy).not.toHaveBeenCalled();
  });

  it("should not fall back on a 404", async () => {
    const error = new HttpStatusError("not found", true, 404);
    vi.spyOn(HttpFetcher.prototype, "fetch").mockRejectedValue(error);
    const browserSpy = vi.spyOn(BrowserFetcher.prototype, "fetch");

    const fetcher = new AutoDetectFetcher(scraperConfig);

    await expect(fetcher.fetch(source)).rejects.toThrow(error);
    expect(browserSpy).not.toHaveBeenCalled();
  });

  it("should rethrow non-fallback errors", async () => {
    const error = new Error("boom");
    vi.spyOn(HttpFetcher.prototype, "fetch").mockRejectedValue(error);
    const browserSpy = vi.spyOn(BrowserFetcher.prototype, "fetch");

    const fetcher = new AutoDetectFetcher(scraperConfig);

    await expect(fetcher.fetch(source)).rejects.toThrow(error);
    expect(browserSpy).not.toHaveBeenCalled();
  });
});
