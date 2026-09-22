import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ScrapeResult } from "../scraper/types";
import type { Chunk } from "../splitter/types";
import { loadConfig } from "../utils/config";
import { DocumentStore } from "./DocumentStore";
import { PageNotFoundInStoreError, VersionNotFoundInStoreError } from "./errors";

function createMultiChunkScrapeResult(
  title: string,
  url: string,
  contents: string[],
): ScrapeResult {
  const chunks: Chunk[] = contents.map((c, i) => ({
    types: ["text"],
    content: c,
    section: { level: i, path: [`section-${i}`] },
  }));

  return {
    url,
    title,
    sourceContentType: "text/markdown",
    contentType: "text/markdown",
    textContent: contents.join("\n\n"),
    links: [],
    errors: [],
    chunks,
  } satisfies ScrapeResult;
}

describe("DocumentStore - getPageContent and listPages", () => {
  let tempDir: string;
  let documentStore: DocumentStore;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "doc-store-page-test-"));
    const dbPath = join(tempDir, "test.db");
    const config = loadConfig({
      app: { storePath: dbPath },
      scraper: { maxPages: 100, maxDepth: 3 },
    });
    documentStore = new DocumentStore(dbPath, config);
    await documentStore.initialize();
  });

  afterEach(async () => {
    if (documentStore) {
      await documentStore.shutdown();
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should throw VersionNotFoundInStoreError when library/version does not exist", async () => {
    await expect(
      documentStore.getPageContent("nonexistent", "1.0.0", "/docs/test"),
    ).rejects.toThrow(VersionNotFoundInStoreError);

    await expect(documentStore.listPages("nonexistent", "1.0.0")).rejects.toThrow(
      VersionNotFoundInStoreError,
    );
  });

  it("should throw PageNotFoundInStoreError when page does not exist in version", async () => {
    await documentStore.resolveVersionId("mylib", "1.0.0");
    await expect(
      documentStore.getPageContent("mylib", "1.0.0", "/missing-page"),
    ).rejects.toThrow(PageNotFoundInStoreError);
  });

  it("should store, retrieve full page content, and list pages correctly", async () => {
    const page1 = createMultiChunkScrapeResult(
      "Quickstart Guide",
      "https://example.com/docs/quickstart",
      ["# Quickstart", "Step 1: Install bun", "Step 2: Run server"],
    );

    const page2 = createMultiChunkScrapeResult(
      "API Reference",
      "https://example.com/docs/api/endpoints",
      ["# API Reference", "GET /v1/models"],
    );

    const otherPage = createMultiChunkScrapeResult(
      "About Us",
      "https://example.com/about",
      ["# About", "Our team info"],
    );

    await documentStore.addDocuments("mylib", "1.0.0", 1, page1);
    await documentStore.addDocuments("mylib", "1.0.0", 2, page2);
    await documentStore.addDocuments("mylib", "1.0.0", 1, otherPage);

    // Test exact URL match
    const resultExact = await documentStore.getPageContent(
      "mylib",
      "1.0.0",
      "https://example.com/docs/quickstart",
    );
    expect(resultExact.url).toBe("https://example.com/docs/quickstart");
    expect(resultExact.title).toBe("Quickstart Guide");
    expect(resultExact.chunksCount).toBe(3);
    expect(resultExact.content).toContain("# Quickstart");
    expect(resultExact.content).toContain("Step 1: Install bun");
    expect(resultExact.content).toContain("Step 2: Run server");
    expect(resultExact.truncated).toBe(false);

    // Test relative path match
    const resultRelative = await documentStore.getPageContent(
      "mylib",
      "1.0.0",
      "/docs/quickstart",
    );
    expect(resultRelative.url).toBe("https://example.com/docs/quickstart");

    // Test relative path with trailing slash querying non-trailing URL
    const resultTrailingSlashQuery = await documentStore.getPageContent(
      "mylib",
      "1.0.0",
      "/docs/quickstart/",
    );
    expect(resultTrailingSlashQuery.url).toBe("https://example.com/docs/quickstart");

    // Test querying without trailing slash when page was stored with trailing slash
    const pageWithSlash = createMultiChunkScrapeResult(
      "Changelog",
      "https://example.com/changelog/",
      ["# Changelog"],
    );
    await documentStore.addDocuments("mylib", "1.0.0", 1, pageWithSlash);

    const resultQueryWithoutSlash = await documentStore.getPageContent(
      "mylib",
      "1.0.0",
      "/changelog",
    );
    expect(resultQueryWithoutSlash.url).toBe("https://example.com/changelog/");

    // Test whitespace or empty pathOrUrl throws PageNotFoundInStoreError
    await expect(documentStore.getPageContent("mylib", "1.0.0", "")).rejects.toThrow(
      PageNotFoundInStoreError,
    );
    await expect(documentStore.getPageContent("mylib", "1.0.0", "   ")).rejects.toThrow(
      PageNotFoundInStoreError,
    );

    // Test angle brackets and quotes stripping
    const resultAngleBrackets = await documentStore.getPageContent(
      "mylib",
      "1.0.0",
      "<https://example.com/docs/quickstart>",
    );
    expect(resultAngleBrackets.url).toBe("https://example.com/docs/quickstart");

    const resultDoubleQuotes = await documentStore.getPageContent(
      "mylib",
      "1.0.0",
      '"https://example.com/docs/quickstart"',
    );
    expect(resultDoubleQuotes.url).toBe("https://example.com/docs/quickstart");

    const resultSingleQuotes = await documentStore.getPageContent(
      "mylib",
      "1.0.0",
      "'https://example.com/docs/quickstart'",
    );
    expect(resultSingleQuotes.url).toBe("https://example.com/docs/quickstart");

    // Test query params and anchor hash stripping
    const resultQueryParams = await documentStore.getPageContent(
      "mylib",
      "1.0.0",
      "/docs/quickstart?utm=test&lang=en#intro",
    );
    expect(resultQueryParams.url).toBe("https://example.com/docs/quickstart");

    // Test relative paths ./ and ../ stripping
    const resultDotSlash = await documentStore.getPageContent(
      "mylib",
      "1.0.0",
      "./docs/quickstart",
    );
    expect(resultDotSlash.url).toBe("https://example.com/docs/quickstart");

    const resultDotDotSlash = await documentStore.getPageContent(
      "mylib",
      "1.0.0",
      "../docs/quickstart",
    );
    expect(resultDotDotSlash.url).toBe("https://example.com/docs/quickstart");

    // Test URL-encoded path decoding
    const resultEncoded = await documentStore.getPageContent(
      "mylib",
      "1.0.0",
      "%2Fdocs%2Fquickstart",
    );
    expect(resultEncoded.url).toBe("https://example.com/docs/quickstart");

    // Test suggestions when page is not found
    try {
      await documentStore.getPageContent("mylib", "1.0.0", "/docs/quick");
      expect.unreachable("Should have thrown PageNotFoundInStoreError");
    } catch (err: any) {
      expect(err).toBeInstanceOf(PageNotFoundInStoreError);
      expect(err.suggestions).toBeDefined();
      expect(err.suggestions.length).toBeGreaterThan(0);
      expect(err.suggestions).toContain("https://example.com/docs/quickstart");
      expect(err.message).toContain("Did you mean:");
      expect(err.message).toContain("https://example.com/docs/quickstart");
    }

    // Test truncation with maxChars
    const resultTruncated = await documentStore.getPageContent(
      "mylib",
      "1.0.0",
      "/docs/quickstart",
      { maxChars: 12 },
    );
    expect(resultTruncated.content.length).toBe(12);
    expect(resultTruncated.truncated).toBe(true);

    // Test listPages without prefix
    const listAll = await documentStore.listPages("mylib", "1.0.0", {
      limit: 10,
      offset: 0,
    });
    expect(listAll.total).toBe(4);
    expect(listAll.pages.length).toBe(4);
    expect(listAll.hasMore).toBe(false);

    // Test listPages with prefix filter
    const listDocs = await documentStore.listPages("mylib", "1.0.0", { prefix: "/docs" });
    expect(listDocs.total).toBe(2);
    expect(listDocs.pages.length).toBe(2);
    expect(listDocs.pages.some((p) => p.title === "Quickstart Guide")).toBe(true);
    expect(listDocs.pages.some((p) => p.title === "API Reference")).toBe(true);
    expect(listDocs.pages.some((p) => p.title === "About Us")).toBe(false);

    // Test prefix filter with unescaped wildcards does not match arbitrarily
    const listWildcard = await documentStore.listPages("mylib", "1.0.0", { prefix: "%" });
    expect(listWildcard.total).toBe(0);

    // Test pagination (limit 1, offset 0)
    const listPaged1 = await documentStore.listPages("mylib", "1.0.0", {
      limit: 1,
      offset: 0,
    });
    expect(listPaged1.pages.length).toBe(1);
    expect(listPaged1.total).toBe(4);
    expect(listPaged1.hasMore).toBe(true);

    // Test pagination (limit 1, offset 3)
    const listPaged2 = await documentStore.listPages("mylib", "1.0.0", {
      limit: 1,
      offset: 3,
    });
    expect(listPaged2.pages.length).toBe(1);
    expect(listPaged2.hasMore).toBe(false);
  });

  it("should truncate correctly when maxChars <= 500 and no newline exists in slice", async () => {
    const pageDense = createMultiChunkScrapeResult(
      "Dense Doc",
      "https://example.com/dense",
      ["A".repeat(1000)],
    );
    await documentStore.addDocuments("mylib", "1.0.0", 1, pageDense);
    const result = await documentStore.getPageContent(
      "mylib",
      "1.0.0",
      "https://example.com/dense",
      { maxChars: 200 },
    );
    expect(result.content.length).toBe(200);
    expect(result.truncated).toBe(true);
  });

  it("should not collapse truncation to document header when maxChars <= 500", async () => {
    const pageHeader = createMultiChunkScrapeResult(
      "Header Doc",
      "https://example.com/header",
      [`# Title\n${"A".repeat(500)}`],
    );
    await documentStore.addDocuments("mylib", "1.0.0", 1, pageHeader);
    const result = await documentStore.getPageContent(
      "mylib",
      "1.0.0",
      "https://example.com/header",
      { maxChars: 200 },
    );
    // Should NOT collapse to 7 chars (# Title)
    expect(result.content.length).toBe(200);
    expect(result.truncated).toBe(true);
  });

  it("should match hash-routed SPA pages without stripping hash", async () => {
    const pageWithHash = createMultiChunkScrapeResult(
      "SPA Hash Page",
      "https://example.com/app#/guide",
      ["# SPA Guide"],
    );
    await documentStore.addDocuments("mylib", "1.0.0", 1, pageWithHash);
    const result = await documentStore.getPageContent(
      "mylib",
      "1.0.0",
      "https://example.com/app#/guide",
    );
    expect(result.url).toBe("https://example.com/app#/guide");
  });

  it("should normalize Windows backslash paths in getPageContent", async () => {
    const page = createMultiChunkScrapeResult(
      "Windows Test",
      "https://example.com/docs/windows",
      ["# Windows Guide"],
    );
    await documentStore.addDocuments("mylib", "1.0.0", 1, page);
    const result = await documentStore.getPageContent(
      "mylib",
      "1.0.0",
      ".\\docs\\windows",
    );
    expect(result.url).toBe("https://example.com/docs/windows");
  });
});
