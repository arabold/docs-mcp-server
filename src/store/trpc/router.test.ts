import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBusService } from "../../events";
import type { Chunk } from "../../splitter/types";
import { loadConfig } from "../../utils/config";
import type { DocumentManagementService } from "../DocumentManagementService";
import { createLocalDocumentManagement } from "../index";
import { dataRouter } from "./router";

/**
 * Builds a minimal chunk list for seeding a page via `addScrapeResult`.
 */
function buildChunks(contents: string[]): Chunk[] {
  return contents.map((content, index) => ({
    types: ["text"],
    content,
    section: { level: 0, path: [`section${index}`] },
  }));
}

/**
 * Integration tests for the chunk explorer procedures (`listVersionChunks`,
 * `getVersionStats`) exercised through the real tRPC router, a real
 * `DocumentManagementService`, and a real in-memory SQLite store — no mocks.
 */
describe("dataRouter - chunk explorer procedures", () => {
  let docService: DocumentManagementService;
  let caller: ReturnType<typeof dataRouter.createCaller>;

  beforeEach(async () => {
    const appConfig = loadConfig();
    appConfig.app.storePath = ":memory:";
    appConfig.app.embeddingModel = ""; // FTS-only: no external credentials required

    const eventBus = new EventBusService();
    docService = await createLocalDocumentManagement(eventBus, appConfig);
    caller = dataRouter.createCaller({ docService });

    // Page 1: two chunks
    await docService.addScrapeResult("router-test-lib", "1.0.0", 1, {
      url: "https://example.com/page1",
      title: "Page 1",
      sourceContentType: "text/html",
      contentType: "text/html",
      textContent: "irrelevant",
      links: [],
      errors: [],
      chunks: buildChunks(["Alpha content about routers", "Beta content about switches"]),
    });

    // Page 2: one chunk
    await docService.addScrapeResult("router-test-lib", "1.0.0", 1, {
      url: "https://example.com/page2",
      title: "Page 2",
      sourceContentType: "text/html",
      contentType: "text/html",
      textContent: "irrelevant",
      links: [],
      errors: [],
      chunks: buildChunks(["Gamma content about gateways"]),
    });
  });

  afterEach(async () => {
    await docService.shutdown();
  });

  describe("listVersionChunks", () => {
    it("returns paginated chunks with position/total metadata", async () => {
      const firstPage = await caller.listVersionChunks({
        library: "router-test-lib",
        version: "1.0.0",
        limit: 2,
        offset: 0,
      });

      expect(firstPage.total).toBe(3);
      expect(firstPage.chunks).toHaveLength(2);

      const secondPage = await caller.listVersionChunks({
        library: "router-test-lib",
        version: "1.0.0",
        limit: 2,
        offset: 2,
      });
      expect(secondPage.chunks).toHaveLength(1);

      const page1Chunks = [...firstPage.chunks, ...secondPage.chunks].filter(
        (c) => c.url === "https://example.com/page1",
      );
      expect(page1Chunks).toHaveLength(2);
      expect(page1Chunks.map((c) => c.chunkIndex).sort()).toEqual([1, 2]);
      expect(page1Chunks.every((c) => c.pageChunkCount === 2)).toBe(true);

      // Token counts are never fabricated; the schema has no per-chunk token column.
      for (const chunk of [...firstPage.chunks, ...secondPage.chunks]) {
        expect(chunk.tokenCount).toBeNull();
        expect(chunk.mimeType).toBe("text/html");
        expect(chunk.charCount).toBe(chunk.content.length);
      }
    });

    it("applies the content filter", async () => {
      const result = await caller.listVersionChunks({
        library: "router-test-lib",
        version: "1.0.0",
        limit: 10,
        filter: "gateways",
      });

      expect(result.total).toBe(1);
      expect(result.chunks[0].content).toContain("gateways");
    });

    it("defaults limit to 50 when omitted", async () => {
      const result = await caller.listVersionChunks({
        library: "router-test-lib",
        version: "1.0.0",
      });

      expect(result.total).toBe(3);
      expect(result.chunks).toHaveLength(3);
    });

    it("rejects an empty library name via zod validation", async () => {
      await expect(
        caller.listVersionChunks({ library: "", version: "1.0.0" }),
      ).rejects.toThrow();
    });
  });

  describe("getVersionStats", () => {
    it("returns aggregate stats for the version", async () => {
      const stats = await caller.getVersionStats({
        library: "router-test-lib",
        version: "1.0.0",
      });

      expect(stats.pageCount).toBe(2);
      expect(stats.chunkCount).toBe(3);
      expect(stats.avgChunksPerPage).toBeCloseTo(1.5);
      expect(stats.avgTokensPerChunk).toBeNull();
      // FTS-only mode: no embeddings were generated.
      expect(stats.embeddedChunkCount).toBe(0);
    });

    it("returns zeroed stats for a version that was never indexed", async () => {
      const stats = await caller.getVersionStats({
        library: "router-test-lib",
        version: "9.9.9",
      });

      expect(stats).toEqual({
        pageCount: 0,
        chunkCount: 0,
        avgChunksPerPage: null,
        avgTokensPerChunk: null,
        embeddedChunkCount: 0,
      });
    });
  });
});
