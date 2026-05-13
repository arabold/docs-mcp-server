import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressCallback } from "../../types";
import { loadConfig } from "../../utils/config";
import type { ScraperOptions, ScraperProgressEvent } from "../types";
import { LocalFileStrategy } from "./LocalFileStrategy";

vi.mock("node:fs/promises", () => ({ default: vol.promises }));
vi.mock("node:fs");

describe("LocalFileStrategy path traversal protection", () => {
  const appConfig = loadConfig();

  beforeEach(() => {
    vol.reset();
  });

  it("should block items from initialQueue that contain .. traversal segments", async () => {
    const strategy = new LocalFileStrategy(appConfig);
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    vol.fromJSON(
      {
        "/home/user/docs/readme.md": "# Docs",
        "/tmp/sensitive/secret.txt": "sensitive-data-here",
      },
      "/",
    );

    const options: ScraperOptions = {
      url: "file:///home/user/docs",
      library: "test",
      version: "1.0",
      maxPages: 10,
      maxDepth: 3,
      initialQueue: [
        {
          url: "file:///home/user/docs/../../../tmp/sensitive/secret.txt",
          depth: 1,
          pageId: 100,
        },
      ],
    };

    await strategy.scrape(options, progressCallback);

    const processedUrls = progressCallback.mock.calls
      .filter((call) => call[0].result)
      .map((call) => call[0].currentUrl);
    // The traversal item should be blocked
    expect(processedUrls).not.toContain("file:///tmp/sensitive/secret.txt");
    expect(processedUrls).not.toContain("file:///home/user/docs/../../../tmp/sensitive/secret.txt");
    // Legitimate file should still be processed
    expect(processedUrls).toContain("file:///home/user/docs/readme.md");
  });

  it("should block initialQueue items with percent-encoded traversal against a legitimate root", async () => {
    const strategy = new LocalFileStrategy(appConfig);
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    vol.fromJSON(
      {
        "/home/user/docs/readme.md": "# Docs",
        "/tmp/sensitive/secret.txt": "sensitive-data-here",
      },
      "/",
    );

    const options: ScraperOptions = {
      url: "file:///home/user/docs",
      library: "test",
      version: "1.0",
      maxPages: 10,
      maxDepth: 3,
      initialQueue: [
        {
          url: "file:///home/user/docs/%2e%2e/%2e%2e/%2e%2e/tmp/sensitive/secret.txt",
          depth: 1,
          pageId: 100,
        },
      ],
    };

    await strategy.scrape(options, progressCallback);

    const processedUrls = progressCallback.mock.calls
      .filter((call) => call[0].result)
      .map((call) => call[0].currentUrl);
    expect(processedUrls).not.toContain("file:///tmp/sensitive/secret.txt");

    // Verify no sensitive content was processed
    const processedContent = progressCallback.mock.calls
      .filter((call) => call[0].result)
      .map((call) => call[0].result?.textContent);
    for (const content of processedContent) {
      expect(content).not.toContain("sensitive-data-here");
    }
  });

  it("should block absolute out-of-base paths in initialQueue", async () => {
    const strategy = new LocalFileStrategy(appConfig);
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    vol.fromJSON(
      {
        "/home/user/docs/readme.md": "# Docs",
        "/var/secrets/config.txt": "secret-config-value",
      },
      "/",
    );

    const options: ScraperOptions = {
      url: "file:///home/user/docs",
      library: "test",
      version: "1.0",
      maxPages: 10,
      maxDepth: 3,
      initialQueue: [
        {
          url: "file:///var/secrets/config.txt",
          depth: 1,
          pageId: 999,
        },
      ],
    };

    await strategy.scrape(options, progressCallback);

    const processedUrls = progressCallback.mock.calls
      .filter((call) => call[0].result)
      .map((call) => call[0].currentUrl);
    expect(processedUrls).not.toContain("file:///var/secrets/config.txt");
  });

  it("should allow reading files within the base directory", async () => {
    const strategy = new LocalFileStrategy(appConfig);
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    vol.fromJSON(
      {
        "/home/user/docs/guide.md": "# Guide\n\nSome content",
        "/home/user/docs/subdir/deep.md": "# Deep\n\nNested content",
      },
      "/",
    );

    const options: ScraperOptions = {
      url: "file:///home/user/docs",
      library: "test",
      version: "1.0",
      maxPages: 10,
      maxDepth: 3,
    };

    await strategy.scrape(options, progressCallback);

    const processedUrls = progressCallback.mock.calls
      .filter((call) => call[0].result)
      .map((call) => call[0].currentUrl);
    expect(processedUrls).toContain("file:///home/user/docs/guide.md");
    expect(processedUrls).toContain("file:///home/user/docs/subdir/deep.md");
  });

  it("should process a single file when it is the root URL", async () => {
    const strategy = new LocalFileStrategy(appConfig);
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    vol.fromJSON(
      {
        "/home/user/docs/readme.md": "# Hello\n\nWorld",
      },
      "/",
    );

    const options: ScraperOptions = {
      url: "file:///home/user/docs/readme.md",
      library: "test",
      version: "1.0",
      maxPages: 1,
      maxDepth: 0,
    };

    await strategy.scrape(options, progressCallback);

    expect(progressCallback).toHaveBeenCalled();
    const processed = progressCallback.mock.calls.filter((call) => call[0].result);
    expect(processed).toHaveLength(1);
    expect(processed[0][0].result?.textContent).toContain("Hello");
  });
});
