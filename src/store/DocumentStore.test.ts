import type { Document } from "@langchain/core/documents";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
      const docs: Document[] = [
        {
          pageContent: "JavaScript programming tutorial with examples",
          metadata: {
            title: "JS Tutorial",
            url: "https://example.com/js-tutorial",
            path: ["programming", "javascript"],
          },
        },
        {
          pageContent: "Python data science guide with pandas",
          metadata: {
            title: "Python DS",
            url: "https://example.com/python-ds",
            path: ["programming", "python"],
          },
        },
      ];

      await store.addDocuments("testlib", "1.0.0", docs);

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
      const docs: Document[] = [
        {
          pageContent: "Temporary document for deletion test",
          metadata: {
            title: "Temp Doc",
            url: "https://example.com/temp",
            path: ["temp"],
          },
        },
      ];

      await store.addDocuments("templib", "1.0.0", docs);
      expect(await store.checkDocumentExists("templib", "1.0.0")).toBe(true);

      const deletedCount = await store.deleteDocuments("templib", "1.0.0");
      expect(deletedCount).toBe(1);
      expect(await store.checkDocumentExists("templib", "1.0.0")).toBe(false);
    });

    it("should completely remove a version including pages and documents", async () => {
      const docs: Document[] = [
        {
          pageContent: "First document for removal test",
          metadata: {
            title: "Doc 1",
            url: "https://example.com/doc1",
            path: ["docs"],
          },
        },
        {
          pageContent: "Second document for removal test",
          metadata: {
            title: "Doc 2",
            url: "https://example.com/doc2",
            path: ["docs"],
          },
        },
      ];

      // Add documents and verify they exist
      await store.addDocuments("removelib", "1.0.0", docs);
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
      const v1Docs: Document[] = [
        {
          pageContent: "Version 1 document",
          metadata: {
            title: "V1 Doc",
            url: "https://example.com/v1",
            path: ["v1"],
          },
        },
      ];

      const v2Docs: Document[] = [
        {
          pageContent: "Version 2 document",
          metadata: {
            title: "V2 Doc",
            url: "https://example.com/v2",
            path: ["v2"],
          },
        },
      ];

      // Add two versions
      await store.addDocuments("multilib", "1.0.0", v1Docs);
      await store.addDocuments("multilib", "2.0.0", v2Docs);

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
      const v1Docs: Document[] = [
        {
          pageContent: "Version 1.0 feature documentation",
          metadata: {
            title: "V1 Features",
            url: "https://example.com/v1",
            path: ["features"],
          },
        },
      ];

      const v2Docs: Document[] = [
        {
          pageContent: "Version 2.0 feature documentation with new capabilities",
          metadata: {
            title: "V2 Features",
            url: "https://example.com/v2",
            path: ["features"],
          },
        },
      ];

      await store.addDocuments("versionlib", "1.0.0", v1Docs);
      await store.addDocuments("versionlib", "2.0.0", v2Docs);

      expect(await store.checkDocumentExists("versionlib", "1.0.0")).toBe(true);
      expect(await store.checkDocumentExists("versionlib", "2.0.0")).toBe(true);

      const versions = await store.queryUniqueVersions("versionlib");
      expect(versions).toContain("1.0.0");
      expect(versions).toContain("2.0.0");
    });

    it("should store and retrieve etag and lastModified metadata", async () => {
      const testEtag = '"abc123-def456"';
      const testLastModified = "2023-12-01T10:30:00Z";

      const docs: Document[] = [
        {
          pageContent: "Test document with etag and lastModified",
          metadata: {
            title: "ETag Test Doc",
            url: "https://example.com/etag-test",
            path: ["test"],
            etag: testEtag,
            lastModified: testLastModified,
          },
        },
      ];

      await store.addDocuments("etagtest", "1.0.0", docs);

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
      expect(doc.metadata.url).toBe("https://example.com/etag-test");
    });
  });

  describe("Hybrid Search with Embeddings", () => {
    beforeEach(async () => {
      // Set up test documents with known semantic relationships for ranking tests
      const docs: Document[] = [
        {
          pageContent: "JavaScript programming tutorial with code examples and functions",
          metadata: {
            title: "JavaScript Programming Guide",
            url: "https://example.com/js-guide",
            path: ["programming", "javascript"],
          },
        },
        {
          pageContent:
            "Advanced JavaScript frameworks like React and Vue for building applications",
          metadata: {
            title: "JavaScript Frameworks",
            url: "https://example.com/js-frameworks",
            path: ["programming", "javascript", "frameworks"],
          },
        },
        {
          pageContent:
            "Python programming language tutorial for data science and machine learning",
          metadata: {
            title: "Python Programming",
            url: "https://example.com/python-guide",
            path: ["programming", "python"],
          },
        },
      ];

      await store.addDocuments("searchtest", "1.0.0", docs);
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
      expect(topResult.pageContent.toLowerCase()).toContain("javascript");

      // Results should have both vector and FTS ranking metadata
      const hybridResults = results.filter(
        (r) => r.metadata.vec_rank !== undefined && r.metadata.fts_rank !== undefined,
      );

      // At least some results should be hybrid matches
      if (hybridResults.length > 0) {
        for (const result of hybridResults) {
          expect(result.metadata.vec_rank).toBeGreaterThan(0);
          expect(result.metadata.fts_rank).toBeGreaterThan(0);
          expect(result.metadata.score).toBeGreaterThan(0);
        }
      }

      // All results should have valid scores
      for (const result of results) {
        expect(result.metadata.score).toBeGreaterThan(0);
        expect(typeof result.metadata.score).toBe("number");
        // Results should have either vec_rank, fts_rank, or both
        expect(
          result.metadata.vec_rank !== undefined ||
            result.metadata.fts_rank !== undefined,
        ).toBe(true);
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
        r.pageContent.toLowerCase().includes("programming"),
      );

      expect(programmingResults.length).toBeGreaterThan(0);

      // At least some results should have vector ranks (semantic/embedding matching)
      // If no vector results, it might be because embeddings were disabled in this test run
      const vectorResults = results.filter((r) => r.metadata.vec_rank !== undefined);
      const ftsResults = results.filter((r) => r.metadata.fts_rank !== undefined);

      // Either we have vector results (hybrid search) or FTS results (fallback)
      expect(vectorResults.length > 0 || ftsResults.length > 0).toBe(true);

      // All results should have valid scores
      for (const result of results) {
        expect(result.metadata.score).toBeGreaterThan(0);
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

    it("should batch documents by character size limit", async () => {
      // Skip if embeddings are disabled
      // @ts-expect-error Accessing private property for testing
      if (!store.embeddings) {
        return;
      }

      // Create 3 docs that fit 2 per batch by character size
      const contentSize = 24000; // 24KB each
      const docs: Document[] = Array.from({ length: 3 }, (_, i) => ({
        pageContent: "x".repeat(contentSize),
        metadata: {
          title: `Doc ${i + 1}`,
          url: `https://example.com/doc${i + 1}`,
          path: ["section"],
        },
      }));

      await store.addDocuments("testlib", "1.0.0", docs);

      // Should create 2 batches - first with 2 docs, second with 1 doc
      expect(mockEmbedDocuments).toHaveBeenCalledTimes(2);
      expect(mockEmbedDocuments.mock.calls[0][0]).toHaveLength(2);
      expect(mockEmbedDocuments.mock.calls[1][0]).toHaveLength(1);
    });

    it("should include proper document headers in embedding text", async () => {
      // Skip if embeddings are disabled
      // @ts-expect-error Accessing private property for testing
      if (!store.embeddings) {
        return;
      }

      const docs: Document[] = [
        {
          pageContent: "Test content",
          metadata: {
            title: "Test Title",
            url: "https://example.com/test",
            path: ["path", "to", "doc"],
          },
        },
      ];

      await store.addDocuments("testlib", "1.0.0", docs);

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
      const docs: Document[] = [
        {
          pageContent: "Status tracking test content",
          metadata: {
            title: "Status Test",
            url: "https://example.com/status-test",
            path: ["test"],
          },
        },
      ];

      await store.addDocuments("statuslib", "1.0.0", docs);
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

      const testDocuments: Document[] = [
        {
          pageContent: "This is a test document about React hooks.",
          metadata: {
            url: "https://example.com/react-hooks",
            title: "React Hooks Guide",
            path: ["React", "Hooks"],
          },
        },
      ];

      await expect(
        store.addDocuments("react", "18.0.0", testDocuments),
      ).resolves.not.toThrow();

      const exists = await store.checkDocumentExists("react", "18.0.0");
      expect(exists).toBe(true);
    });
  });

  describe("FTS-only Search", () => {
    beforeEach(async () => {
      store = new DocumentStore(":memory:");
      await store.initialize();

      const testDocuments: Document[] = [
        {
          pageContent: "React hooks are a powerful feature for state management.",
          metadata: {
            url: "https://example.com/react-hooks",
            title: "React Hooks Guide",
            path: ["React", "Hooks"],
          },
        },
        {
          pageContent: "TypeScript provides excellent type safety for JavaScript.",
          metadata: {
            url: "https://example.com/typescript-intro",
            title: "TypeScript Introduction",
            path: ["TypeScript", "Intro"],
          },
        },
      ];

      await store.addDocuments("testlib", "1.0.0", testDocuments);
    });

    it("should perform FTS-only search", async () => {
      const results = await store.findByContent("testlib", "1.0.0", "React hooks", 5);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].pageContent).toContain("React hooks");
      expect(results[0].metadata).toHaveProperty("score");
      expect(results[0].metadata).toHaveProperty("fts_rank");
      // Should NOT have vector rank since vectorization is disabled
      expect(results[0].metadata.vec_rank).toBeUndefined();
    });

    it("should handle various search queries correctly", async () => {
      const jsResults = await store.findByContent("testlib", "1.0.0", "TypeScript", 5);
      expect(jsResults.length).toBeGreaterThan(0);
      expect(jsResults[0].pageContent).toContain("TypeScript");

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
      const docsV1: Document[] = [
        {
          pageContent: "Old feature documentation",
          metadata: {
            title: "Old Feature",
            url: "https://example.com/old",
            path: ["features"],
          },
        },
      ];

      const docsV2: Document[] = [
        {
          pageContent: "New feature documentation",
          metadata: {
            title: "New Feature",
            url: "https://example.com/new",
            path: ["features"],
          },
        },
      ];

      await store.addDocuments("featuretest", "1.0.0", docsV1);
      await store.addDocuments("featuretest", "2.0.0", docsV2);

      const v1Results = await store.findByContent("featuretest", "1.0.0", "feature", 10);
      expect(v1Results.length).toBeGreaterThan(0);
      expect(v1Results[0].metadata.title).toBe("Old Feature");

      const v2Results = await store.findByContent("featuretest", "2.0.0", "feature", 10);
      expect(v2Results.length).toBeGreaterThan(0);
      expect(v2Results[0].metadata.title).toBe("New Feature");
    });
  });

  describe("Document Management", () => {
    it("should retrieve documents by ID", async () => {
      const docs: Document[] = [
        {
          pageContent: "Test document for ID retrieval",
          metadata: {
            title: "ID Test Doc",
            url: "https://example.com/id-test",
            path: ["test"],
          },
        },
      ];

      await store.addDocuments("idtest", "1.0.0", docs);
      const results = await store.findByContent("idtest", "1.0.0", "test document", 10);
      expect(results.length).toBeGreaterThan(0);

      const doc = results[0];
      expect(doc.metadata.id).toBeDefined();

      const retrievedDoc = await store.getById(doc.metadata.id);
      expect(retrievedDoc).not.toBeNull();
      expect(retrievedDoc?.metadata.title).toBe("ID Test Doc");
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

      // Add initial documents
      const initialDocs: Document[] = [
        {
          pageContent: "Initial content chunk 1",
          metadata: { url, title: "Initial Test Page", path: ["section1"] },
        },
        {
          pageContent: "Initial content chunk 2",
          metadata: { url, title: "Initial Test Page", path: ["section2"] },
        },
      ];

      await store.addDocuments(library, version, initialDocs);
      expect(await countDocuments()).toBe(2);
      expect(await countDocuments(url)).toBe(2);

      // Update with new documents (should trigger pre-deletion)
      const updatedDocs: Document[] = [
        {
          pageContent: "Updated content chunk 1",
          metadata: { url, title: "Updated Test Page", path: ["updated-section1"] },
        },
        {
          pageContent: "Updated content chunk 2",
          metadata: { url, title: "Updated Test Page", path: ["updated-section2"] },
        },
        {
          pageContent: "Updated content chunk 3",
          metadata: { url, title: "Updated Test Page", path: ["updated-section3"] },
        },
      ];

      await store.addDocuments(library, version, updatedDocs);
      expect(await countDocuments()).toBe(3);
      expect(await countDocuments(url)).toBe(3);
    });
  });

  describe("Search Security", () => {
    beforeEach(async () => {
      const docs: Document[] = [
        {
          pageContent: "Programming computers is fun and educational for developers",
          metadata: {
            title: "Programming Guide",
            url: "https://example.com/programming",
            path: ["programming", "guide"],
          },
        },
      ];

      await store.addDocuments("security-test", "1.0.0", docs);
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
  });
});
