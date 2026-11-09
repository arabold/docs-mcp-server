import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressCallback } from "../types";
import type { ScraperRegistry } from "./ScraperRegistry";
import { ScraperService } from "./ScraperService";
import type { ScraperOptions, ScraperProgressEvent } from "./types";

describe("ScraperService", () => {
  const mockRegistry = {
    getStrategy: vi.fn(),
  };

  const mockStrategy = {
    scrape: vi.fn(),
    cleanup: vi.fn(),
  };

  const options: ScraperOptions = {
    url: "https://example.com",
    library: "test",
    version: "1.0",
    maxPages: 10,
    maxDepth: 1,
  };

  beforeEach(() => {
    mockRegistry.getStrategy.mockReset();
    mockStrategy.scrape.mockReset();
    mockStrategy.cleanup.mockReset();
    mockRegistry.getStrategy.mockReturnValue(mockStrategy);
  });

  it("should cleanup strategy after successful scrape", async () => {
    const service = new ScraperService(mockRegistry as unknown as ScraperRegistry);
    const progressCallback: ProgressCallback<ScraperProgressEvent> = vi.fn();

    mockStrategy.scrape.mockResolvedValue(undefined);

    await service.scrape(options, progressCallback);

    expect(mockStrategy.cleanup).toHaveBeenCalledOnce();
  });

  it("cleans up after a failed scrape and rejects with the scrape error even when cleanup fails", async () => {
    const service = new ScraperService(mockRegistry as unknown as ScraperRegistry);
    const progressCallback: ProgressCallback<ScraperProgressEvent> = vi.fn();

    mockStrategy.scrape.mockRejectedValue(new Error("Strategy error"));
    mockStrategy.cleanup.mockRejectedValue(new Error("Cleanup error"));

    await expect(service.scrape(options, progressCallback)).rejects.toThrow(
      "Strategy error",
    );
    expect(mockStrategy.cleanup).toHaveBeenCalledOnce();
  });
});
