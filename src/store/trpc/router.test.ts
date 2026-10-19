import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBusService } from "../../events";
import type { Chunk } from "../../splitter/types";
import { loadConfig } from "../../utils/config";
import { DocumentManagementService } from "../DocumentManagementService";
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
 * Integration tests for the data router's own behavior (input validation and
 * defaults) plus one round trip per procedure, through a real
 * `DocumentManagementService` and a real in-memory SQLite store — no mocks.
 */
describe("dataRouter", () => {
  let docService: DocumentManagementService;
  let caller: ReturnType<typeof dataRouter.createCaller>;

  beforeEach(async () => {
    const appConfig = loadConfig();
    appConfig.app.storePath = ":memory:";
    appConfig.app.embeddingModel = ""; // FTS-only: no external credentials required

    const eventBus = new EventBusService();
    docService = new DocumentManagementService(eventBus, appConfig);
    await docService.initialize();
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

  it("passes each procedure's input to the service and returns its result", async () => {
    const chunks = await caller.listVersionChunks({
      library: "router-test-lib",
      version: "1.0.0",
      limit: 2,
      offset: 1,
      filter: "content",
    });
    expect(chunks.total).toBe(3);
    expect(chunks.chunks.map((chunk) => chunk.content)).toEqual([
      "Beta content about switches",
      "Gamma content about gateways",
    ]);

    expect(
      await caller.getVersionStats({ library: "router-test-lib", version: "1.0.0" }),
    ).toMatchObject({ pageCount: 2, chunkCount: 3, embeddedChunkCount: 0 });
    expect(
      await caller.getVersionStats({ library: "router-test-lib", version: "9.9.9" }),
    ).toEqual({
      pageCount: 0,
      chunkCount: 0,
      avgChunksPerPage: null,
      avgTokensPerChunk: null,
      embeddedChunkCount: 0,
    });

    expect(await caller.compact({ force: true })).toMatchObject({
      skipped: true,
      vacuumed: false,
    });

    expect(
      await caller.getPageContent({
        library: "router-test-lib",
        version: "1.0.0",
        pathOrUrl: "/page1",
        options: { maxChars: 20 },
      }),
    ).toMatchObject({
      url: "https://example.com/page1",
      title: "Page 1",
      content: "Alpha content about routers",
      totalChunks: 2,
      nextChunk: 1,
    });

    const pages = await caller.listPages({
      library: "router-test-lib",
      version: "1.0.0",
      options: { contains: "page2", limit: 10, offset: 0 },
    });
    expect(pages.total).toBe(1);
    expect(pages.pages.map((page) => page.url)).toEqual(["https://example.com/page2"]);
    expect(pages.hasMore).toBe(false);
  });

  it("defaults the chunk explorer limit to 50 when omitted", async () => {
    await docService.addScrapeResult("router-test-lib", "1.0.0", 1, {
      url: "https://example.com/page3",
      title: "Page 3",
      sourceContentType: "text/html",
      contentType: "text/html",
      textContent: "irrelevant",
      links: [],
      errors: [],
      chunks: buildChunks(Array.from({ length: 48 }, (_, i) => `Filler chunk ${i}`)),
    });

    const result = await caller.listVersionChunks({
      library: "router-test-lib",
      version: "1.0.0",
    });

    expect(result.total).toBe(51);
    expect(result.chunks).toHaveLength(50);
  });

  it("rejects empty or blank required input with BAD_REQUEST", async () => {
    const cases: [label: string, call: () => Promise<unknown>][] = [
      [
        "an empty library for listVersionChunks",
        () => caller.listVersionChunks({ library: "", version: "1.0.0" }),
      ],
      [
        "an empty library for getPageContent",
        () => caller.getPageContent({ library: "", pathOrUrl: "/page1" }),
      ],
      [
        "an empty pathOrUrl",
        () => caller.getPageContent({ library: "router-test-lib", pathOrUrl: "" }),
      ],
      // A whitespace-only pathOrUrl is rejected instead of passed on as empty
      [
        "a whitespace-only pathOrUrl",
        () => caller.getPageContent({ library: "router-test-lib", pathOrUrl: "   " }),
      ],
    ];

    for (const [label, call] of cases) {
      await expect.soft(call(), label).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });
});
