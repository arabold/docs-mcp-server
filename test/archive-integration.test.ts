import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { LocalFileStrategy } from "../src/scraper/strategies/LocalFileStrategy";
import type { AppConfig } from "../src/utils/config";
import { FetchStatus } from "../src/scraper/fetcher/types";

const FIXTURES_DIR = path.join(__dirname, "fixtures");
const ZIP_PATH = path.join(FIXTURES_DIR, "test-archive.zip");

describe("LocalFileStrategy - Archive Integration", () => {
  let strategy: LocalFileStrategy;

  beforeAll(async () => {
    if (!fs.existsSync(FIXTURES_DIR)) {
      fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    }

    // Create a zip file with some content
    const output = fs.createWriteStream(ZIP_PATH);
    const archive = archiver("zip", { zlib: { level: 9 } });

    await new Promise<void>((resolve, reject) => {
      output.on("close", resolve);
      archive.on("error", reject);
      archive.pipe(output);
      archive.append("Hello World", { name: "hello.txt" });
      archive.append("Nested Content", { name: "folder/nested.txt" });
      archive.finalize();
    });

    const config = {
      scraper: {
        maxPages: 100,
        timeout: 10000,
        userAgent: "test-bot",
        allowedDomains: [],
        document: {
            maxSize: 1024 * 1024,
        },
      },
      splitter: {
          maxChunkSize: 1000,
          json: {
              maxNestingDepth: 10,
          }
      },
    } as unknown as AppConfig;
    strategy = new LocalFileStrategy(config);
  });

  afterAll(() => {
    if (fs.existsSync(ZIP_PATH)) {
      fs.unlinkSync(ZIP_PATH);
    }
  });

  it("should list files in a local zip archive", async () => {
    const url = `file://${ZIP_PATH}`;
    const result = await strategy.processItem(
        { url, depth: 0 } as any, 
        { url, includePatterns: [], excludePatterns: [], library: "test-lib", version: "1.0.0" } as any
    );

    expect(result.status).toBe(FetchStatus.SUCCESS);
    expect(result.links).toContain(`file://${ZIP_PATH}/hello.txt`);
    expect(result.links).toContain(`file://${ZIP_PATH}/folder/nested.txt`);
  });

  it("should read file content from inside zip", async () => {
    const url = `file://${ZIP_PATH}/hello.txt`;
    const result = await strategy.processItem(
        { url, depth: 1 } as any, 
        { url: `file://${ZIP_PATH}`, includePatterns: [], excludePatterns: [], library: "test-lib", version: "1.0.0" } as any
    );

    expect(result.status).toBe(FetchStatus.SUCCESS);
    expect(result.content?.textContent?.trim()).toContain("Hello World");
  });
});
