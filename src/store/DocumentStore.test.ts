import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Embeddings } from "@langchain/core/embeddings";
import type { Database as DatabaseType, Statement } from "better-sqlite3";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockedFunction,
  vi,
} from "vitest";
import type { ScrapeResult } from "../scraper/types";
import type { Chunk } from "../splitter/types";
import { type AppConfig, loadConfig, markVectorDimensionSource } from "../utils/config";
import { logger } from "../utils/logger";
import { DocumentRetrieverService } from "./DocumentRetrieverService";
import { DocumentStore } from "./DocumentStore";
import { EmbeddingConfig } from "./embeddings/EmbeddingConfig";
import {
  DimensionError,
  EmbeddingModelChangedError,
  InvalidLibraryNameError,
  LibraryAlreadyExistsError,
} from "./errors";
import { VersionStatus } from "./types";

const mockEmbeddingDimension = vi.hoisted(() => ({ value: 1536 }));
const mockEmbeddingCalls = vi.hoisted(() => ({ query: 0, documents: 0 }));

// Mock only the embedding service to generate deterministic embeddings for testing
// This allows us to test ranking logic while using real SQLite database
vi.mock("./embeddings/EmbeddingFactory", async () => {
  const actual = await vi.importActual<typeof import("./embeddings/EmbeddingFactory")>(
    "./embeddings/EmbeddingFactory",
  );

  return {
    ...actual,
    createEmbeddingModel: () => ({
      embedQuery: vi.fn(async (text: string) => {
        mockEmbeddingCalls.query += 1;
        // Generate deterministic embeddings based on text content for consistent testing
        const words = text.toLowerCase().split(/\s+/);
        const embedding = new Array(mockEmbeddingDimension.value).fill(0);

        // Create meaningful semantic relationships for testing
        words.forEach((word, wordIndex) => {
          const wordHash = Array.from(word).reduce(
            (acc, char) => acc + char.charCodeAt(0),
            0,
          );
          const baseIndex = (wordHash % 100) * 15; // Distribute across embedding dimensions

          for (let i = 0; i < 15; i++) {
            const index = (baseIndex + i) % mockEmbeddingDimension.value;
            embedding[index] += 1.0 / (wordIndex + 1); // Earlier words get higher weight
          }
        });

        // Normalize the embedding
        const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
        return magnitude > 0 ? embedding.map((val) => val / magnitude) : embedding;
      }),
      embedDocuments: vi.fn(async (texts: string[]) => {
        mockEmbeddingCalls.documents += 1;
        // Generate embeddings for each text using the same logic as embedQuery
        return texts.map((text) => {
          const words = text.toLowerCase().split(/\s+/);
          const embedding = new Array(mockEmbeddingDimension.value).fill(0);

          words.forEach((word, wordIndex) => {
            const wordHash = Array.from(word).reduce(
              (acc, char) => acc + char.charCodeAt(0),
              0,
            );
            const baseIndex = (wordHash % 100) * 15;

            for (let i = 0; i < 15; i++) {
              const index = (baseIndex + i) % mockEmbeddingDimension.value;
              embedding[index] += 1.0 / (wordIndex + 1);
            }
          });

          const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
          return magnitude > 0 ? embedding.map((val) => val / magnitude) : embedding;
        });
      }),
    }),
  };
});

/**
 * Returns a fresh config with the given embedding model, so that no describe
 * block depends on the mode another one left behind.
 */
function configWith(embeddingModel: string): AppConfig {
  const config = loadConfig();
  config.app.embeddingModel = embeddingModel;
  return config;
}

/**
 * Helper function to create minimal ScrapeResult for testing.
 * Converts simplified test data to the ScrapeResult format expected by addDocuments.
 */
function createScrapeResult(
  title: string,
  url: string,
  content: string,
  path: string[] = [],
  options?: {
    etag?: string | null;
    lastModified?: string | null;
  },
): ScrapeResult {
  const chunks: Chunk[] = [
    {
      types: ["text"],
      content,
      section: { level: 0, path },
    },
  ];

  return {
    url,
    title,
    sourceContentType: "text/html",
    contentType: "text/html",
    textContent: content,
    links: [],
    errors: [],
    chunks,
    etag: options?.etag,
    lastModified: options?.lastModified,
  } satisfies ScrapeResult;
}

/**
 * Returns the store's embedding model, and fails the test when embeddings are
 * disabled so that an embedding test cannot pass without exercising them.
 */
function embeddingsOf(store: DocumentStore): Embeddings {
  // @ts-expect-error Accessing private property for testing
  const embeddings: Embeddings | null = store.embeddings;
  if (!embeddings) {
    throw new Error("Embeddings are not enabled for this store");
  }
  return embeddings;
}

/**
 * Runs `action` and returns its result together with the query plan of the
 * first statement it ran whose SQL contains `sqlFragment`, bound to the same
 * parameters. Throws when no such statement ran.
 */
async function queryPlanOf<T>(
  store: DocumentStore,
  sqlFragment: string,
  action: () => Promise<T>,
): Promise<{ result: T; plan: string[] }> {
  // @ts-expect-error Accessing private property for testing
  const db: DatabaseType = store.db;
  const statementPrototype: Statement = Object.getPrototypeOf(db.prepare("SELECT 1"));
  const all = vi.spyOn(statementPrototype, "all");
  let result: T;
  let captured: { source: string; params: unknown[] } | undefined;
  try {
    result = await action();
    const statements = all.mock.contexts as Statement[];
    const call = statements.findIndex((statement) =>
      statement.source.includes(sqlFragment),
    );
    if (call >= 0) {
      captured = { source: statements[call].source, params: all.mock.calls[call] };
    }
  } finally {
    all.mockRestore();
  }
  if (!captured) {
    throw new Error(`No statement containing "${sqlFragment}" ran`);
  }
  const plan = db
    .prepare(`EXPLAIN QUERY PLAN ${captured.source}`)
    .all(...captured.params) as { detail: string }[];
  return { result, plan: plan.map((row) => row.detail) };
}

/**
 * Asserts that a full-text plan filters by version from the covering indexes
 * before it reads any document, and that the match runs once rather than once
 * per chunk id (`0:=M` means SQLite handed the id list to FTS5).
 */
function expectVersionFilteredFullTextPlan(plan: string[]): void {
  expect(plan).toContainEqual(expect.stringMatching(/^SCAN f VIRTUAL TABLE INDEX 0:M\d/));
  expect(plan).toContain(
    "SEARCH vd USING COVERING INDEX idx_documents_sort_order (page_id=?)",
  );
}

/**
 * Tests for DocumentStore with embeddings enabled
 * Uses explicit embedding configuration and tests hybrid search functionality
 */
describe("DocumentStore - With Embeddings", () => {
  let store: DocumentStore;
  let appConfig: AppConfig;

  beforeEach(async () => {
    mockEmbeddingDimension.value = 1536;
    // The provider only needs a key to be present; the embedding model is mocked
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    appConfig = configWith("openai:text-embedding-3-small");

    // Create a fresh in-memory database for each test with explicit config
    store = new DocumentStore(":memory:", appConfig);
    await store.initialize();
  });

  afterEach(async () => {
    if (store) {
      await store.shutdown();
    }
    vi.unstubAllEnvs();
  });

  describe("Document Storage and Retrieval", () => {
    it("stores each embedding as a float32 blob identical to its indexed vector", async () => {
      await store.addDocuments(
        "bloblib",
        "1.0.0",
        1,
        createScrapeResult(
          "Blob Storage",
          "https://example.com/blob-storage",
          "Embeddings are stored in their binary form",
        ),
      );

      // @ts-expect-error Accessing private property for testing
      const db = store.db;
      const rows = db
        .prepare(`
          SELECT typeof(d.embedding) AS type, length(d.embedding) AS bytes,
                 (SELECT dv.embedding FROM documents_vec dv WHERE dv.rowid = d.id)
                   = d.embedding AS matchesIndex
          FROM documents d
        `)
        .all() as Array<{ type: string; bytes: number; matchesIndex: number }>;

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row).toEqual({ type: "blob", bytes: 1536 * 4, matchesIndex: 1 });
      }
    });

    it("removes a version with its pages, and the library with its last version", async () => {
      await store.addDocuments(
        "removelib",
        "1.0.0",
        1,
        createScrapeResult("V1 Doc", "https://example.com/v1", "Version 1 document"),
      );
      for (const page of ["doc1", "doc2"]) {
        await store.addDocuments(
          "removelib",
          "2.0.0",
          1,
          createScrapeResult(page, `https://example.com/${page}`, `${page} for removal`),
        );
      }

      expect(await store.removeVersion("removelib", "1.0.0", true)).toEqual({
        documentsDeleted: 1,
        versionDeleted: true,
        libraryDeleted: false,
      });
      expect(await store.checkDocumentExists("removelib", "1.0.0")).toBe(false);
      expect(await store.checkDocumentExists("removelib", "2.0.0")).toBe(true);

      expect(await store.removeVersion("removelib", "2.0.0", true)).toEqual({
        documentsDeleted: 2,
        versionDeleted: true,
        libraryDeleted: true,
      });
      expect(await store.checkDocumentExists("removelib", "2.0.0")).toBe(false);
    });

    it("aggregates per-day indexing activity from page and chunk timestamps", async () => {
      await store.addDocuments(
        "activitylib",
        "1.0.0",
        1,
        createScrapeResult("Page One", "https://example.com/one", "First activity page", [
          "a",
        ]),
      );
      await store.addDocuments(
        "activitylib",
        "1.0.0",
        1,
        createScrapeResult(
          "Page Two",
          "https://example.com/two",
          "Second activity page",
          ["b"],
        ),
      );

      const history = await store.getActivityHistory(7);

      // Contiguous, zero-filled window of the requested length.
      expect(history.days).toHaveLength(7);
      // Both pages (and their single chunk each) were just indexed.
      expect(history.totalPages).toBe(2);
      expect(history.totalChunks).toBe(2);
      // Per-day counts sum to the totals and land on the most recent day (today).
      const summedPages = history.days.reduce((sum, day) => sum + day.pages, 0);
      const summedChunks = history.days.reduce((sum, day) => sum + day.chunks, 0);
      expect(summedPages).toBe(2);
      expect(summedChunks).toBe(2);
      expect(history.days[history.days.length - 1]).toMatchObject({
        pages: 2,
        chunks: 2,
      });
      // Window bounds are present and correctly ordered.
      expect(history.since <= history.until).toBe(true);
    });

    it("counts a page's chunks on the day the page was first indexed", async () => {
      const page = ["Page", "https://example.com/page"] as const;
      await store.addDocuments(
        "activitylib",
        "1.0.0",
        1,
        createScrapeResult(...page, "v1"),
      );
      // @ts-expect-error Accessing private property for testing
      store.db.prepare("UPDATE pages SET created_at = datetime('now', '-3 days')").run();
      // A refresh keeps the page row but replaces its chunks.
      await store.addDocuments(
        "activitylib",
        "1.0.0",
        1,
        createScrapeResult(...page, "v2"),
      );

      const history = await store.getActivityHistory(7);

      expect(history.days.at(-4)).toMatchObject({ pages: 1, chunks: 1 });
      expect(history.days.at(-1)).toMatchObject({ pages: 0, chunks: 0 });
    });

    it("counts activity through indexes instead of scanning pages or documents", async () => {
      const { plan } = await queryPlanOf(store, "WITH RECURSIVE calendar", () =>
        store.getActivityHistory(90),
      );

      expect(plan).toContain(
        "SEARCH p USING COVERING INDEX idx_pages_created_at (created_at>?)",
      );
      expect(plan).toContain(
        "SEARCH c USING COVERING INDEX idx_documents_sort_order (page_id=?)",
      );
    });

    it("clamps the activity window and zero-fills empty stores", async () => {
      const history = await store.getActivityHistory(0);
      // A non-positive window is clamped to a single day, still zero-filled.
      expect(history.days).toHaveLength(1);
      expect(history.totalPages).toBe(0);
      expect(history.totalChunks).toBe(0);
      expect(history.days[0]).toMatchObject({ pages: 0, chunks: 0 });
    });

    it("computes a per-version content-type breakdown, empty for an unknown version", async () => {
      await store.addDocuments(
        "complib",
        "1.0.0",
        1,
        createScrapeResult(
          "Comp One",
          "https://example.com/comp-one",
          "Composition page one content",
          ["a"],
        ),
      );
      await store.addDocuments(
        "complib",
        "1.0.0",
        1,
        createScrapeResult(
          "Comp Two",
          "https://example.com/comp-two",
          "Composition page two content",
          ["b"],
        ),
      );

      const comp = await store.getVersionComposition("complib", "1.0.0");

      // Both pages are HTML in this fixture, so they collapse into one bucket.
      const mimePages = comp.mimeTypes.reduce((sum, m) => sum + m.pages, 0);
      expect(mimePages).toBe(2);
      expect(comp.mimeTypes[0]?.label).toContain("text/html");

      // An unknown version has an empty breakdown
      expect((await store.getVersionComposition("nope", "9.9.9")).mimeTypes).toEqual([]);
    });

    it("surfaces a failed version's error message in the library listing", async () => {
      await store.addDocuments(
        "errlib",
        "1.0.0",
        1,
        createScrapeResult("Err Page", "https://example.com/err", "content", ["a"]),
      );
      const versionId = await store.resolveVersionId("errlib", "1.0.0");
      await store.updateVersionStatus(
        versionId,
        VersionStatus.FAILED,
        "boom: could not fetch",
      );

      const versions = (await store.queryLibraryVersions()).get("errlib");
      expect(versions?.[0]?.status).toBe(VersionStatus.FAILED);
      expect(versions?.[0]?.errorMessage).toBe("boom: could not fetch");
    });
  });

  describe("Hybrid Search with Embeddings", () => {
    it("returns chunk positions, so search groups nearby chunks of a page", async () => {
      const page = createScrapeResult("Hooks", "https://example.com/hooks", "unused");
      page.chunks = ["First", "Second", "Third"].map((word, index) => ({
        types: ["text"],
        content: `${word} note about hooks.`,
        section: { level: 0, path: [`part ${index}`] },
      }));
      await store.addDocuments("grouping", "1.0.0", 1, page);

      const results = await new DocumentRetrieverService(store, appConfig).search(
        "grouping",
        "1.0.0",
        "hooks",
        10,
      );

      expect(results).toHaveLength(1);
    });

    it("orders results that score the same by URL, not by when they were stored", async () => {
      // Anagram URLs give both pages the same mock embedding and the same bm25 score
      for (const url of ["https://example.com/ba", "https://example.com/ab"]) {
        await store.addDocuments(
          "ties",
          "1.0.0",
          1,
          createScrapeResult("Same Title", url, "identical tie content", ["same"]),
        );
      }

      const results = await store.findByContent(
        "ties",
        "1.0.0",
        "identical tie content",
        10,
      );

      expect(results.map((result) => result.url)).toEqual([
        "https://example.com/ab",
        "https://example.com/ba",
      ]);
    });

    it("filters full-text hits by version before reading other libraries' rows", async () => {
      await store.addDocuments(
        "searchtest",
        "1.0.0",
        1,
        createScrapeResult(
          "JavaScript Programming Guide",
          "https://example.com/js-guide",
          "JavaScript programming tutorial with code examples and functions",
        ),
      );
      await store.addDocuments(
        "otherlib",
        "1.0.0",
        1,
        createScrapeResult(
          "Other JavaScript Guide",
          "https://other.example.com/js-guide",
          "JavaScript programming tutorial from another library",
        ),
      );

      // Capturing the hybrid query's own CTE proves the hybrid path ran.
      const { result, plan } = await queryPlanOf(
        store,
        "fts_scores AS MATERIALIZED",
        () => store.findByContent("searchtest", "1.0.0", "JavaScript programming", 10),
      );

      expect(result.map((r) => r.url)).toEqual(["https://example.com/js-guide"]);
      expectVersionFilteredFullTextPlan(plan);
    });

    it("scores a chunk found by one search method with that method's RRF term alone", async () => {
      // Each method returns as many candidates as the limit, so with a limit
      // of 3 the vector search misses the farthest page.
      await store.shutdown();
      store = new DocumentStore(":memory:", {
        ...appConfig,
        search: {
          ...appConfig.search,
          overfetchFactor: 1,
          vectorMultiplier: 1,
          weightVec: 1,
          weightFts: 1,
        },
      });
      await store.initialize();

      // Vector distance from the query grows with the angle: a, b, d, then c.
      const angles: Record<string, number> = {
        "https://example.com/a": 0,
        "https://example.com/b": 10,
        "https://example.com/d": 20,
        "https://example.com/c": 80,
      };
      const direction = (degrees: number) => {
        const vector = new Array(mockEmbeddingDimension.value).fill(0);
        vector[0] = Math.cos((degrees * Math.PI) / 180);
        vector[1] = Math.sin((degrees * Math.PI) / 180);
        return vector;
      };
      const embeddings = embeddingsOf(store);
      vi.mocked(embeddings.embedQuery).mockImplementation(async () => direction(0));
      vi.mocked(embeddings.embedDocuments).mockImplementation(async (texts) =>
        texts.map((text) => {
          const url = Object.keys(angles).find((u) => text.includes(`<url>${u}</url>`));
          return direction(url ? angles[url] : 90);
        }),
      );

      // Only a and c contain the query word; c ranks first in full-text search.
      const pages = [
        ["A", "a", "A needle hidden somewhere in a long description of the haystack"],
        ["B", "b", "A haystack described without the word"],
        ["C", "c", "needle needle"],
        ["D", "d", "Another haystack described without the word"],
      ];
      for (const [title, path, content] of pages) {
        await store.addDocuments(
          "rrflib",
          "1.0.0",
          1,
          createScrapeResult(title, `https://example.com/${path}`, content),
        );
      }

      const results = await store.findByContent("rrflib", "1.0.0", "needle", 3);

      expect(
        results.map((r) => ({ url: r.url, vec_rank: r.vec_rank, fts_rank: r.fts_rank })),
      ).toEqual([
        { url: "https://example.com/a", vec_rank: 1, fts_rank: 2 },
        { url: "https://example.com/c", vec_rank: undefined, fts_rank: 1 },
        { url: "https://example.com/b", vec_rank: 2, fts_rank: undefined },
      ]);
      expect(results.map((r) => r.score)).toEqual([1 / 61 + 1 / 62, 1 / 61, 1 / 62]);
    });
  });

  describe("Embedding Batch Processing", () => {
    let mockEmbedDocuments: MockedFunction<Embeddings["embedDocuments"]>;

    beforeEach(() => {
      mockEmbeddingDimension.value = 1536;
      mockEmbedDocuments = vi.mocked(embeddingsOf(store).embedDocuments);
      mockEmbedDocuments.mockClear();
    });

    it("splits a page's chunks into batches within batchChars and batchSize, embedding every chunk", async () => {
      // Five 15 KB chunks add up to more than batchChars (50 000), so one page
      // needs several batches. Neither the URL nor the path holds "Batch", so
      // only the indexed title can match the full-text query below.
      const page = createScrapeResult("Batch Guide", "https://example.com/big-page", "");
      page.chunks = Array.from({ length: 5 }, (_, i) => ({
        types: ["text"],
        content: `${String.fromCharCode(97 + i)}`.repeat(15_000),
        section: { level: 0, path: [`part${i}`] },
      }));
      await store.addDocuments("batchtest", "1.0.0", 1, page);

      const batches = mockEmbedDocuments.mock.calls.map(([texts]) => texts);
      expect(batches.length).toBeGreaterThan(1);
      for (const texts of batches) {
        expect(texts.join("").length).toBeLessThanOrEqual(
          appConfig.embeddings.batchChars,
        );
        expect(texts.length).toBeLessThanOrEqual(appConfig.embeddings.batchSize);
      }
      expect(batches.flat()).toHaveLength(5);
      const { chunks } = await store.listVersionChunks("batchtest", "1.0.0", {
        limit: 10,
      });
      expect(chunks.map((chunk) => chunk.hasEmbedding)).toEqual([
        true,
        true,
        true,
        true,
        true,
      ]);

      // The title column is indexed for full-text search
      const results = await store.findByContent("batchtest", "1.0.0", "Batch", 10);
      expect(results).toHaveLength(5);
      expect(results.every((result) => result.fts_rank !== undefined)).toBe(true);
    });

    it("should include proper document headers in embedding text", async () => {
      await store.addDocuments(
        "testlib",
        "1.0.0",
        1,
        createScrapeResult("Test Title", "https://example.com/test", "Test content", [
          "path",
          "to",
          "doc",
        ]),
      );

      // Embedding text should include structured metadata
      expect(mockEmbedDocuments).toHaveBeenCalledTimes(1);
      const embeddedText = mockEmbedDocuments.mock.calls[0][0][0];

      expect(embeddedText).toContain("<title>Test Title</title>");
      expect(embeddedText).toContain("<url>https://example.com/test</url>");
      expect(embeddedText).toContain("<path>path / to / doc</path>");
      expect(embeddedText).toContain("Test content");
    });
  });

  describe("Status Tracking and Metadata", () => {
    const backdated = "2000-01-01 00:00:00";

    async function seedStatus(status: VersionStatus): Promise<number> {
      const versionId = await store.resolveVersionId("statuslib", status);
      await store.updateVersionStatus(versionId, status);
      return versionId;
    }

    /** Sets every version's updated_at to `backdated`, as a long-silent run leaves it. */
    function backdateVersions() {
      // @ts-expect-error Accessing private property for testing
      const db: DatabaseType = store.db;
      // Without the trigger, which sets updated_at on every update, the rows can be backdated
      db.exec("DROP TRIGGER versions_updated_at");
      db.prepare("UPDATE versions SET updated_at = ?").run(backdated);
    }

    it("marks only queued and running versions alive", async () => {
      const queued = await seedStatus(VersionStatus.QUEUED);
      const running = await seedStatus(VersionStatus.RUNNING);
      const completed = await seedStatus(VersionStatus.COMPLETED);
      backdateVersions();

      await store.markVersionsAlive([queued, running, completed]);

      const updatedAt = async (versionId: number) =>
        (await store.getVersionById(versionId))?.updated_at;
      expect(await updatedAt(queued)).not.toBe(backdated);
      expect(await updatedAt(running)).not.toBe(backdated);
      expect(await updatedAt(completed)).toBe(backdated);
    });

    it("claims an interrupted version once per read", async () => {
      const running = await seedStatus(VersionStatus.RUNNING);
      backdateVersions();

      expect(await store.claimInterruptedVersion(running, backdated)).toBe(true);
      expect(await store.getVersionById(running)).toMatchObject({
        status: VersionStatus.RUNNING,
        updated_at: expect.not.stringMatching(backdated),
      });
      // Another process read the same version, but this one claimed it first
      expect(await store.claimInterruptedVersion(running, backdated)).toBe(false);
    });
  });

  describe("Embedding Retry Logic", () => {
    let mockEmbedDocuments: MockedFunction<Embeddings["embedDocuments"]>;
    let callCount: number;

    beforeEach(() => {
      callCount = 0;
      mockEmbedDocuments = vi.mocked(embeddingsOf(store).embedDocuments);
      mockEmbedDocuments.mockClear();
    });

    it("splits a batch in half until the provider accepts it", async () => {
      // The provider rejects every batch of more than one text
      mockEmbedDocuments.mockImplementation(async (texts: string[]) => {
        if (texts.length > 1) {
          throw new Error("maximum context length exceeded");
        }
        return texts.map(() => new Array(1536).fill(0.1));
      });

      const result = createScrapeResult("Multi Split", "https://example.com/multi", "");
      result.chunks = [1, 2, 3, 4].map((n) => ({
        types: ["text"],
        content: `Chunk ${n}`,
        section: { level: 0, path: [`s${n}`] },
      }));

      await store.addDocuments("multisplit", "1.0.0", 1, result);

      expect(mockEmbedDocuments.mock.calls.map(([texts]) => texts.length)).toEqual([
        4, 2, 2, 1, 1, 1, 1,
      ]);
      const { chunks } = await store.listVersionChunks("multisplit", "1.0.0", {
        limit: 10,
      });
      expect(chunks.map((chunk) => chunk.hasEmbedding)).toEqual([true, true, true, true]);
    });

    it("should truncate an oversized single text after splitting a batch", async () => {
      const maxTextLength = 800;
      const singleTexts: string[] = [];
      mockEmbedDocuments.mockImplementation(async (texts: string[]) => {
        if (texts.length === 1) {
          singleTexts.push(texts[0]);
        }

        if (texts.length > 1 || texts[0].length > maxTextLength) {
          throw new Error("maximum context length exceeded");
        }

        return texts.map(() => new Array(1536).fill(0.1));
      });

      const result = createScrapeResult(
        "Split Then Truncate",
        "https://example.com/split-then-truncate",
        "regular chunk",
        ["test"],
      );
      result.chunks = [
        { types: ["text"], content: "regular chunk", section: { level: 0, path: ["a"] } },
        {
          types: ["text"],
          content: `oversized ${"x".repeat(1000)}`,
          section: { level: 0, path: ["b"] },
        },
      ];

      await store.addDocuments("splittruncatetest", "1.0.0", 1, result);

      const oversizedAttempts = singleTexts.filter((text) => text.includes("oversized"));
      expect(oversizedAttempts).toHaveLength(2);
      const [original, retried] = oversizedAttempts;
      expect(original.length).toBeGreaterThan(maxTextLength);
      expect(retried.length).toBeLessThan(original.length);
      expect(original.startsWith(retried)).toBe(true);
      expect(await store.checkDocumentExists("splittruncatetest", "1.0.0")).toBe(true);
    });

    it("should detect various size error messages", async () => {
      const sizeErrorMessages = [
        "maximum context length exceeded",
        "input is too long",
        "token limit reached",
        "input is too large",
        "text exceeds the limit",
        "max token count exceeded",
      ];

      for (const errorMsg of sizeErrorMessages) {
        callCount = 0;
        mockEmbedDocuments.mockClear();

        // Mock to fail with specific error message, then succeed
        mockEmbedDocuments.mockImplementation(async (texts: string[]) => {
          callCount++;
          if (callCount === 1) {
            throw new Error(errorMsg);
          }
          return texts.map(() => new Array(1536).fill(0.1));
        });

        const testLib = `errortest-${sizeErrorMessages.indexOf(errorMsg)}`;
        await store.addDocuments(
          testLib,
          "1.0.0",
          1,
          createScrapeResult(
            "Error Test",
            `https://example.com/${testLib}`,
            "Test content",
            ["test"],
          ),
        );

        // Should have retried and succeeded
        expect(callCount).toBeGreaterThan(1);
        expect(await store.checkDocumentExists(testLib, "1.0.0")).toBe(true);
      }
    });

    it("wraps a provider error in a message with the page, the batch and a hint, without retrying", async () => {
      const cases: [label: string, url: string, error: Error, expected: string[]][] = [
        [
          "a network error",
          "https://example.com/network-error",
          new Error("Network error: connection refused"),
          [
            "Failed to generate embeddings",
            "https://example.com/network-error",
            "embedding service appears unreachable",
            "Network error: connection refused",
          ],
        ],
        [
          "a malformed provider response",
          "https://example.com/malformed-response",
          new TypeError("Cannot read properties of undefined (reading '0')"),
          [
            "Failed to generate embeddings",
            "https://example.com/malformed-response",
            "openai:text-embedding-3-small",
            "Batch 1",
            "Verify embedding provider configuration",
            "request size",
            "backend logs",
            "Cannot read properties of undefined",
          ],
        ],
      ];

      for (const [label, url, providerError, expected] of cases) {
        mockEmbedDocuments.mockReset();
        mockEmbedDocuments.mockRejectedValue(providerError);

        const error = await store
          .addDocuments(label, "1.0.0", 1, createScrapeResult(label, url, "Test content"))
          .catch((e: unknown) => e);

        const message = error instanceof Error ? error.message : String(error);
        for (const part of expected) {
          expect.soft(message, label).toContain(part);
        }
        // Not a size error, so no retry
        expect.soft(mockEmbedDocuments, label).toHaveBeenCalledTimes(1);
      }
    });

    it("should fail after retry if truncated text still too large", async () => {
      // Mock embedDocuments to always fail with size error (even after truncation)
      mockEmbedDocuments.mockRejectedValue(
        new Error("maximum context length exceeded - even after truncation"),
      );

      await expect(
        store.addDocuments(
          "alwaysfail",
          "1.0.0",
          1,
          createScrapeResult(
            "Always Fail",
            "https://example.com/always-fail",
            "x".repeat(100000), // Very large content
            ["test"],
          ),
        ),
      ).rejects.toThrow("maximum context length exceeded");

      // Should have attempted multiple times (original + retry after truncation)
      expect(mockEmbedDocuments).toHaveBeenCalled();
    });
  });
});

/**
 * Tests for DocumentStore without embeddings (FTS-only mode)
 * Tests the fallback behavior when no embedding configuration is provided
 */
describe("DocumentStore - Without Embeddings (FTS-only)", () => {
  let store: DocumentStore;
  let appConfig: AppConfig;

  beforeEach(() => {
    appConfig = configWith("");
  });

  afterEach(async () => {
    if (store) {
      await store.shutdown();
    }
  });

  describe("FTS-only Search", () => {
    beforeEach(async () => {
      store = new DocumentStore(":memory:", appConfig);
      await store.initialize();

      await store.addDocuments(
        "testlib",
        "1.0.0",
        1,
        createScrapeResult(
          "React Hooks Guide",
          "https://example.com/react-hooks",
          "React hooks are a powerful feature for state management.",
          ["React", "Hooks"],
        ),
      );
      await store.addDocuments(
        "testlib",
        "1.0.0",
        1,
        createScrapeResult(
          "TypeScript Introduction",
          "https://example.com/typescript-intro",
          "TypeScript provides excellent type safety for JavaScript.",
          ["TypeScript", "Intro"],
        ),
      );
    });

    it("returns chunk positions, so search groups nearby chunks of a page", async () => {
      const page = createScrapeResult("Hooks", "https://example.com/hooks", "unused");
      page.chunks = ["First", "Second", "Third"].map((word, index) => ({
        types: ["text"],
        content: `${word} note about hooks.`,
        section: { level: 0, path: [`part ${index}`] },
      }));
      await store.addDocuments("grouping", "1.0.0", 1, page);

      const results = await new DocumentRetrieverService(store, appConfig).search(
        "grouping",
        "1.0.0",
        "hooks",
        10,
      );

      expect(results).toHaveLength(1);
    });

    it("orders results that score the same by URL, not by when they were stored", async () => {
      // Anagram URLs give both pages the same mock embedding and the same bm25 score
      for (const url of ["https://example.com/ba", "https://example.com/ab"]) {
        await store.addDocuments(
          "ties",
          "1.0.0",
          1,
          createScrapeResult("Same Title", url, "identical tie content", ["same"]),
        );
      }

      const results = await store.findByContent(
        "ties",
        "1.0.0",
        "identical tie content",
        10,
      );

      expect(results.map((result) => result.url)).toEqual([
        "https://example.com/ab",
        "https://example.com/ba",
      ]);
    });

    it("filters full-text hits by version before reading other libraries' rows", async () => {
      await store.addDocuments(
        "otherlib",
        "1.0.0",
        1,
        createScrapeResult(
          "Other Hooks Guide",
          "https://other.example.com/react-hooks",
          "React hooks from another library.",
        ),
      );

      const { result, plan } = await queryPlanOf(store, "documents_fts MATCH", () =>
        store.findByContent("testlib", "1.0.0", "React hooks", 5),
      );

      expect(result.map((r) => r.url)).toEqual(["https://example.com/react-hooks"]);
      expectVersionFilteredFullTextPlan(plan);
      // Ranked by full-text search alone, with no vector rank
      expect(result[0].fts_rank).toBe(1);
      expect(result[0].vec_rank).toBeUndefined();
    });

    it("returns nothing for an empty query", async () => {
      expect(await store.findByContent("testlib", "1.0.0", "", 5)).toEqual([]);
    });
  });

  describe("Stop words in queries", () => {
    const hooksContent = "Hooks let function components keep state.";
    const shelfContent = "It is on the shelf and in the box.";

    beforeEach(async () => {
      store = new DocumentStore(":memory:", appConfig);
      await store.initialize();

      await store.addDocuments(
        "stopwords",
        "1.0.0",
        1,
        createScrapeResult("Hooks", "https://example.com/hooks", hooksContent),
      );
      await store.addDocuments(
        "stopwords",
        "1.0.0",
        1,
        createScrapeResult("Shelf", "https://example.com/shelf", shelfContent),
      );
    });

    const search = async (query: string) =>
      (await store.findByContent("stopwords", "1.0.0", query, 10)).map(
        (result) => result.content,
      );

    it("matches stop words only when the query has nothing else or quotes them", async () => {
      const cases: [label: string, query: string, expected: unknown][] = [
        [
          "a chunk is found by its other words when the query also has stop words",
          "What is the use of hooks?",
          [hooksContent],
        ],
        [
          "chunks do not match on stop words alone when the query has other words",
          "Is it, in the sidecar?",
          [],
        ],
        [
          "stop words match when the query has nothing else",
          "is it in the",
          [shelfContent],
        ],
        [
          "stop words match when the rest of the query is punctuation",
          "is it in the ?",
          [shelfContent],
        ],
        [
          "stop words the user put in quotes are kept",
          '"on the" hooks',
          expect.arrayContaining([hooksContent, shelfContent]),
        ],
      ];
      for (const [label, query, expected] of cases) {
        expect.soft(await search(query), label).toEqual(expected);
      }
    });
  });

  describe("Chunk Explorer without embeddings", () => {
    beforeEach(async () => {
      store = new DocumentStore(":memory:", appConfig);
      await store.initialize();

      await store.addDocuments(
        "testlib",
        "1.0.0",
        1,
        createScrapeResult(
          "React Hooks Guide",
          "https://example.com/react-hooks",
          "React hooks are a powerful feature for state management.",
          ["React", "Hooks"],
        ),
      );
    });

    it("reports no embeddings and no active embedding config when vector search is disabled", async () => {
      expect(store.getActiveEmbeddingConfig()).toBeNull();

      const result = await store.listVersionChunks("testlib", "1.0.0", { limit: 10 });
      expect(result.chunks.length).toBeGreaterThan(0);
      for (const chunk of result.chunks) {
        expect(chunk.hasEmbedding).toBe(false);
        expect(chunk.tokenCount).toBeNull();
      }

      const stats = await store.getVersionStats("testlib", "1.0.0");
      expect(stats.embeddedChunkCount).toBe(0);
      expect(stats.avgTokensPerChunk).toBeNull();
    });
  });
});

/**
 * Common tests that work in both embedding and non-embedding modes
 * These tests focus on core database functionality
 */
describe("DocumentStore - Common Functionality", () => {
  let store: DocumentStore;
  let appConfig: AppConfig;

  // An embedding model without credentials, as on an install without an API
  // key: the store falls back to full-text search.
  beforeEach(async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    appConfig = configWith("openai:text-embedding-3-small");
    store = new DocumentStore(":memory:", appConfig);
    await store.initialize();
  });

  afterEach(async () => {
    if (store) {
      await store.shutdown();
    }
    vi.unstubAllEnvs();
  });

  describe("Library Identity", () => {
    type StatementMap = Record<string, { run: (...args: unknown[]) => unknown }>;
    const statementsOf = (target: DocumentStore) =>
      (target as unknown as { statements: StatementMap }).statements;

    const listedLibraries = async () => [...(await store.queryLibraryVersions()).keys()];

    it("stores the trimmed name as entered and keeps it on later writes", async () => {
      const first = await store.resolveVersionId(" Next.js Docs ", "");
      const second = await store.resolveVersionId("next.js docs", "");

      expect(second).toBe(first);
      expect(await listedLibraries()).toEqual(["Next.js Docs"]);
    });

    it("rejects an invalid new library name through either entry point and creates nothing", async () => {
      const cases: [label: string, create: () => Promise<unknown>][] = [
        ["an empty name", () => store.resolveVersionId("", "")],
        ["a whitespace-only name", () => store.resolveVersionId("   ", "")],
        ["a newline", () => store.resolveVersionId("React\nDocs", "")],
        ["a tab", () => store.resolveVersionId("React\tDocs", "")],
        [
          "a claim with 101 code points",
          () => store.claimVersion("a".repeat(101), "", "replace"),
        ],
      ];

      for (const [label, create] of cases) {
        await expect
          .soft(create(), label)
          .rejects.toBeInstanceOf(InvalidLibraryNameError);
      }
      expect(await listedLibraries()).toEqual([]);
    });

    it("creates a library and its first version atomically", async () => {
      vi.spyOn(statementsOf(store).insertVersion, "run").mockImplementation(() => {
        throw new Error("injected version insert failure");
      });

      await expect(store.resolveVersionId("Atomic", "1.0.0")).rejects.toThrow(
        "injected version insert failure",
      );
      vi.restoreAllMocks();

      expect(await store.getLibrary("Atomic")).toBeNull();
    });

    describe("findVersion", () => {
      it("returns null for an unknown library or version and creates nothing", async () => {
        await store.resolveVersionId("React", "18.0.0");
        const before = await store.queryLibraryVersions();

        expect(await store.findVersion("vue", "")).toBeNull();
        expect(await store.findVersion("react", "99.0.0")).toBeNull();
        expect(await store.queryLibraryVersions()).toEqual(before);
      });
    });

    describe("removeVersion", () => {
      it("rolls back every delete when a later one fails", async () => {
        await store.addDocuments(
          "React",
          "",
          0,
          createScrapeResult("Doc", "https://example.com/react", "content"),
        );
        vi.spyOn(statementsOf(store).deleteLibraryById, "run").mockImplementation(() => {
          throw new Error("injected library delete failure");
        });

        await expect(store.removeVersion("react", "")).rejects.toThrow();
        vi.restoreAllMocks();

        expect(await store.findVersion("react", "")).not.toBeNull();
        expect(await store.checkDocumentExists("react", "")).toBe(true);
        expect(
          (await store.queryLibraryVersions()).get("React")?.[0].uniqueUrlCount,
        ).toBe(1);
      });
    });

    it("lets the database arbitrate claims made through separate connections", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "docs-mcp-claim-"));
      const dbPath = join(tempDir, "claims.sqlite");
      const first = new DocumentStore(dbPath, configWith(""));
      await first.initialize();
      const second = new DocumentStore(dbPath, configWith(""));
      await second.initialize();

      try {
        const results = await Promise.allSettled([
          first.claimVersion("Svelte", "", "reject-library"),
          second.claimVersion("svelte", "", "reject-library"),
        ]);

        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const rejected = results.filter((r) => r.status === "rejected");
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
          LibraryAlreadyExistsError,
        );
      } finally {
        await first.shutdown();
        await second.shutdown();
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("Version Label Lookup Parity", () => {
    it("finds, counts and deletes a version by a padded or uppercased label", async () => {
      // Writes normalized but reads did not, so a label that differed only by
      // whitespace or case created the right row and then missed on every
      // subsequent lookup, delete and search.
      await store.addDocuments(
        "paritylib",
        "1.0.0",
        1,
        createScrapeResult("Doc", "https://example.com/p", "content", ["p"]),
      );

      for (const variant of ["1.0.0", " 1.0.0 ", "1.0.0 ", " 1.0.0"]) {
        await expect(store.checkDocumentExists("paritylib", variant)).resolves.toBe(true);
      }
      await expect(store.checkDocumentExists(" PARITYLIB ", " 1.0.0 ")).resolves.toBe(
        true,
      );

      // A tag differing only in case is the same bucket; "v1.0.0" is not,
      // because labels are stored verbatim rather than coerced.
      await store.addDocuments(
        "paritylib",
        "Stable",
        1,
        createScrapeResult("Tag", "https://example.com/t", "content", ["t"]),
      );
      await expect(store.checkDocumentExists("paritylib", " STABLE ")).resolves.toBe(
        true,
      );
      await expect(store.checkDocumentExists("paritylib", "v1.0.0")).resolves.toBe(false);

      // The delete path must reach the same row the lookup found.
      await expect(store.deletePages("paritylib", " 1.0.0 ")).resolves.toBeGreaterThan(0);
      await expect(store.checkDocumentExists("paritylib", "1.0.0")).resolves.toBe(false);
    });
  });

  describe("Version Listing Order", () => {
    it("orders each library's versions newest first, with tags last", async () => {
      // queryLibraryVersions owns this ordering; SQL sorts lexicographically,
      // so the JS comparator is what keeps 1.10.0 ahead of 1.9.0 and stops a
      // tag sorting into the version run.
      for (const version of ["1.9.0", "1.10.0", "stable", "2.0.0-beta", ""]) {
        await store.resolveVersionId("orderlib", version);
      }

      const versions = (await store.queryLibraryVersions()).get("orderlib") ?? [];
      expect(versions.map((v) => v.version)).toEqual([
        "",
        "2.0.0-beta",
        "1.10.0",
        "1.9.0",
        "stable",
      ]);
      // Unversioned leads the listing; it is not the newest *version*.
      expect(versions.filter((v) => v.version !== "")[0].version).toBe("2.0.0-beta");
    });
  });

  describe("Version Isolation", () => {
    it("should search within specific versions only", async () => {
      await store.addDocuments(
        "featuretest",
        "1.0.0",
        1,
        createScrapeResult(
          "Old Feature",
          "https://example.com/old",
          "Old feature documentation",
          ["features"],
        ),
      );
      await store.addDocuments(
        "featuretest",
        "2.0.0",
        1,
        createScrapeResult(
          "New Feature",
          "https://example.com/new",
          "New feature documentation",
          ["features"],
        ),
      );

      const v1Results = await store.findByContent("featuretest", "1.0.0", "feature", 10);
      expect(v1Results.length).toBeGreaterThan(0);
      expect(v1Results[0].title).toBe("Old Feature");

      const v2Results = await store.findByContent("featuretest", "2.0.0", "feature", 10);
      expect(v2Results.length).toBeGreaterThan(0);
      expect(v2Results[0].title).toBe("New Feature");
    });
  });

  describe("Document Management", () => {
    it("should delete both documents and pages when removing all documents", async () => {
      const library = "delete-test";
      const version = "1.0.0";

      // Add multiple pages with documents
      await store.addDocuments(
        library,
        version,
        1,
        createScrapeResult("Page 1", "https://example.com/page1", "Content for page 1", [
          "section1",
        ]),
      );
      await store.addDocuments(
        library,
        version,
        1,
        createScrapeResult("Page 2", "https://example.com/page2", "Content for page 2", [
          "section2",
        ]),
      );

      // Verify both pages and documents exist
      const versionId = await store.resolveVersionId(library, version);
      const pagesBefore = await store.getPagesByVersionId(versionId);
      expect(pagesBefore.length).toBe(2);
      expect(await store.checkDocumentExists(library, version)).toBe(true);

      // Delete all documents for this version
      const deletedCount = await store.deletePages(library, version);
      expect(deletedCount).toBe(2); // Should delete 2 documents

      // Verify both documents AND pages are gone
      const pagesAfter = await store.getPagesByVersionId(versionId);
      expect(pagesAfter.length).toBe(0); // Pages should be deleted too
      expect(await store.checkDocumentExists(library, version)).toBe(false);
    });
  });

  describe("Child Chunk Lookup", () => {
    const library = "tree-lib";
    const version = "1.0.0";

    it("returns the chunks one level below the parent's path", async () => {
      const cases: [label: string, paths: string[][], expected: string[][]][] = [
        [
          "a path that only shares a text prefix with the parent is ignored",
          [["A"], ["AB", "X"], ["A", "B"]],
          [["A", "B"]],
        ],
        [
          "LIKE wildcards in path segments are literal text",
          [["a_c%"], ["abcd", "X"], ["a_c%", "Y"]],
          [["a_c%", "Y"]],
        ],
        [
          "path segments may contain quotes, backslashes or non-ASCII text",
          [['Say "hi" \\ 日本語'], ['Say "hi" \\ 日本語', "Détails"]],
          [['Say "hi" \\ 日本語', "Détails"]],
        ],
        [
          "top-level chunks are the children of a root chunk",
          [[], ["A"], [], ["A", "B"]],
          [["A"]],
        ],
      ];

      for (const [index, [label, paths, expected]] of cases.entries()) {
        const url = `https://example.com/tree-${index}`;
        await store.addDocuments(library, version, 1, {
          ...createScrapeResult("Tree", url, "tree"),
          chunks: paths.map((path) => ({
            types: ["text"],
            content: `chunk ${path.join("/")}`,
            section: { level: path.length, path },
          })),
        });
        const [parent] = await store.findChunksByUrl(library, version, url);

        const children = await store.findChildChunks(library, version, parent.id, 10);

        expect
          .soft(
            children.map((child) => child.metadata.path),
            label,
          )
          .toEqual(expected);
      }
    });
  });

  describe("Search Security", () => {
    beforeEach(async () => {
      await store.addDocuments(
        "security-test",
        "1.0.0",
        1,
        createScrapeResult(
          "Programming Guide",
          "https://example.com/programming",
          "Programming computers is fun and educational for developers",
          ["programming", "guide"],
        ),
      );
      await store.addDocuments(
        "security-test",
        "1.0.0",
        1,
        createScrapeResult(
          "CLI Options",
          "https://example.com/cli-options",
          "Use the --error-on-warnings flag to fail the build on warnings.",
          ["cli", "options"],
        ),
      );
    });

    it("escapes queries with SQL, FTS syntax and special characters, finding the indexed words", async () => {
      await store.addDocuments(
        "security-test",
        "1.0.0",
        1,
        createScrapeResult(
          "Special Chars",
          "https://example.com/special",
          "Use @decorator or $variable in your code.",
          ["syntax"],
        ),
      );
      const programming = "https://example.com/programming";
      const cliOptions = "https://example.com/cli-options";
      const special = "https://example.com/special";

      // Each row lists the pages the query must find; an empty list only
      // requires that the query runs without an FTS syntax error.
      const cases: [query: string, expected: string[]][] = [
        ["'; DROP TABLE documents; --", []],
        ["programming & development", [programming]],
        ["software (lifecycle)", []],
        ["price: $99.99", []],
        ["100% coverage", []],
        ["function()", []],
        ["test* wildcard", []],
        ['"@decorator"', [special]],
        ['"$variable"', [special]],
        ['"foo-bar-baz"', []],
        ['"test.method()"', []],
        // An unbalanced quote is closed automatically
        ['"--error-on-warnings', [cliOptions]],
      ];

      for (const [query, expected] of cases) {
        const urls = (await store.findByContent("security-test", "1.0.0", query, 10)).map(
          (result) => result.url,
        );
        expect.soft(urls, query).toEqual(expect.arrayContaining(expected));
      }

      // The database still answers normal queries
      const normal = await store.findByContent(
        "security-test",
        "1.0.0",
        "programming",
        10,
      );
      expect(normal.map((result) => result.url)).toEqual([programming]);
    });

    it("should handle quoted strings with hyphens (issue #262)", async () => {
      // Reproduction for: https://github.com/arabold/docs-mcp-server/issues/262
      // Query: "--error-on-warnings" (including quotes) should not throw syntax error
      const results = await store.findByContent(
        "security-test",
        "1.0.0",
        '"--error-on-warnings"',
        10,
      );

      // Should find the document containing --error-on-warnings
      expect(results.length).toBeGreaterThan(0);
      expect(
        results.some((result) => result.content.includes("--error-on-warnings")),
      ).toBe(true);
    });

    it("should preserve phrase search when user provides quotes", async () => {
      await store.addDocuments(
        "security-test",
        "1.0.0",
        1,
        createScrapeResult(
          "Phrase Test",
          "https://example.com/phrase",
          "The quick brown fox jumps over the lazy dog.",
          ["test"],
        ),
      );

      // Quoted phrase should find exact phrase
      const phraseResults = await store.findByContent(
        "security-test",
        "1.0.0",
        '"quick brown fox"',
        10,
      );
      expect(phraseResults.length).toBeGreaterThan(0);
      expect(phraseResults[0].content).toContain("quick brown fox");
    });

    it("should support mixed quoted phrases and unquoted terms", async () => {
      await store.addDocuments(
        "security-test",
        "1.0.0",
        1,
        createScrapeResult(
          "Mixed Search Test",
          "https://example.com/mixed",
          "Modern programming requires knowledge of design patterns and best practices.",
          ["programming"],
        ),
      );

      // Test mixed search: unquoted term + quoted phrase
      const results = await store.findByContent(
        "security-test",
        "1.0.0",
        'programming "design patterns"',
        10,
      );

      // Should find documents containing both "programming" AND the phrase "design patterns"
      expect(results.length).toBeGreaterThan(0);
      expect(
        results.some((result) => {
          const content = result.content.toLowerCase();
          return content.includes("programming") && content.includes("design patterns");
        }),
      ).toBe(true);
    });

    it("treats the FTS operators OR and NOT as literal keywords in unquoted position", async () => {
      await store.addDocuments(
        "security-test",
        "1.0.0",
        1,
        createScrapeResult(
          "OR Keyword Test",
          "https://example.com/or-test",
          "You can use OR conditions in your queries to match multiple terms.",
          ["queries"],
        ),
      );
      await store.addDocuments(
        "security-test",
        "1.0.0",
        1,
        createScrapeResult(
          "NOT Keyword Test",
          "https://example.com/not-test",
          "You should NOT use this approach in production code.",
          ["warnings"],
        ),
      );

      // With OR semantics each term is optional, so '"queries" OR malicious'
      // becomes: the exact phrase OR ("queries" OR "OR" OR "malicious"). The
      // document holds "queries" and "OR", so it matches; likewise for NOT.
      const cases: [query: string, url: string][] = [
        ['"queries" OR malicious', "https://example.com/or-test"],
        ['"production" NOT unsafe', "https://example.com/not-test"],
      ];
      for (const [query, url] of cases) {
        const results = await store.findByContent("security-test", "1.0.0", query, 10);
        expect.soft(results[0]?.url, query).toBe(url);
      }
    });
  });

  describe("Refresh Operations - getPagesByVersionId", () => {
    beforeEach(async () => {
      // Add pages with etags for building refresh queue
      await store.addDocuments(
        "refresh-queue-test",
        "1.0.0",
        1,
        createScrapeResult(
          "Page 1",
          "https://example.com/page1",
          "Content 1",
          ["section1"],
          { etag: '"etag1"', lastModified: "2023-01-01T00:00:00Z" },
        ),
      );
      await store.addDocuments(
        "refresh-queue-test",
        "1.0.0",
        1,
        createScrapeResult(
          "Page 2",
          "https://example.com/page2",
          "Content 2",
          ["section2"],
          { etag: '"etag2"', lastModified: "2023-01-02T00:00:00Z" },
        ),
      );
      await store.addDocuments(
        "refresh-queue-test",
        "1.0.0",
        1,
        createScrapeResult(
          "Page 3 No ETag",
          "https://example.com/page3",
          "Content 3",
          ["section3"],
          { etag: null, lastModified: null },
        ),
      );
    });

    it("should retrieve all pages with metadata for refresh queue building", async () => {
      const versionId = await store.resolveVersionId("refresh-queue-test", "1.0.0");
      const pages = await store.getPagesByVersionId(versionId);

      expect(
        pages
          .map(({ url, etag, last_modified, depth }) => ({
            url,
            etag,
            last_modified,
            depth,
          }))
          .sort((a, b) => a.url.localeCompare(b.url)),
      ).toEqual([
        {
          url: "https://example.com/page1",
          etag: '"etag1"',
          last_modified: "2023-01-01T00:00:00Z",
          depth: 1,
        },
        {
          url: "https://example.com/page2",
          etag: '"etag2"',
          last_modified: "2023-01-02T00:00:00Z",
          depth: 1,
        },
        { url: "https://example.com/page3", etag: null, last_modified: null, depth: 1 },
      ]);
      expect(pages.every((page) => page.id > 0)).toBe(true);

      // A version without pages has none
      const emptyVersionId = await store.resolveVersionId("empty-lib", "1.0.0");
      expect(await store.getPagesByVersionId(emptyVersionId)).toEqual([]);
    });
  });

  describe("Chunk Explorer - listVersionChunks and getVersionStats", () => {
    const library = "chunk-explorer-test";
    const version = "1.0.0";

    beforeEach(async () => {
      // The outer beforeEach creates a store without credentials available,
      // so vector search stays disabled (see areCredentialsAvailable). Recreate
      // the store with a credential present so these tests can assert on real
      // embedding presence.
      vi.stubEnv("OPENAI_API_KEY", "test-key-for-chunk-explorer");
      await store.shutdown();
      store = new DocumentStore(":memory:", appConfig);
      await store.initialize();

      // Page 1 ("guide"): 3 chunks, inserted in order.
      await store.addDocuments(library, version, 1, {
        ...createScrapeResult(
          "Guide",
          "https://example.com/guide",
          "Introduction to widgets",
          ["intro"],
        ),
        chunks: [
          {
            types: ["text"],
            content: "Introduction to widgets",
            section: { level: 0, path: ["intro"] },
          },
          {
            types: ["text"],
            content: "Widgets are configurable",
            section: { level: 0, path: ["config"] },
          },
          {
            types: ["text"],
            content: "Advanced widget usage",
            section: { level: 0, path: ["advanced"] },
          },
        ],
      });

      // Page 2 ("reference"): a single chunk.
      await store.addDocuments(
        library,
        version,
        1,
        createScrapeResult(
          "Reference",
          "https://example.com/reference",
          "Reference material about gadgets",
          ["reference"],
        ),
      );
    });

    it("paginates chunks and reports position/total within each page", async () => {
      const firstPage = await store.listVersionChunks(library, version, {
        limit: 2,
        offset: 0,
      });
      expect(firstPage.total).toBe(4);
      expect(firstPage.chunks).toHaveLength(2);

      const secondPage = await store.listVersionChunks(library, version, {
        limit: 2,
        offset: 2,
      });
      expect(secondPage.total).toBe(4);
      expect(secondPage.chunks).toHaveLength(2);

      // The two pages must not overlap.
      const firstIds = firstPage.chunks.map((c) => c.id);
      const secondIds = secondPage.chunks.map((c) => c.id);
      expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);

      const allChunks = [...firstPage.chunks, ...secondPage.chunks];

      // Guide page: 3 chunks, positions 1..3, each reporting a page total of 3.
      const guideChunks = allChunks.filter((c) => c.url === "https://example.com/guide");
      expect(guideChunks).toHaveLength(3);
      expect(guideChunks.map((c) => c.chunkIndex).sort((a, b) => a - b)).toEqual([
        1, 2, 3,
      ]);
      for (const chunk of guideChunks) {
        expect(chunk.pageChunkCount).toBe(3);
      }

      // Reference page: a single chunk, reported as "1 of 1".
      const referenceChunks = allChunks.filter(
        (c) => c.url === "https://example.com/reference",
      );
      expect(referenceChunks).toHaveLength(1);
      expect(referenceChunks[0].chunkIndex).toBe(1);
      expect(referenceChunks[0].pageChunkCount).toBe(1);
    });

    it("reports mimeType, charCount, hasEmbedding, and never fabricates tokenCount", async () => {
      const result = await store.listVersionChunks(library, version, { limit: 10 });
      expect(result.chunks).toHaveLength(4);

      for (const chunk of result.chunks) {
        expect(chunk.mimeType).toBe("text/html");
        expect(chunk.charCount).toBe(chunk.content.length);
        expect(chunk.charCount).toBeGreaterThan(0);
        // The schema has no per-chunk token column: never fabricate a count.
        expect(chunk.tokenCount).toBeNull();
        // Embeddings are enabled in this describe block, so every chunk has one.
        expect(chunk.hasEmbedding).toBe(true);
      }
    });

    it("filters chunks by a case-insensitive content substring", async () => {
      const result = await store.listVersionChunks(library, version, {
        limit: 10,
        filter: "WIDGET",
      });

      expect(result.total).toBe(3);
      expect(result.chunks.every((c) => c.content.toLowerCase().includes("widget"))).toBe(
        true,
      );
    });

    it("treats LIKE wildcard characters in the filter as literal text", async () => {
      await store.addDocuments(
        library,
        version,
        1,
        createScrapeResult(
          "Promo",
          "https://example.com/promo",
          "Use code A100 for a discount",
          ["promo"],
        ),
      );

      // "1%0" must be matched literally. "A100" contains "1" followed
      // eventually by "0", so an unescaped '%' wildcard would incorrectly
      // match it even though the literal substring "1%0" isn't present.
      const result = await store.listVersionChunks(library, version, {
        limit: 10,
        filter: "1%0",
      });

      expect(result.total).toBe(0);
      expect(result.chunks).toEqual([]);
    });

    it("computes aggregate stats for the version", async () => {
      const stats = await store.getVersionStats(library, version);

      expect(stats.pageCount).toBe(2);
      expect(stats.chunkCount).toBe(4);
      expect(stats.avgChunksPerPage).toBe(2); // 4 chunks / 2 pages
      expect(stats.avgTokensPerChunk).toBeNull();
      expect(stats.embeddedChunkCount).toBe(4);
    });

    it("returns no chunks and zeroed stats for a version that doesn't exist", async () => {
      expect(await store.listVersionChunks(library, "9.9.9", { limit: 10 })).toEqual({
        chunks: [],
        total: 0,
      });

      const stats = await store.getVersionStats(library, "9.9.9");

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

/**
 * Tests for embedding model change safety:
 * metadata persistence, change detection, vector invalidation, ensureVectorTable.
 */
describe("DocumentStore - Embedding Model Change Safety", () => {
  let store: DocumentStore;
  let originalApiKey: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    mockEmbeddingDimension.value = 1536;
    mockEmbeddingCalls.query = 0;
    mockEmbeddingCalls.documents = 0;
    tempDir = mkdtempSync(join(tmpdir(), "docs-mcp-store-"));
    // Set dummy API key so areCredentialsAvailable("openai") returns true
    // and initializeEmbeddings() proceeds (the actual API call is mocked)
    originalApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key-for-model-change-safety";
  });

  afterEach(async () => {
    if (store) {
      await store.shutdown();
    }
    // Restore original env
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
    // Forget the dimensions tests cached or probed for their models
    EmbeddingConfig.resetInstance();
    rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper: create and initialize a store with the given embedding model spec.
   * Returns the store for further assertions.
   */
  async function createStore(
    modelSpec: string,
    dimension?: number,
    dbPath = ":memory:",
  ): Promise<DocumentStore> {
    const cfg = loadConfig();
    if (modelSpec) {
      const embeddingConfig = EmbeddingConfig.parseEmbeddingConfig(modelSpec);
      cfg.app.embeddingModel = embeddingConfig.modelSpec;
    } else {
      cfg.app.embeddingModel = "";
    }
    if (dimension !== undefined) {
      cfg.embeddings.vectorDimension = dimension;
      markVectorDimensionSource(cfg, true);
    }
    const s = new DocumentStore(dbPath, cfg);
    await s.initialize();
    return s;
  }

  it("reads no embedding metadata before any is written, then the latest written", async () => {
    // FTS-only mode, so initializeEmbeddings writes no metadata
    store = await createStore("");
    expect(store.getEmbeddingMetadata()).toEqual({ model: null, dimension: null });

    store.setEmbeddingMetadata("openai:text-embedding-3-small", 1536);
    expect(store.getEmbeddingMetadata()).toEqual({
      model: "openai:text-embedding-3-small",
      dimension: "1536",
    });

    store.setEmbeddingMetadata("openai:text-embedding-ada-002", 768);
    expect(store.getEmbeddingMetadata()).toEqual({
      model: "openai:text-embedding-ada-002",
      dimension: "768",
    });
  });

  describe("checkEmbeddingModelChange", () => {
    it("throws EmbeddingModelChangedError when the stored model or dimension differs", async () => {
      store = await createStore("openai:text-embedding-3-small");
      const cases: [label: string, model: string, dimension: number][] = [
        ["another model", "openai:text-embedding-ada-002", 1536],
        ["another dimension", "openai:text-embedding-3-small", 768],
      ];

      for (const [label, model, dimension] of cases) {
        store.setEmbeddingMetadata(model, dimension);
        expect
          .soft(() => store.checkEmbeddingModelChange(), label)
          .toThrow(EmbeddingModelChangedError);
      }
    });

    it("reports no change for a match, a first run without metadata, or FTS-only mode", async () => {
      // The model and dimension match the metadata initialize() persisted
      store = await createStore("openai:text-embedding-3-small");
      expect(() => store.checkEmbeddingModelChange()).not.toThrow();
      await store.shutdown();

      // A database without metadata, as an FTS-only run leaves it, opens with a model
      const dbPath = join(tempDir, "first-run.sqlite");
      store = await createStore("", undefined, dbPath);
      expect(store.getEmbeddingMetadata().model).toBeNull();
      await store.shutdown();
      store = await createStore("openai:text-embedding-3-small", undefined, dbPath);
      expect(store.getEmbeddingMetadata().model).toBe("openai:text-embedding-3-small");
      await store.shutdown();

      // FTS-only mode skips the check even when metadata exists from a prior run
      store = await createStore("");
      store.setEmbeddingMetadata("openai:text-embedding-3-small", 1536);
      expect(() => store.checkEmbeddingModelChange()).not.toThrow();
    });

    it("should not throw after restarting with an auto-detected unknown model dimension", async () => {
      mockEmbeddingDimension.value = 1024;
      store = await createStore("openai:custom-1024-model");

      // Metadata was persisted with the resolved dimension, not the default config value.
      expect(store.getEmbeddingMetadata().dimension).toBe("1024");
      expect(() => store.checkEmbeddingModelChange()).not.toThrow();
    });

    it("reports no current dimension for a changed model whose dimension is not known yet", async () => {
      const dbPath = join(tempDir, "changed-to-unknown.sqlite");
      store = await createStore("openai:text-embedding-3-small", undefined, dbPath);
      await store.shutdown();

      const cfg = loadConfig();
      cfg.app.embeddingModel = "openai:custom-unprobed-model";
      store = new DocumentStore(dbPath, cfg);
      const error = await store.initialize().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EmbeddingModelChangedError);
      expect(error).toMatchObject({ previousDimension: "1536", currentDimension: null });
    });
  });

  it("invalidateAllVectors drops every embedding and records the new model and dimension", async () => {
    store = await createStore("openai:text-embedding-3-small");
    await store.addDocuments(
      "testlib",
      "1.0.0",
      1,
      createScrapeResult(
        "Test Doc",
        "https://example.com/test",
        "Some test content for embedding invalidation",
      ),
    );
    expect((await store.getVersionStats("testlib", "1.0.0")).embeddedChunkCount).toBe(1);

    store.invalidateAllVectors("openai:text-embedding-ada-002", 768);

    expect((await store.getVersionStats("testlib", "1.0.0")).embeddedChunkCount).toBe(0);
    expect(store.getEmbeddingMetadata()).toEqual({
      model: "openai:text-embedding-ada-002",
      dimension: "768",
    });
    // The vector table is recreated with the new dimension and its partition keys
    // @ts-expect-error Accessing private property for testing
    const ddl = store.db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'documents_vec'",
      )
      .get() as { sql: string };
    expect(ddl.sql).toContain("FLOAT[768]");
    expect(ddl.sql).toContain("library_id INTEGER partition key");
    expect(ddl.sql).toContain("version_id INTEGER partition key");
  });

  describe("ensureVectorTable", () => {
    it("should create table with configured dimension and no backfill", async () => {
      store = await createStore("openai:text-embedding-3-small");

      // Verify documents_vec exists with the correct dimension
      // @ts-expect-error Accessing private property for testing
      const ddl = store.db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'documents_vec'",
        )
        .get() as { sql: string };
      expect(ddl).toBeDefined();
      expect(ddl.sql).toContain("1536");
      expect(ddl.sql).toContain("library_id INTEGER partition key");
      expect(ddl.sql).toContain("version_id INTEGER partition key");

      // Table should be empty (no backfill)
      // @ts-expect-error Accessing private property for testing
      const count = store.db
        .prepare("SELECT COUNT(*) as cnt FROM documents_vec")
        .get() as { cnt: number };
      expect(count.cnt).toBe(0);
    });

    it("creates the table with the probed dimension for models without a known one", async () => {
      const cases: [label: string, model: string, dimension: number][] = [
        ["an unknown OpenAI-compatible model", "openai:custom-1024-model", 1024],
        ["a variable-dimension known model", "openai:NovaSearch/stella_en_400M_v5", 6144],
      ];

      for (const [label, model, dimension] of cases) {
        mockEmbeddingDimension.value = dimension;
        const probed = await createStore(model);
        try {
          // @ts-expect-error Accessing private property for testing
          const ddl = probed.db
            .prepare(
              "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'documents_vec'",
            )
            .get() as { sql: string };
          expect.soft(ddl.sql, label).toContain(`FLOAT[${dimension}]`);
          expect.soft(probed.getEmbeddingMetadata(), label).toEqual({
            model,
            dimension: String(dimension),
          });
        } finally {
          await probed.shutdown();
        }
      }
    });

    it("reuses the stored dimension for models without a known one, without probing again", async () => {
      const cases: [label: string, model: string, stored: number, probed: number][] = [
        ["an unknown model", "openai:custom-locked-model", 1024, 2048],
        [
          "a variable-dimension known model",
          "openai:NovaSearch/stella_en_400M_v5",
          6144,
          8192,
        ],
      ];

      for (const [index, [label, model, stored, probed]] of cases.entries()) {
        const dbPath = join(tempDir, `locked-${index}.sqlite`);
        mockEmbeddingCalls.query = 0;
        mockEmbeddingDimension.value = stored;
        const firstStore = await createStore(model, undefined, dbPath);
        expect.soft(mockEmbeddingCalls.query, label).toBe(1);
        expect
          .soft(firstStore.getEmbeddingMetadata().dimension, label)
          .toBe(String(stored));
        await firstStore.shutdown();

        // The provider now reports another dimension, but the store does not ask
        mockEmbeddingCalls.query = 0;
        mockEmbeddingDimension.value = probed;
        const reopened = await createStore(model, undefined, dbPath);
        try {
          expect.soft(mockEmbeddingCalls.query, label).toBe(0);
          expect.soft(reopened.getEmbeddingMetadata(), label).toEqual({
            model,
            dimension: String(stored),
          });
          // @ts-expect-error Accessing private property for testing
          const ddl = reopened.db
            .prepare(
              "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'documents_vec'",
            )
            .get() as { sql: string };
          expect.soft(ddl.sql, label).toContain(`FLOAT[${stored}]`);
        } finally {
          await reopened.shutdown();
        }
      }
    });

    it("should respect explicit vector dimension overrides for unknown models", async () => {
      mockEmbeddingDimension.value = 1024;
      store = await createStore("openai:custom-1024-model", 1536);

      // @ts-expect-error Accessing private property for testing
      const ddl = store.db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'documents_vec'",
        )
        .get() as { sql: string };
      expect(ddl.sql).toContain("1536");

      const metadata = store.getEmbeddingMetadata();
      expect(metadata.dimension).toBe("1536");
    });

    it("should reject explicit dimensions smaller than non-MRL model output", async () => {
      mockEmbeddingDimension.value = 1024;

      await expect(createStore("openai:custom-1024-model", 256)).rejects.toThrow(
        DimensionError,
      );
      store = await createStore("");
    });

    it("rejects a dimension that is not a positive integer, whether probed or looked up", async () => {
      EmbeddingConfig.setKnownModelDimensions("invalid-known-dimension-model", 0);
      mockEmbeddingDimension.value = 0;
      const cases: [model: string, message: string][] = [
        [
          "openai:empty-vector-model",
          "Invalid detected embedding dimension from embedding provider probe: 0. Must be a positive integer.",
        ],
        [
          "openai:invalid-known-dimension-model",
          "Invalid detected embedding dimension from known model dimension lookup: 0. Must be a positive integer.",
        ],
      ];

      for (const [model, message] of cases) {
        await expect.soft(createStore(model), model).rejects.toThrow(message);
      }
      store = await createStore("");
    });

    it("keeps the vector table and its vectors when reopened with the same model", async () => {
      const dbPath = join(tempDir, "reopen.sqlite");
      const first = await createStore("openai:text-embedding-3-small", undefined, dbPath);
      await first.addDocuments(
        "testlib",
        "1.0.0",
        1,
        createScrapeResult(
          "Test Doc",
          "https://example.com/test",
          "Content for no-op test",
        ),
      );
      await first.shutdown();
      vi.mocked(logger.info).mockClear();

      store = await createStore("openai:text-embedding-3-small", undefined, dbPath);

      // The table already has the dimension and partition keys, so it is not rebuilt
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining("vector index with partition-key schema"),
      );
      expect((await store.getVersionStats("testlib", "1.0.0")).embeddedChunkCount).toBe(
        1,
      );
      const [hit] = await store.findByContent("testlib", "1.0.0", "no-op test", 5);
      expect(hit.vec_rank).toBe(1);
    });

    it("should recognize partition-key columns with harmless constraint variations", async () => {
      store = await createStore("");
      const hasVectorPartitionKeys = (candidateSql: string) => {
        // @ts-expect-error Accessing private method for testing
        return store.hasVectorPartitionKeys(candidateSql) as boolean;
      };

      expect(
        hasVectorPartitionKeys(`
          CREATE VIRTUAL TABLE documents_vec USING vec0(
            library_id INTEGER NOT NULL partition key,
            version_id INTEGER partition key NOT NULL,
            embedding FLOAT[1536]
          );
        `),
      ).toBe(true);
      expect(
        hasVectorPartitionKeys(`
          CREATE VIRTUAL TABLE documents_vec USING vec0(
            library_id INTEGER NOT NULL,
            version_id INTEGER partition key,
            embedding FLOAT[1536]
          );
        `),
      ).toBe(false);
      expect(
        hasVectorPartitionKeys(`
          CREATE VIRTUAL TABLE documents_vec USING vec0(
            library_id INTEGER partition key,
            version_id INTEGER NOT NULL,
            embedding FLOAT[1536]
          );
        `),
      ).toBe(false);
    });

    it("should rebuild old metadata-column vec table with current partition keys", async () => {
      store = await createStore("");

      // @ts-expect-error Accessing private property for testing
      const db = store.db;
      db.prepare("INSERT INTO libraries (name, display_name) VALUES (?, ?)").run(
        "legacyvec",
        "legacyvec",
      );
      const { id: libraryId } = db
        .prepare("SELECT id FROM libraries WHERE name = ?")
        .get("legacyvec") as { id: number };
      db.prepare("INSERT INTO versions (library_id, name) VALUES (?, ?)").run(
        libraryId,
        "1.0.0",
      );
      const { id: versionId } = db
        .prepare("SELECT id FROM versions WHERE library_id = ? AND name = ?")
        .get(libraryId, "1.0.0") as { id: number };
      db.prepare("INSERT INTO versions (library_id, name) VALUES (?, ?)").run(
        libraryId,
        "2.0.0",
      );
      const { id: staleVersionId } = db
        .prepare("SELECT id FROM versions WHERE library_id = ? AND name = ?")
        .get(libraryId, "2.0.0") as { id: number };
      const pageId = db
        .prepare("INSERT INTO pages (version_id, url, title) VALUES (?, ?, ?)")
        .run(versionId, "https://example.com/legacy", "Legacy Vec").lastInsertRowid;
      const vector = new Array(1536).fill(0).map((_, index) => (index === 0 ? 1 : 0));
      const docId = db
        .prepare(
          "INSERT INTO documents (page_id, content, metadata, sort_order) VALUES (?, ?, ?, ?)",
        )
        .run(
          pageId,
          "legacy vector content",
          JSON.stringify({ path: ["legacy"] }),
          0,
        ).lastInsertRowid;

      db.exec(`
        DROP TABLE documents_vec;
        CREATE VIRTUAL TABLE documents_vec USING vec0(
          library_id INTEGER NOT NULL,
          version_id INTEGER NOT NULL,
          embedding FLOAT[1536]
        );
      `);
      db.prepare(
        "INSERT INTO documents_vec (rowid, library_id, version_id, embedding) VALUES (?, ?, ?, ?)",
      ).run(
        BigInt(docId),
        BigInt(libraryId),
        BigInt(staleVersionId),
        JSON.stringify(vector),
      );

      // @ts-expect-error Accessing private method for testing
      store.ensureVectorTable();

      const ddl = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'documents_vec'",
        )
        .get() as { sql: string };
      expect(ddl.sql).toContain("library_id INTEGER partition key");
      expect(ddl.sql).toContain("version_id INTEGER partition key");

      const vectorRows = db
        .prepare("SELECT COUNT(*) as cnt FROM documents_vec WHERE rowid = ?")
        .get(docId) as { cnt: number };
      expect(vectorRows.cnt).toBe(1);
      const partitionKeys = db
        .prepare("SELECT library_id, version_id FROM documents_vec WHERE rowid = ?")
        .get(docId) as { library_id: number; version_id: number };
      expect(partitionKeys.library_id).toBe(libraryId);
      expect(partitionKeys.version_id).toBe(versionId);

      const result = db
        .prepare(`
          SELECT rowid, distance
          FROM documents_vec
          WHERE library_id = ?
            AND version_id = ?
            AND embedding MATCH ?
            AND k = 1
        `)
        .get(libraryId, versionId, JSON.stringify(vector)) as
        | { rowid: number; distance: number }
        | undefined;

      expect(result?.rowid).toBe(Number(docId));
      expect(result?.distance).toBeCloseTo(0, 6);
    });
  });
});

describe("DocumentStore - compaction", () => {
  let store: DocumentStore | undefined;
  let tempDir: string;
  type TestDb = {
    pragma(sql: string, options?: { simple?: boolean }): unknown;
    exec(sql: string): unknown;
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "docs-mcp-compact-"));
  });

  afterEach(async () => {
    if (store) {
      await store.shutdown();
      store = undefined;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("skips compaction for in-memory databases", async () => {
    const cfg = loadConfig();
    cfg.app.embeddingModel = "";
    store = new DocumentStore(":memory:", cfg);
    await store.initialize();

    const result = await store.compact({ force: true });
    expect(result.skipped).toBe(true);
    expect(result.vacuumed).toBe(false);
    expect(result.reclaimedBytes).toBe(0);
  });

  it("reclaims disk space after deleting documents", async () => {
    const cfg = loadConfig();
    cfg.app.embeddingModel = "";
    store = new DocumentStore(join(tempDir, "documents.db"), cfg);
    await store.initialize();

    const payload = "x".repeat(50_000);
    for (let i = 0; i < 20; i++) {
      await store.addDocuments(
        "compactlib",
        "1.0.0",
        1,
        createScrapeResult(`Page ${i}`, `https://example.com/page-${i}`, payload),
      );
    }

    await store.deletePages("compactlib", "1.0.0");

    const result = await store.compact({ force: false });
    expect(result.skipped).toBe(false);
    expect(result.vacuumed).toBe(true);
    expect(result.afterBytes).toBeLessThan(result.beforeBytes);
    expect(result.reclaimedBytes).toBeGreaterThan(0);

    const second = await store.compact({ force: false });
    expect(second.vacuumed).toBe(false);
  });

  it("returns the store to its empty size after all pages are deleted", async () => {
    const cfg = loadConfig();
    cfg.app.embeddingModel = "";
    store = new DocumentStore(join(tempDir, "documents.db"), cfg);
    await store.initialize();
    const emptyBytes = (await store.compact({ force: true })).afterBytes;

    // Varied vocabulary gives the full-text index real weight; every page is
    // its own transaction and so its own index segment, as during a scrape.
    for (let i = 0; i < 20; i++) {
      const words = Array.from({ length: 3000 }, (_, j) => `term${i}w${j}`).join(" ");
      await store.addDocuments(
        "compactlib",
        "1.0.0",
        1,
        createScrapeResult(`Page ${i}`, `https://example.com/page-${i}`, words),
      );
    }
    await store.deletePages("compactlib", "1.0.0");

    const result = await store.compact({ force: false });
    expect(result.afterBytes - emptyBytes).toBeLessThan(64 * 1024);
  });

  it("does not vacuum when vacuum is false", async () => {
    const cfg = loadConfig();
    cfg.app.embeddingModel = "";
    store = new DocumentStore(join(tempDir, "documents.db"), cfg);
    await store.initialize();

    const payload = "x".repeat(50_000);
    for (let i = 0; i < 20; i++) {
      await store.addDocuments(
        "compactlib",
        "1.0.0",
        1,
        createScrapeResult(`Page ${i}`, `https://example.com/page-${i}`, payload),
      );
    }

    await store.deletePages("compactlib", "1.0.0");

    const result = await store.compact({ force: false, vacuum: false });
    expect(result.skipped).toBe(false);
    expect(result.vacuumed).toBe(false);
  });

  it("uses file temp storage during vacuum and restores the previous setting", async () => {
    const cfg = loadConfig();
    cfg.app.embeddingModel = "";
    store = new DocumentStore(join(tempDir, "documents.db"), cfg);
    await store.initialize();

    const db = (store as unknown as { db: TestDb }).db;
    db.pragma("temp_store = MEMORY");

    const originalExec = db.exec.bind(db);
    let tempStoreDuringVacuum: number | undefined;
    db.exec = (sql: string): unknown => {
      if (sql === "VACUUM") {
        tempStoreDuringVacuum = Number(db.pragma("temp_store", { simple: true }));
      }
      return originalExec(sql);
    };

    await store.compact({ force: true });

    expect(tempStoreDuringVacuum).toBe(1);
    expect(Number(db.pragma("temp_store", { simple: true }))).toBe(2);
  });
});

/**
 * A page can be reached both as a published Markdown file and as an HTML page —
 * one document under two URLs that resolve to a single identity. Markdown is the
 * representation the site's authors published; converting HTML ourselves is the
 * fallback for sites that offer nothing better. Writes are otherwise
 * last-one-wins, so without an explicit rule the winner would be decided by
 * crawl order.
 */
describe("DocumentStore - Markdown representation precedence", () => {
  let store: DocumentStore;

  const resultWith = (sourceContentType: string, content: string): ScrapeResult => ({
    url: "https://example.com/guide",
    title: "Guide",
    sourceContentType,
    contentType: "text/markdown",
    textContent: content,
    links: [],
    errors: [],
    chunks: [{ types: ["text"], content, section: { level: 0, path: [] } }],
  });

  /**
   * The second representation of a page reached during one crawl.
   *
   * Precedence decides between two routes to the same document, so it applies
   * only to a write the crawl has flagged as competing with one it already
   * made. A plain write is the new state of the page and always lands.
   */
  const competingWith = (sourceContentType: string, content: string): ScrapeResult => ({
    ...resultWith(sourceContentType, content),
    isAdditionalRepresentation: true,
  });

  const storedContent = async (): Promise<string[]> => {
    const results = await store.findChunksByUrl(
      "lib",
      "1.0",
      "https://example.com/guide",
    );
    return results.map((r) => r.content);
  };

  beforeEach(async () => {
    store = new DocumentStore(":memory:", configWith(""));
    await store.initialize();
  });

  afterEach(async () => {
    if (store) await store.shutdown();
  });

  it("keeps markdown whichever representation was stored first", async () => {
    const orders: [label: string, first: ScrapeResult, second: ScrapeResult][] = [
      [
        "markdown first",
        resultWith("text/markdown", "md"),
        competingWith("text/html", "html"),
      ],
      [
        "html first",
        resultWith("text/html", "html"),
        competingWith("text/markdown", "md"),
      ],
    ];

    for (const [label, first, second] of orders) {
      const orderStore = new DocumentStore(":memory:", configWith(""));
      await orderStore.initialize();
      try {
        await orderStore.addDocuments("lib", "1.0", 0, first);
        await orderStore.addDocuments("lib", "1.0", 0, second);
        const chunks = await orderStore.findChunksByUrl(
          "lib",
          "1.0",
          "https://example.com/guide",
        );
        expect
          .soft(
            chunks.map((chunk) => chunk.content),
            label,
          )
          .toEqual(["md"]);
      } finally {
        await orderStore.shutdown();
      }
    }
  });

  it("decides on the recorded type, leaving the markdown judgement upstream", async () => {
    // The store's rule is only markdown-vs-not. Whether a `.md` URL answered as
    // `text/plain` counts as Markdown is settled before the write, by
    // `WebScraperStrategy.asMarkdownRepresentation`, which restates it — so a
    // `text/plain` arriving here is a genuine plain-text page and loses to
    // stored Markdown like any other non-Markdown representation.
    await store.addDocuments("lib", "1.0", 0, resultWith("text/markdown", "md body"));
    await store.addDocuments("lib", "1.0", 0, competingWith("text/plain", "txt body"));

    expect(await storedContent()).toEqual(["md body"]);
  });

  it("lets a later crawl replace markdown with html", async () => {
    // Precedence settles a race between two routes in one crawl. A write that
    // is not competing is the page's new state, so a site that stopped
    // publishing its markdown does not freeze on the last copy we hold.
    await store.addDocuments("lib", "1.0", 0, resultWith("text/markdown", "old md"));
    await store.addDocuments("lib", "1.0", 0, resultWith("text/html", "new html"));

    expect(await storedContent()).toEqual(["new html"]);
  });

  it("retires the row a losing write came from", async () => {
    // A refresh reaches one page by two spellings. The write that loses on
    // precedence is the only thing that knows its old spelling folded into this
    // identity, so it still has to retire that row — otherwise the old one stays
    // searchable with stale content and loses again on every later refresh.
    const legacy: ScrapeResult = {
      ...resultWith("text/html", "stale html body"),
      url: "https://example.com/guide/index.html",
    };
    await store.addDocuments("lib", "1.0", 0, legacy);
    const pageByUrl = async (url: string) => {
      const versionId = await store.resolveVersionId("lib", "1.0");
      return (await store.getPagesByVersionId(versionId)).find((p) => p.url === url);
    };
    const legacyPage = await pageByUrl("https://example.com/guide/index.html");
    expect(legacyPage).toBeDefined();

    await store.addDocuments("lib", "1.0", 0, resultWith("text/markdown", "fresh md"));
    // The HTML spelling now resolves onto the same identity and loses.
    await store.addDocuments(
      "lib",
      "1.0",
      0,
      competingWith("text/html", "stale html body"),
      legacyPage?.id,
    );

    expect(await storedContent()).toEqual(["fresh md"]);
    expect(await pageByUrl("https://example.com/guide/index.html")).toBeUndefined();
  });

  it("does not retire the previous row when there is nothing to store", async () => {
    // A result with no chunks means the pipeline learned nothing. Retiring the
    // page it came from would delete indexed content and put nothing back.
    await store.addDocuments("lib", "1.0", 0, resultWith("text/markdown", "kept"));
    const versionId = await store.resolveVersionId("lib", "1.0");
    const page = (await store.getPagesByVersionId(versionId)).find(
      (p) => p.url === "https://example.com/guide",
    );
    await store.addDocuments(
      "lib",
      "1.0",
      0,
      { ...resultWith("text/html", ""), chunks: [] },
      page?.id,
    );

    expect(await storedContent()).toEqual(["kept"]);
  });

  it("still replaces a representation with a newer one of the same type", async () => {
    // The rule is about representation, not about freezing the page.
    for (const type of ["text/markdown", "text/html"]) {
      await store.addDocuments("lib", "1.0", 0, resultWith(type, `first ${type}`));
      await store.addDocuments("lib", "1.0", 0, resultWith(type, `second ${type}`));

      expect.soft(await storedContent(), type).toEqual([`second ${type}`]);
    }
  });
});

describe("DocumentStore - concurrent writes to one identity", () => {
  let store: DocumentStore;

  const resultWith = (sourceContentType: string, content: string): ScrapeResult => ({
    url: "https://example.com/guide",
    title: "Guide",
    sourceContentType,
    contentType: "text/markdown",
    textContent: content,
    links: [],
    errors: [],
    chunks: [{ types: ["text"], content, section: { level: 0, path: [] } }],
  });

  /**
   * The second representation of a page reached during one crawl.
   *
   * Precedence decides between two routes to the same document, so it applies
   * only to a write the crawl has flagged as competing with one it already
   * made. A plain write is the new state of the page and always lands.
   */
  const competingWith = (sourceContentType: string, content: string): ScrapeResult => ({
    ...resultWith(sourceContentType, content),
    isAdditionalRepresentation: true,
  });

  beforeEach(async () => {
    // Vector search on, so embedding introduces a real await between reading
    // the page row and writing it — which is the window the race lives in.
    mockEmbeddingDimension.value = 1536;
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    store = new DocumentStore(":memory:", configWith("openai:text-embedding-3-small"));
    await store.initialize();
  });

  afterEach(async () => {
    if (store) await store.shutdown();
    vi.unstubAllEnvs();
  });

  /**
   * Holds every embedding call open until `count` writers have reached it, so
   * they are provably in flight together. `Promise.all` alone does not guarantee
   * that: whichever chain needs fewer microtask turns can finish outright
   * before the other reads the page row, and then there is no race to observe.
   */
  function blockEmbeddingsUntilAllArrive(count: number): void {
    const embedDocuments = vi.mocked(embeddingsOf(store).embedDocuments);
    const original = embedDocuments.getMockImplementation();
    if (!original) {
      throw new Error("The embedding model mock has no implementation");
    }
    let arrived = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    embedDocuments.mockImplementation(async (texts) => {
      arrived++;
      if (arrived >= count) release();
      await gate;
      return original(texts);
    });
  }

  it("keeps one chunk set, the markdown one, when both representations are written at once", async () => {
    // Pins the observable property: two concurrent writes to one identity leave
    // one chunk set, and it is the Markdown one, whichever write is scheduled
    // first. The crawl flags whichever representation it reached second.
    //
    // It does not discriminate the in-transaction re-read that guards the
    // read-then-write window — reverting that still passes here, because
    // better-sqlite3 transactions are synchronous and a writer that enters one
    // completes before the other starts. The re-read is justified by reasoning
    // rather than by this test.
    blockEmbeddingsUntilAllArrive(4);

    await Promise.all([
      store.addDocuments(
        "markdown-first",
        "1.0",
        0,
        resultWith("text/markdown", "from markdown"),
      ),
      store.addDocuments(
        "markdown-first",
        "1.0",
        0,
        competingWith("text/html", "from html"),
      ),
      store.addDocuments("html-first", "1.0", 0, resultWith("text/html", "from html")),
      store.addDocuments(
        "html-first",
        "1.0",
        0,
        competingWith("text/markdown", "from markdown"),
      ),
    ]);

    for (const library of ["markdown-first", "html-first"]) {
      const chunks = await store.findChunksByUrl(
        library,
        "1.0",
        "https://example.com/guide",
      );
      expect
        .soft(
          chunks.map((chunk) => chunk.content),
          library,
        )
        .toEqual(["from markdown"]);
    }
  });
});

describe("DocumentStore - Page Lookup", () => {
  let store: DocumentStore;

  const addPage = (url: string, depth = 1, extra: Partial<ScrapeResult> = {}) =>
    store.addDocuments("lib", "1.0", depth, {
      ...createScrapeResult(`Title of ${url}`, url, `content of ${url}`),
      ...extra,
    });

  beforeEach(async () => {
    store = new DocumentStore(":memory:", configWith(""));
    await store.initialize();
  });

  afterEach(async () => {
    await store.shutdown();
  });

  describe("findPageUrls", () => {
    it("finds a page by the content URL it was fetched from, only in its own version", async () => {
      await addPage("https://x.dev/guide", 1, { contentUrl: "https://x.dev/guide.md" });

      expect(await store.findPageUrls("lib", "1.0", ["https://x.dev/guide.md"])).toEqual([
        "https://x.dev/guide",
      ]);
      // A library version that does not exist has no pages
      expect(await store.findPageUrls("lib", "2.0", ["https://x.dev/guide"])).toEqual([]);
    });
  });

  describe("findPageUrlsBySuffix", () => {
    it("returns every page whose URL ends with the suffix", async () => {
      await addPage("https://x.dev/v1/api");
      await addPage("https://x.dev/v2/api");
      await addPage("https://x.dev/v2/myapi");

      const urls = await store.findPageUrlsBySuffix("lib", "1.0", ["/api"], 10);

      expect(urls.sort()).toEqual(["https://x.dev/v1/api", "https://x.dev/v2/api"]);
    });

    it("ignores a trailing slash on the stored URL", async () => {
      await addPage("https://x.dev/docs/guide/");

      const urls = await store.findPageUrlsBySuffix("lib", "1.0", ["/docs/guide"], 10);

      expect(urls).toEqual(["https://x.dev/docs/guide/"]);
    });

    it("treats LIKE wildcards in the suffix as literal characters", async () => {
      await addPage("https://x.dev/docs/a_b");
      await addPage("https://x.dev/docs/axb");

      const urls = await store.findPageUrlsBySuffix("lib", "1.0", ["/docs/a_b"], 10);

      expect(urls).toEqual(["https://x.dev/docs/a_b"]);
    });
  });

  describe("listPages", () => {
    it("lists pages ordered by depth, then URL, with the total count", async () => {
      await addPage("https://x.dev/docs/b", 2);
      await addPage("https://x.dev/docs/a", 2);
      await addPage("https://x.dev/", 0);

      const result = await store.listPages("lib", "1.0", {});

      expect(result.total).toBe(3);
      expect(result.pages.map((p) => p.url)).toEqual([
        "https://x.dev/",
        "https://x.dev/docs/a",
        "https://x.dev/docs/b",
      ]);
    });

    it("returns the requested page of results", async () => {
      await addPage("https://x.dev/a");
      await addPage("https://x.dev/b");
      await addPage("https://x.dev/c");

      const result = await store.listPages("lib", "1.0", { limit: 1, offset: 1 });

      expect(result.total).toBe(3);
      expect(result.pages.map((p) => p.url)).toEqual(["https://x.dev/b"]);
    });

    it("keeps only pages whose URL contains the filter anywhere", async () => {
      await addPage("https://x.dev/docs/components/button");
      await addPage("https://x.dev/blog/components");
      await addPage("https://x.dev/docs/hooks");

      const result = await store.listPages("lib", "1.0", { contains: "components" });

      expect(result.total).toBe(2);
      expect(result.pages.map((p) => p.url).sort()).toEqual([
        "https://x.dev/blog/components",
        "https://x.dev/docs/components/button",
      ]);
    });
  });
});
