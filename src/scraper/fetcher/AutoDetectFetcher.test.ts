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

  it("falls back to the browser fetcher on a TLS error, a challenge, a 403 or a 429", async () => {
    const cases: Array<{ label: string; error: Error }> = [
      {
        label: "a TLS certificate error",
        error: new TlsCertificateError(source, "UNABLE_TO_VERIFY_LEAF_SIGNATURE"),
      },
      { label: "a challenge", error: new ChallengeError(source, 403, "cloudflare") },
      ...[403, 429].map((statusCode) => ({
        label: `a ${statusCode} response`,
        error: new HttpStatusError(
          `Failed to fetch ${source} after 1 attempts: Request failed with status code ${statusCode}`,
          true,
          statusCode,
        ),
      })),
    ];

    for (const { label, error } of cases) {
      vi.restoreAllMocks();
      vi.spyOn(HttpFetcher.prototype, "fetch").mockRejectedValue(error);
      const browserSpy = vi
        .spyOn(BrowserFetcher.prototype, "fetch")
        .mockResolvedValue(browserResult);

      const result = await new AutoDetectFetcher(scraperConfig).fetch(source);

      expect.soft(result, label).toBe(browserResult);
      expect.soft(browserSpy, label).toHaveBeenCalledWith(source, undefined);
    }
  });

  it("should fail with the challenge when the browser does not get past it either", async () => {
    vi.spyOn(HttpFetcher.prototype, "fetch").mockRejectedValue(
      new ChallengeError(source, 200, "fastly"),
    );
    const browserError = new ChallengeError(source, 200, "fastly");
    const browserSpy = vi
      .spyOn(BrowserFetcher.prototype, "fetch")
      .mockRejectedValue(browserError);

    const fetcher = new AutoDetectFetcher(scraperConfig);

    await expect(fetcher.fetch(source)).rejects.toBe(browserError);
    expect(browserSpy).toHaveBeenCalledTimes(1);
  });

  it("rethrows any other failure without falling back", async () => {
    const cases: Array<{ label: string; url: string; error: Error }> = [
      {
        // The error message embeds the source url, so a substring check would
        // misread this connection failure as an anti-bot block.
        label: "a connection failure whose url mentions 403",
        url: "https://example.com/errors/403",
        error: new ScraperError(
          "Failed to fetch https://example.com/errors/403 after 3 attempts: connect ECONNREFUSED",
          true,
        ),
      },
      { label: "a 404", url: source, error: new HttpStatusError("not found", true, 404) },
      { label: "an unexpected error", url: source, error: new Error("boom") },
    ];

    for (const { label, url, error } of cases) {
      vi.restoreAllMocks();
      vi.spyOn(HttpFetcher.prototype, "fetch").mockRejectedValue(error);
      const browserSpy = vi.spyOn(BrowserFetcher.prototype, "fetch");

      await expect
        .soft(new AutoDetectFetcher(scraperConfig).fetch(url), label)
        .rejects.toBe(error);
      expect.soft(browserSpy, label).not.toHaveBeenCalled();
    }
  });
});
