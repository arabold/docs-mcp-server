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

  it("should reject discovered links that escape the root via ..", async () => {
    const strategy = new LocalFileStrategy(appConfig);
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    // Set up a legitimate docs directory and a sensitive file outside it
    vol.fromJSON(
      {
        "/home/user/docs/readme.md": "# Docs",
        "/etc/passwd": "root:x:0:0:root:/root:/bin/bash",
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

    // Only readme.md should be processed, not /etc/passwd
    const processedUrls = progressCallback.mock.calls
      .filter((call) => call[0].result)
      .map((call) => call[0].currentUrl);
    expect(processedUrls).toContain("file:///home/user/docs/readme.md");
    expect(processedUrls).not.toContain("file:///etc/passwd");
  });

  it("should prevent reading files via percent-encoded traversal", async () => {
    const strategy = new LocalFileStrategy(appConfig);
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    vol.fromJSON(
      {
        "/etc/passwd": "root:x:0:0:root:/root:/bin/bash",
      },
      "/",
    );

    // Attempt to read /etc/passwd via percent-encoded traversal
    // URL constructor normalizes this to /etc/passwd, which is outside the root
    const options: ScraperOptions = {
      url: "file:///home/user/docs/%2e%2e/%2e%2e/%2e%2e/etc/passwd",
      library: "test",
      version: "1.0",
      maxPages: 1,
      maxDepth: 0,
    };

    await strategy.scrape(options, progressCallback);

    // Should NOT have processed the file with sensitive content
    const processedContent = progressCallback.mock.calls
      .filter((call) => call[0].result)
      .map((call) => call[0].result?.textContent);
    for (const content of processedContent) {
      expect(content).not.toContain("root:x:0:0");
    }
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

    // Single file as the root: the base dir is the file itself
    // so the file IS within its own base
    const options: ScraperOptions = {
      url: "file:///home/user/docs/readme.md",
      library: "test",
      version: "1.0",
      maxPages: 1,
      maxDepth: 0,
    };

    await strategy.scrape(options, progressCallback);

    // The file should still be processed
    expect(progressCallback).toHaveBeenCalled();
    const processed = progressCallback.mock.calls.filter((call) => call[0].result);
    expect(processed).toHaveLength(1);
    expect(processed[0][0].result?.textContent).toContain("Hello");
  });

  it("should block items from initialQueue that escape the root directory", async () => {
    const strategy = new LocalFileStrategy(appConfig);
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    vol.fromJSON(
      {
        "/home/user/docs/readme.md": "# Docs",
        "/etc/shadow": "root:$6$...:...",
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
          url: "file:///etc/shadow",
          depth: 1,
          pageId: 999,
        },
      ],
    };

    await strategy.scrape(options, progressCallback);

    // The /etc/shadow item should be blocked by containment check
    const processedUrls = progressCallback.mock.calls
      .filter((call) => call[0].result)
      .map((call) => call[0].currentUrl);
    expect(processedUrls).not.toContain("file:///etc/shadow");
  });
});
