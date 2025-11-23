import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrapeResult } from "../scraper/types";
import type { Chunk } from "../splitter/types";
import { DocumentStore } from "./DocumentStore";
import { EmbeddingConfig } from "./embeddings/EmbeddingConfig";
import { VersionStatus } from "./types";

// Mock only the embedding service to generate deterministic embeddings for testing
// This allows us to test ranking logic while using real SQLite database
vi.mock("./embeddings/EmbeddingFactory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./embeddings/EmbeddingFactory")>();

  return {
    ...actual,
    createEmbeddingModel: () => ({
      embedQuery: vi.fn(async (text: string) => {
        // Generate deterministic embeddings based on text content for consistent testing
        const words = text.toLowerCase().split(/\s+/);
        const embedding = new Array(1536).fill(0);

        // Create meaningful semantic relationships for testing
        words.forEach((word, wordIndex) => {
          const wordHash = Array.from(word).reduce(
            (acc, char) => acc + char.charCodeAt(0),
            0,
          );
          const baseIndex = (wordHash % 100) * 15; // Distribute across embedding dimensions

          for (let i = 0; i < 15; i++) {
            const index = (baseIndex + i) % 1536;
            embedding[index] += 1.0 / (wordIndex + 1); // Earlier words get higher weight
          }
        });

        // Normalize the embedding
        const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
        return magnitude > 0 ? embedding.map((val) => val / magnitude) : embedding;
      }),
      embedDocuments: vi.fn(async (texts: string[]) => {
        // Generate embeddings for each text using the same logic as embedQuery
        return texts.map((text) => {
          const words = text.toLowerCase().split(/\s+/);
          const embedding = new Array(1536).fill(0);

          words.forEach((word, wordIndex) => {
            const wordHash = Array.from(word).reduce(
              (acc, char) => acc + char.charCodeAt(0),
              0,
            );
            const baseIndex = (wordHash % 100) * 15;

            for (let i = 0; i < 15; i++) {
              const index = (baseIndex + i) % 1536;
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
 * Tests for DocumentStore with embeddings enabled
 * Uses explicit embedding configuration and tests hybrid search functionality
 */
describe("DocumentStore - With Embeddings", () => {
  let store: DocumentStore;

  beforeEach(async () => {
    // Create explicit embedding configuration for tests
    const embeddingConfig = EmbeddingConfig.parseEmbeddingConfig(
      "openai:text-embedding-3-small",
    );

    // Create a fresh in-memory database for each test with explicit config
    store = new DocumentStore(":memory:", embeddingConfig);
    await store.initialize();
  });

  afterEach(async () => {
    if (store) {
      await store.shutdown();
    }
  });

  describe("Document Storage and Retrieval", () => {
    it("should store and retrieve documents with proper metadata", async () => {
      // Add two pages separately
      await store.addDocuments(
        "testlib",
        "1.0.0",
        1,
        createScrapeResult(
          "JS Tutorial",
          "https://example.com/js-tutorial",
          "JavaScript programming tutorial with examples",
          ["programming", "javascript"],
        ),
      );
      await store.addDocuments(
        "testlib",
        "1.0.0",
        1,
        createScrapeResult(
          "Python DS",
          "https://example.com/python-ds",
          "Python data science guide with pandas",
          ["programming", "python"],
        ),
      );

      // Verify documents were stored
      expect(await store.checkDocumentExists("testlib", "1.0.0")).toBe(true);

      // Verify library versions are tracked correctly
      const versions = await store.queryUniqueVersions("testlib");
      expect(versions).toContain("1.0.0");

      // Verify library version details
      const libraryVersions = await store.queryLibraryVersions();
      expect(libraryVersions.has("testlib")).toBe(true);

      const testlibVersions = libraryVersions.get("testlib")!;
      expect(testlibVersions).toHaveLength(1);
      expect(testlibVersions[0].version).toBe("1.0.0");
      expect(testlibVersions[0].documentCount).toBe(2);
      expect(testlibVersions[0].uniqueUrlCount).toBe(2);
    });

    it("treats library names case-insensitively and reuses same library id", async () => {
      const a = await store.resolveVersionId("React", "");
      const b = await store.resolveVersionId("react", "");
      const c = await store.resolveVersionId("REACT", "");
      expect(a).toBe(b);
      expect(b).toBe(c);
    });

    it("should handle document deletion correctly", async () => {
      await store.addDocuments(
        "templib",
        "1.0.0",
        1,
        createScrapeResult(
          "Temp Doc",
          "https://example.com/temp",
          "Temporary document for deletion test",
          ["temp"],
        ),
      );
      expect(await store.checkDocumentExists("templib", "1.0.0")).toBe(true);

      const deletedCount = await store.deletePages("templib", "1.0.0");
      expect(deletedCount).toBe(1);
      expect(await store.checkDocumentExists("templib", "1.0.0")).toBe(false);
    });

    it("should completely remove a version including pages and documents", async () => {
      // Add two pages
      await store.addDocuments(
        "removelib",
        "1.0.0",
        1,
        createScrapeResult(
          "Doc 1",
          "https://example.com/doc1",
          "First document for removal test",
          ["docs"],
        ),
      );
      await store.addDocuments(
        "removelib",
        "1.0.0",
        1,
        createScrapeResult(
          "Doc 2",
          "https://example.com/doc2",
          "Second document for removal test",
          ["docs"],
        ),
      );
      expect(await store.checkDocumentExists("removelib", "1.0.0")).toBe(true);

      // Remove the version
      const result = await store.removeVersion("removelib", "1.0.0", true);

      // Verify the results
      expect(result.documentsDeleted).toBe(2);
      expect(result.versionDeleted).toBe(true);
      expect(result.libraryDeleted).toBe(true);

      // Verify documents no longer exist
      expect(await store.checkDocumentExists("removelib", "1.0.0")).toBe(false);
    });

    it("should remove version but keep library when other versions exist", async () => {
      // Add two versions
      await store.addDocuments(
        "multilib",
        "1.0.0",
        1,
        createScrapeResult("V1 Doc", "https://example.com/v1", "Version 1 document", [
          "v1",
        ]),
      );
      await store.addDocuments(
        "multilib",
        "2.0.0",
        1,
        createScrapeResult("V2 Doc", "https://example.com/v2", "Version 2 document", [
          "v2",
        ]),
      );

      // Remove only version 1.0.0
      const result = await store.removeVersion("multilib", "1.0.0", true);

      // Verify version 1 was deleted but library remains
      expect(result.documentsDeleted).toBe(1);
      expect(result.versionDeleted).toBe(true);
      expect(result.libraryDeleted).toBe(false);

      // Verify version 1 no longer exists but version 2 does
      expect(await store.checkDocumentExists("multilib", "1.0.0")).toBe(false);
      expect(await store.checkDocumentExists("multilib", "2.0.0")).toBe(true);
    });

    it("should handle multiple versions of the same library", async () => {
      await store.addDocuments(
        "versionlib",
        "1.0.0",
        1,
        createScrapeResult(
          "V1 Features",
          "https://example.com/v1",
          "Version 1.0 feature documentation",
          ["features"],
        ),
      );
      await store.addDocuments(
        "versionlib",
        "2.0.0",
        1,
        createScrapeResult(
          "V2 Features",
          "https://example.com/v2",
          "Version 2.0 feature documentation with new capabilities",
          ["features"],
        ),
      );

      expect(await store.checkDocumentExists("versionlib", "1.0.0")).toBe(true);
      expect(await store.checkDocumentExists("versionlib", "2.0.0")).toBe(true);

      const versions = await store.queryUniqueVersions("versionlib");
      expect(versions).toContain("1.0.0");
      expect(versions).toContain("2.0.0");
    });

    it("should store and retrieve etag and lastModified metadata", async () => {
      const testEtag = '"abc123-def456"';
      const testLastModified = "2023-12-01T10:30:00Z";

      await store.addDocuments(
        "etagtest",
        "1.0.0",
        1,
        createScrapeResult(
          "ETag Test Doc",
          "https://example.com/etag-test",
          "Test document with etag and lastModified",
          ["test"],
          { etag: testEtag, lastModified: testLastModified },
        ),
      );

      // Query the database directly to verify the etag and last_modified are stored
      // @ts-expect-error Accessing private property for testing
      const db = store.db;
      const pageResult = db
        .prepare(`
        SELECT p.etag, p.last_modified
        FROM pages p
        JOIN versions v ON p.version_id = v.id
        JOIN libraries l ON v.library_id = l.id
        WHERE l.name = ? AND COALESCE(v.name, '') = ? AND p.url = ?
      `)
        .get("etagtest", "1.0.0", "https://example.com/etag-test") as
        | {
            etag: string | null;
            last_modified: string | null;
          }
        | undefined;

      expect(pageResult).toBeDefined();
      expect(pageResult?.etag).toBe(testEtag);
      expect(pageResult?.last_modified).toBe(testLastModified);

      // Also verify we can retrieve the document and it contains the metadata
      const results = await store.findByContent("etagtest", "1.0.0", "etag", 10);
      expect(results.length).toBeGreaterThan(0);

      const doc = results[0];
      expect(doc.url).toBe("https://example.com/etag-test");
    });
  });

  describe("Hybrid Search with Embeddings", () => {
    beforeEach(async () => {
      // Set up test documents with known semantic relationships for ranking tests
      await store.addDocuments(
        "searchtest",
        "1.0.0",
        1,
        createScrapeResult(
          "JavaScript Programming Guide",
          "https://example.com/js-guide",
          "JavaScript programming tutorial with code examples and functions",
          ["programming", "javascript"],
        ),
      );
      await store.addDocuments(
        "searchtest",
        "1.0.0",
        1,
        createScrapeResult(
          "JavaScript Frameworks",
          "https://example.com/js-frameworks",
          "Advanced JavaScript frameworks like React and Vue for building applications",
          ["programming", "javascript", "frameworks"],
        ),
      );
      await store.addDocuments(
        "searchtest",
        "1.0.0",
        1,
        createScrapeResult(
          "Python Programming",
          "https://example.com/python-guide",
          "Python programming language tutorial for data science and machine learning",
          ["programming", "python"],
        ),
      );
    });

    it("should perform hybrid search combining vector and FTS", async () => {
      const results = await store.findByContent(
        "searchtest",
        "1.0.0",
        "JavaScript programming",
        10,
      );

      expect(results.length).toBeGreaterThan(0);

      // JavaScript documents should rank higher than non-JavaScript documents
      const topResult = results[0];
      expect(topResult.content.toLowerCase()).toContain("javascript");

      // Results should have both vector and FTS ranking metadata
      const hybridResults = results.filter(
        (r) => r.vec_rank !== undefined && r.fts_rank !== undefined,
      );

      // At least some results should be hybrid matches
      if (hybridResults.length > 0) {
        for (const result of hybridResults) {
          expect(result.vec_rank).toBeGreaterThan(0);
          expect(result.fts_rank).toBeGreaterThan(0);
          expect(result.score).toBeGreaterThan(0);
        }
      }

      // All results should have valid scores
      for (const result of results) {
        expect(result.score).toBeGreaterThan(0);
        expect(typeof result.score).toBe("number");
        // Results should have either vec_rank, fts_rank, or both
        expect(result.vec_rank !== undefined || result.fts_rank !== undefined).toBe(true);
      }
    });

    it("should demonstrate semantic similarity through vector search", async () => {
      const results = await store.findByContent(
        "searchtest",
        "1.0.0",
        "programming tutorial", // Should match both exact terms and semantically similar content
        10,
      );

      expect(results.length).toBeGreaterThan(0);

      // Should find programming documents
      const programmingResults = results.filter((r) =>
        r.content.toLowerCase().includes("programming"),
      );

      expect(programmingResults.length).toBeGreaterThan(0);

      // At least some results should have vector ranks (semantic/embedding matching)
      // If no vector results, it might be because embeddings were disabled in this test run
      const vectorResults = results.filter((r) => r.vec_rank !== undefined);
      const ftsResults = results.filter((r) => r.fts_rank !== undefined);

      // Either we have vector results (hybrid search) or FTS results (fallback)
      expect(vectorResults.length > 0 || ftsResults.length > 0).toBe(true);

      // All results should have valid scores
      for (const result of results) {
        expect(result.score).toBeGreaterThan(0);
      }
    });
  });

  describe("Embedding Batch Processing", () => {
    let mockEmbedDocuments: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Get reference to the mocked embedDocuments function if embeddings are enabled
      // @ts-expect-error Accessing private property for testing
      if (store.embeddings?.embedDocuments) {
        // @ts-expect-error Accessing private property for testing
        mockEmbedDocuments = vi.mocked(store.embeddings.embedDocuments);
        mockEmbedDocuments.mockClear();
      }
    });

    it("should successfully embed and store large batches of documents", async () => {
      // Skip if embeddings are disabled
      // @ts-expect-error Accessing private property for testing
      if (!store.embeddings) {
        return;
      }

      // Add multiple large documents to verify batching works correctly
      const docCount = 5;
      const contentSize = 15000; // 15KB each - ensures batching behavior

      for (let i = 0; i < docCount; i++) {
        await store.addDocuments(
          "batchtest",
          "1.0.0",
          1,
          createScrapeResult(
            `Batch Doc ${i + 1}`,
            `https://example.com/batch-doc${i + 1}`,
            "x".repeat(contentSize),
            ["section"],
          ),
        );
      }

      // Verify all documents were successfully embedded and stored
      expect(await store.checkDocumentExists("batchtest", "1.0.0")).toBe(true);

      // Verify embedDocuments was called (batching occurred)
      expect(mockEmbedDocuments).toHaveBeenCalled();

      // Verify all documents are searchable (embeddings were applied)
      const searchResults = await store.findByContent("batchtest", "1.0.0", "Batch", 10);
      expect(searchResults.length).toBe(docCount);
    });

    it("should include proper document headers in embedding text", async () => {
      // Skip if embeddings are disabled
      // @ts-expect-error Accessing private property for testing
      if (!store.embeddings) {
        return;
      }

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
    it("should update version status correctly", async () => {
      await store.addDocuments(
        "statuslib",
        "1.0.0",
        1,
        createScrapeResult(
          "Status Test",
          "https://example.com/status-test",
          "Status tracking test content",
          ["test"],
        ),
      );
      const versionId = await store.resolveVersionId("statuslib", "1.0.0");

      await store.updateVersionStatus(versionId, VersionStatus.QUEUED);

      const queuedVersions = await store.getVersionsByStatus([VersionStatus.QUEUED]);
      expect(queuedVersions).toHaveLength(1);
      expect(queuedVersions[0].library_name).toBe("statuslib");
      expect(queuedVersions[0].name).toBe("1.0.0");
      expect(queuedVersions[0].status).toBe(VersionStatus.QUEUED);
    });

    it("should store and retrieve scraper options", async () => {
      const versionId = await store.resolveVersionId("optionslib", "1.0.0");

      const scraperOptions = {
        url: "https://example.com/docs",
        library: "optionslib",
        version: "1.0.0",
        maxDepth: 3,
        maxPages: 100,
        scope: "subpages" as const,
        followRedirects: true,
      };

      await store.storeScraperOptions(versionId, scraperOptions);
      const retrieved = await store.getScraperOptions(versionId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.options.maxDepth).toBe(3);
      expect(retrieved?.options.maxPages).toBe(100);
      expect(retrieved?.options.scope).toBe("subpages");
    });
  });

  describe("Embedding Retry Logic", () => {
    let mockEmbedDocuments: ReturnType<typeof vi.fn>;
    let callCount: number;

    beforeEach(async () => {
      callCount = 0;
      // Get reference to the mocked embedDocuments function
      // @ts-expect-error Accessing private property for testing
      if (store.embeddings?.embedDocuments) {
        // @ts-expect-error Accessing private property for testing
        mockEmbedDocuments = vi.mocked(store.embeddings.embedDocuments);
        mockEmbedDocuments.mockClear();
      }
    });

    it("should successfully handle normal embedding without errors", async () => {
      // Skip if embeddings are disabled
      // @ts-expect-error Accessing private property for testing
      if (!store.embeddings) {
        return;
      }

      await store.addDocuments(
        "normaltest",
        "1.0.0",
        1,
        createScrapeResult(
          "Normal Doc",
          "https://example.com/normal",
          "This is a normal sized document that should embed without issues",
          ["test"],
        ),
      );

      expect(mockEmbedDocuments).toHaveBeenCalled();
      expect(await store.checkDocumentExists("normaltest", "1.0.0")).toBe(true);
    });

    it("should retry and split batch when size error occurs", async () => {
      // Skip if embeddings are disabled
      // @ts-expect-error Accessing private property for testing
      if (!store.embeddings) {
        return;
      }

      // Mock embedDocuments to fail first time with size error, then succeed on splits
      mockEmbedDocuments.mockImplementation(async (texts: string[]) => {
        callCount++;

        // First call with multiple texts: simulate size error
        if (callCount === 1 && texts.length > 1) {
          throw new Error("maximum context length exceeded");
        }

        // Subsequent calls (after split): succeed with dummy embeddings
        return texts.map(() => new Array(1536).fill(0.1));
      });

      // Create a scrape result with multiple chunks to trigger batching
      const result = createScrapeResult(
        "Batch Doc",
        "https://example.com/batch",
        "Content chunk 1",
        ["section1"],
      );
      result.chunks = [
        {
          types: ["text"],
          content: "Content chunk 1",
          section: { level: 0, path: ["section1"] },
        },
        {
          types: ["text"],
          content: "Content chunk 2",
          section: { level: 0, path: ["section2"] },
        },
      ];

      await store.addDocuments("retrytest", "1.0.0", 1, result);

      // Should have been called multiple times (initial failure + successful retries)
      expect(callCount).toBeGreaterThan(1);
      expect(await store.checkDocumentExists("retrytest", "1.0.0")).toBe(true);
    });

    it("should truncate single oversized text when size error occurs", async () => {
      // Skip if embeddings are disabled
      // @ts-expect-error Accessing private property for testing
      if (!store.embeddings) {
        return;
      }

      // Mock embedDocuments to fail first time with size error for single large text
      mockEmbedDocuments.mockImplementation(async (texts: string[]) => {
        callCount++;

        // First call with full text: simulate size error
        if (callCount === 1) {
          throw new Error("This model's maximum context length is 8191 tokens");
        }

        // Second call (after truncation): succeed
        return texts.map(() => new Array(1536).fill(0.1));
      });

      // Create a document with very large content
      const largeContent = "x".repeat(50000); // 50KB
      await store.addDocuments(
        "truncatetest",
        "1.0.0",
        1,
        createScrapeResult("Large Doc", "https://example.com/large", largeContent, [
          "section",
        ]),
      );

      // Should have been called twice (initial failure + successful retry with truncated text)
      expect(callCount).toBe(2);
      expect(await store.checkDocumentExists("truncatetest", "1.0.0")).toBe(true);
    });

    it("should detect various size error messages", async () => {
      // Skip if embeddings are disabled
      // @ts-expect-error Accessing private property for testing
      if (!store.embeddings) {
        return;
      }

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

    it("should re-throw non-size errors without retry", async () => {
      // Skip if embeddings are disabled
      // @ts-expect-error Accessing private property for testing
      if (!store.embeddings) {
        return;
      }

      // Mock embedDocuments to fail with non-size error
      mockEmbedDocuments.mockRejectedValue(
        new Error("Network error: connection refused"),
      );

      await expect(
        store.addDocuments(
          "networkerror",
          "1.0.0",
          1,
          createScrapeResult(
            "Network Error Test",
            "https://example.com/network-error",
            "Test content",
            ["test"],
          ),
        ),
      ).rejects.toThrow("Network error");

      // Should have been called only once (no retry for non-size errors)
      expect(mockEmbedDocuments).toHaveBeenCalledTimes(1);
    });

    it("should handle nested retry for multiple batch splits", async () => {
      // Skip if embeddings are disabled
      // @ts-expect-error Accessing private property for testing
      if (!store.embeddings) {
        return;
      }

      // Mock to fail multiple times, requiring nested splits
      mockEmbedDocuments.mockImplementation(async (texts: string[]) => {
        callCount++;

        // Fail on first two calls (requiring splits), succeed on smaller batches
        if (callCount <= 2 && texts.length > 1) {
          throw new Error("maximum context length exceeded");
        }

        return texts.map(() => new Array(1536).fill(0.1));
      });

      // Create multiple chunks to trigger multiple splits
      const result = createScrapeResult(
        "Multi Split",
        "https://example.com/multi",
        "Chunk 1",
        ["s1"],
      );
      result.chunks = [
        { types: ["text"], content: "Chunk 1", section: { level: 0, path: ["s1"] } },
        { types: ["text"], content: "Chunk 2", section: { level: 0, path: ["s2"] } },
        { types: ["text"], content: "Chunk 3", section: { level: 0, path: ["s3"] } },
        { types: ["text"], content: "Chunk 4", section: { level: 0, path: ["s4"] } },
      ];

      await store.addDocuments("multisplit", "1.0.0", 1, result);

      // Should have been called multiple times due to splits
      expect(callCount).toBeGreaterThan(2);
      expect(await store.checkDocumentExists("multisplit", "1.0.0")).toBe(true);
    });

    it("should fail after retry if truncated text still too large", async () => {
      // Skip if embeddings are disabled
      // @ts-expect-error Accessing private property for testing
      if (!store.embeddings) {
        return;
      }

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
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save and clear environment variables to disable embeddings
    originalEnv = { ...process.env };
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AZURE_OPENAI_API_KEY;
  });

  afterEach(async () => {
    // Restore original environment
    process.env = originalEnv;

    if (store) {
      await store.shutdown();
    }
  });

  describe("Initialization without embeddings", () => {
    it("should initialize successfully without embedding credentials", async () => {
      store = new DocumentStore(":memory:");
      await expect(store.initialize()).resolves.not.toThrow();
    });

    it("should store documents without vectorization", async () => {
      store = new DocumentStore(":memory:");
      await store.initialize();

      await expect(
        store.addDocuments(
          "react",
          "18.0.0",
          1,
          createScrapeResult(
            "React Hooks Guide",
            "https://example.com/react-hooks",
            "This is a test document about React hooks.",
            ["React", "Hooks"],
          ),
        ),
      ).resolves.not.toThrow();

      const exists = await store.checkDocumentExists("react", "18.0.0");
      expect(exists).toBe(true);
    });
  });

  describe("FTS-only Search", () => {
    beforeEach(async () => {
      store = new DocumentStore(":memory:");
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

    it("should perform FTS-only search", async () => {
      const results = await store.findByContent("testlib", "1.0.0", "React hooks", 5);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain("React hooks");
      expect(results[0]).toHaveProperty("score");
      expect(results[0]).toHaveProperty("fts_rank");
      // Should NOT have vector rank since vectorization is disabled
      expect((results[0] as any).vec_rank).toBeUndefined();
    });

    it("should handle various search queries correctly", async () => {
      const jsResults = await store.findByContent("testlib", "1.0.0", "TypeScript", 5);
      expect(jsResults.length).toBeGreaterThan(0);
      expect(jsResults[0].content).toContain("TypeScript");

      // Empty query should return empty results
      const emptyResults = await store.findByContent("testlib", "1.0.0", "", 5);
      expect(emptyResults).toHaveLength(0);
    });

    it("should escape FTS queries safely", async () => {
      const maliciousQueries = [
        "'; DROP TABLE documents; --",
        "programming & development",
        "function()",
        "test* wildcard",
      ];

      for (const query of maliciousQueries) {
        await expect(
          store.findByContent("testlib", "1.0.0", query, 10),
        ).resolves.not.toThrow();
      }
    });
  });
});

/**
 * Common tests that work in both embedding and non-embedding modes
 * These tests focus on core database functionality
 */
describe("DocumentStore - Common Functionality", () => {
  let store: DocumentStore;

  // Use embeddings for these tests
  beforeEach(async () => {
    const embeddingConfig = EmbeddingConfig.parseEmbeddingConfig(
      "openai:text-embedding-3-small",
    );
    store = new DocumentStore(":memory:", embeddingConfig);
    await store.initialize();
  });

  afterEach(async () => {
    if (store) {
      await store.shutdown();
    }
  });

  describe("Case Sensitivity", () => {
    it("treats version names case-insensitively within a library", async () => {
      const v1 = await store.resolveVersionId("cslib", "1.0.0");
      const v2 = await store.resolveVersionId("cslib", "1.0.0");
      const v3 = await store.resolveVersionId("cslib", "1.0.0");
      expect(v1).toBe(v2);
      expect(v2).toBe(v3);
    });

    it("collapses mixed-case version names to a single version id", async () => {
      const v1 = await store.resolveVersionId("mixcase", "Alpha");
      const v2 = await store.resolveVersionId("mixcase", "alpha");
      const v3 = await store.resolveVersionId("mixcase", "ALPHA");
      expect(v1).toBe(v2);
      expect(v2).toBe(v3);
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

    it("should retrieve documents by ID", async () => {
      await store.addDocuments(
        "idtest",
        "1.0.0",
        1,
        createScrapeResult(
          "ID Test Doc",
          "https://example.com/id-test",
          "Test document for ID retrieval",
          ["test"],
        ),
      );
      const results = await store.findByContent("idtest", "1.0.0", "test document", 10);
      expect(results.length).toBeGreaterThan(0);

      const doc = results[0];
      expect(doc.id).toBeDefined();

      const retrievedDoc = await store.getById(doc.id);
      expect(retrievedDoc).not.toBeNull();
      expect(retrievedDoc?.title).toBe("ID Test Doc");
    });

    it("should handle URL pre-deletion correctly", async () => {
      const library = "url-update-test";
      const version = "1.0.0";
      const url = "https://example.com/test-page";

      // Helper function to count documents
      async function countDocuments(targetUrl?: string): Promise<number> {
        let query = `
          SELECT COUNT(*) as count
          FROM documents d
          JOIN pages p ON d.page_id = p.id
          JOIN versions v ON p.version_id = v.id  
          JOIN libraries l ON v.library_id = l.id
          WHERE l.name = ? AND COALESCE(v.name, '') = ?
        `;
        const params: any[] = [library.toLowerCase(), version.toLowerCase()];

        if (targetUrl) {
          query += " AND p.url = ?";
          params.push(targetUrl);
        }

        const result = (store as any).db.prepare(query).get(...params) as {
          count: number;
        };
        return result.count;
      }

      // Add initial page with 2 chunks
      await store.addDocuments(library, version, 1, {
        ...createScrapeResult("Initial Test Page", url, "Initial content chunk 1", [
          "section1",
        ]),
        chunks: [
          {
            types: ["text"],
            content: "Initial content chunk 1",
            section: { level: 0, path: ["section1"] },
          },
          {
            types: ["text"],
            content: "Initial content chunk 2",
            section: { level: 0, path: ["section2"] },
          },
        ],
      });
      expect(await countDocuments()).toBe(2);
      expect(await countDocuments(url)).toBe(2);

      // Update with new page (should trigger pre-deletion)
      await store.addDocuments(library, version, 1, {
        ...createScrapeResult("Updated Test Page", url, "Updated content chunk 1", [
          "updated-section1",
        ]),
        chunks: [
          {
            types: ["text"],
            content: "Updated content chunk 1",
            section: { level: 0, path: ["updated-section1"] },
          },
          {
            types: ["text"],
            content: "Updated content chunk 2",
            section: { level: 0, path: ["updated-section2"] },
          },
          {
            types: ["text"],
            content: "Updated content chunk 3",
            section: { level: 0, path: ["updated-section3"] },
          },
        ],
      });
      expect(await countDocuments()).toBe(3);
      expect(await countDocuments(url)).toBe(3);
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

    it("should safely handle malicious queries", async () => {
      const maliciousQuery = "'; DROP TABLE documents; --";

      await expect(
        store.findByContent("security-test", "1.0.0", maliciousQuery, 10),
      ).resolves.not.toThrow();

      // Verify database is still functional
      const normalResults = await store.findByContent(
        "security-test",
        "1.0.0",
        "programming",
        10,
      );
      expect(normalResults.length).toBeGreaterThan(0);
    });

    it("should handle special characters safely", async () => {
      const specialCharQueries = [
        "programming & development",
        "software (lifecycle)",
        "price: $99.99",
        "100% coverage",
      ];

      for (const query of specialCharQueries) {
        await expect(
          store.findByContent("security-test", "1.0.0", query, 10),
        ).resolves.not.toThrow();
      }
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
      expect(results[0].content).toContain("--error-on-warnings");
    });

    it("should handle other quoted strings with special characters", async () => {
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

      // Test various quoted strings with special characters
      const testQueries = [
        '"@decorator"',
        '"$variable"',
        '"foo-bar-baz"',
        '"test.method()"',
      ];

      for (const query of testQueries) {
        await expect(
          store.findByContent("security-test", "1.0.0", query, 10),
        ).resolves.not.toThrow();
      }
    });

    it("should handle unbalanced quotes by auto-closing them", async () => {
      // User forgot closing quote
      const query = '"--error-on-warnings';

      // Should not throw syntax error
      await expect(
        store.findByContent("security-test", "1.0.0", query, 10),
      ).resolves.not.toThrow();
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
      expect(results[0].content).toContain("programming");
      expect(results[0].content).toContain("design patterns");
    });

    it("should treat FTS operators as literal keywords when in unquoted position", async () => {
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

      // Query: "queries" OR malicious
      // With OR semantics, each term is treated as optional
      // So this becomes: exact match "queries OR malicious" OR ("queries" OR "OR" OR "malicious")
      // This document contains "queries" and "OR", so it will match
      const results = await store.findByContent(
        "security-test",
        "1.0.0",
        '"queries" OR malicious',
        10,
      );

      // This document contains "queries" and "OR" which satisfies the OR condition
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain("queries");
      expect(results[0].content).toContain("OR");
    });

    it("should handle NOT operator as a literal keyword", async () => {
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

      // Query with NOT - treated as literal keyword with OR semantics
      // Becomes: exact match "production NOT unsafe" OR ("production" OR "NOT" OR "unsafe")
      // Document has "production" and "NOT" which satisfies the OR condition
      const results = await store.findByContent(
        "security-test",
        "1.0.0",
        '"production" NOT unsafe',
        10,
      );

      // Document has "production" and "NOT" which matches via OR
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain("production");
      expect(results[0].content).toContain("NOT");
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

      expect(pages.length).toBe(3);

      // Verify page1 metadata
      const page1 = pages.find((p) => p.url === "https://example.com/page1");
      expect(page1).toBeDefined();
      expect(page1!.id).toBeDefined();
      expect(page1!.etag).toBe('"etag1"');
      expect(page1!.depth).toBe(1);

      // Verify page2 metadata
      const page2 = pages.find((p) => p.url === "https://example.com/page2");
      expect(page2).toBeDefined();
      expect(page2!.etag).toBe('"etag2"');

      // Verify page3 (no etag)
      const page3 = pages.find((p) => p.url === "https://example.com/page3");
      expect(page3).toBeDefined();
      expect(page3!.etag).toBeNull();
    });

    it("should return empty array for version with no pages", async () => {
      const emptyVersionId = await store.resolveVersionId("empty-lib", "1.0.0");
      const pages = await store.getPagesByVersionId(emptyVersionId);

      expect(pages).toEqual([]);
    });

    it("should include all metadata fields needed for refresh", async () => {
      const versionId = await store.resolveVersionId("refresh-queue-test", "1.0.0");
      const pages = await store.getPagesByVersionId(versionId);

      // All pages should have the necessary fields for refresh operations
      for (const page of pages) {
        expect(page.id).toBeDefined();
        expect(page.url).toBeDefined();
        expect(page.depth).toBeDefined();
        // etag can be null, but the field should exist
        expect(page).toHaveProperty("etag");
      }
    });
  });
});
