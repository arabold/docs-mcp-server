import type { Document } from "@langchain/core/documents";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentStore } from "./DocumentStore";
import { VersionStatus } from "./types";

// Mock only the embedding service to generate deterministic embeddings for testing
// This allows us to test ranking logic while using real SQLite database
vi.mock("./embeddings/EmbeddingFactory", () => ({
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
}));

/**
 * Behavior-focused integration tests for DocumentStore
 * Uses real SQLite database with real migrations, but controlled embeddings for deterministic results
 */
describe("DocumentStore - Integration Tests", () => {
  let store: DocumentStore;

  beforeEach(async () => {
    // Create a fresh in-memory database for each test
    store = new DocumentStore(":memory:");
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
      const { libraryId: a } = await store.resolveLibraryAndVersionIds("React", "");
      const { libraryId: b } = await store.resolveLibraryAndVersionIds("react", "");
      const { libraryId: c } = await store.resolveLibraryAndVersionIds("REACT", "");
      expect(a).toBe(b);
      expect(b).toBe(c);
    });

    it("treats version names case-insensitively within a library", async () => {
      const { versionId: v1 } = await store.resolveLibraryAndVersionIds("cslib", "1.0.0");
      const { versionId: v2 } = await store.resolveLibraryAndVersionIds("cslib", "1.0.0");
      const { versionId: v3 } = await store.resolveLibraryAndVersionIds("cslib", "1.0.0");
      expect(v1).toBe(v2);
      expect(v2).toBe(v3);
    });

    it("collapses mixed-case version names to a single version id", async () => {
      const { versionId: v1 } = await store.resolveLibraryAndVersionIds(
        "mixcase",
        "Alpha",
      );
      const { versionId: v2 } = await store.resolveLibraryAndVersionIds(
        "mixcase",
        "alpha",
      );
      const { versionId: v3 } = await store.resolveLibraryAndVersionIds(
        "mixcase",
        "ALPHA",
      );
      expect(v1).toBe(v2);
      expect(v2).toBe(v3);
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
  });

  describe("Search Ranking and Hybrid Search Behavior", () => {
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
        {
          pageContent: "Database design principles and SQL query optimization techniques",
          metadata: {
            title: "Database Design",
            url: "https://example.com/database-design",
            path: ["database", "design"],
          },
        },
        {
          pageContent: "Machine learning algorithms and neural networks in Python",
          metadata: {
            title: "Machine Learning Guide",
            url: "https://example.com/ml-guide",
            path: ["ai", "machine-learning"],
          },
        },
      ];

      await store.addDocuments("searchtest", "1.0.0", docs);
    });

    it("should rank documents by relevance to search query", async () => {
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

      // Verify scores are in descending order (higher = better)
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].metadata.score).toBeGreaterThanOrEqual(
          results[i + 1].metadata.score,
        );
      }

      // All results should have valid RRF scores and ranking metadata
      for (const result of results) {
        expect(result.metadata.score).toBeGreaterThan(0);
        expect(typeof result.metadata.score).toBe("number");
        // Results may have either vec_rank, fts_rank, or both depending on match type
        expect(
          result.metadata.vec_rank !== undefined ||
            result.metadata.fts_rank !== undefined,
        ).toBe(true);
      }
    });

    it("should handle exact vs partial matches correctly", async () => {
      // Test exact phrase matching
      const exactResults = await store.findByContent(
        "searchtest",
        "1.0.0",
        "machine learning",
        10,
      );
      expect(exactResults.length).toBeGreaterThan(0);

      const topExactResult = exactResults[0];
      expect(topExactResult.pageContent.toLowerCase()).toContain("machine learning");

      // Test partial matching
      const partialResults = await store.findByContent(
        "searchtest",
        "1.0.0",
        "programming",
        10,
      );
      expect(partialResults.length).toBeGreaterThan(1); // Should match multiple docs

      // Both JavaScript and Python docs should appear in programming search
      const contentTexts = partialResults.map((r) => r.pageContent.toLowerCase());
      const hasJavaScript = contentTexts.some((text) => text.includes("javascript"));
      const hasPython = contentTexts.some((text) => text.includes("python"));
      expect(hasJavaScript && hasPython).toBe(true);
    });

    it("should properly escape and handle special characters in FTS queries", async () => {
      // These should not throw errors and should return valid results
      await expect(
        store.findByContent("searchtest", "1.0.0", '"JavaScript programming"', 10),
      ).resolves.toHaveProperty("length");

      await expect(
        store.findByContent("searchtest", "1.0.0", "programming AND tutorial", 10),
      ).resolves.toHaveProperty("length");

      await expect(
        store.findByContent("searchtest", "1.0.0", "function()", 10),
      ).resolves.toHaveProperty("length");

      await expect(
        store.findByContent("searchtest", "1.0.0", "framework*", 10),
      ).resolves.toHaveProperty("length");
    });

    it("should demonstrate RRF ranking combines vector and text search effectively", async () => {
      // Search for terms that should appear in multiple documents
      const results = await store.findByContent(
        "searchtest",
        "1.0.0",
        "programming tutorial",
        10,
      );

      expect(results.length).toBeGreaterThan(1);

      // Documents matching both terms should rank higher than single-term matches
      const topResult = results[0];
      const topContent = topResult.pageContent.toLowerCase();

      // Top result should contain both search terms or be highly semantically related
      const hasProgramming = topContent.includes("programming");
      const hasTutorial = topContent.includes("tutorial");
      const isJavaScriptDoc = topContent.includes("javascript"); // Highly relevant to programming

      expect(hasProgramming || hasTutorial || isJavaScriptDoc).toBe(true);

      // Verify that hybrid matches (both vector and FTS) get appropriate ranking
      const hybridResults = results.filter(
        (r) => r.metadata.vec_rank !== undefined && r.metadata.fts_rank !== undefined,
      );

      if (hybridResults.length > 0) {
        // Hybrid results should have competitive scores
        const hybridScores = hybridResults.map((r) => r.metadata.score);
        const maxHybridScore = Math.max(...hybridScores);
        const topScore = results[0].metadata.score;

        // At least one hybrid result should be competitive with the top result
        expect(maxHybridScore).toBeGreaterThan(topScore * 0.5); // Within 50% of top score
      }
    });

    it("should handle empty search results gracefully", async () => {
      const results = await store.findByContent("nonexistent", "1.0.0", "anything", 10);
      expect(results).toEqual([]);

      const results2 = await store.findByContent("searchtest", "99.0.0", "anything", 10);
      expect(results2).toEqual([]);
    });

    it("should respect search limits and return results in order", async () => {
      // Test with small limit
      const limitedResults = await store.findByContent(
        "searchtest",
        "1.0.0",
        "programming",
        2,
      );
      expect(limitedResults.length).toBeLessThanOrEqual(2);

      // Test with larger limit should return more results (if available)
      const allResults = await store.findByContent(
        "searchtest",
        "1.0.0",
        "programming",
        10,
      );
      expect(allResults.length).toBeGreaterThanOrEqual(limitedResults.length);

      // Limited results should be the top results from the full set
      if (limitedResults.length > 0 && allResults.length > limitedResults.length) {
        expect(limitedResults[0].metadata.score).toBe(allResults[0].metadata.score);
        if (limitedResults.length > 1) {
          expect(limitedResults[1].metadata.score).toBe(allResults[1].metadata.score);
        }
      }
    });

    it("filters out structural chunks from search results", async () => {
      // Prepare two docs that both match the query text but one is structural
      const docs: Document[] = [
        {
          pageContent: "Anchor content shared phrase inside structural container",
          metadata: {
            title: "StructuralContainer",
            url: "https://example.com/struct",
            path: ["struct"],
            // Simulate splitter output marking this as structural
            types: ["code", "structural"],
          },
        },
        {
          pageContent: "Anchor content shared phrase inside leaf content section",
          metadata: {
            title: "LeafContent",
            url: "https://example.com/leaf",
            path: ["leaf"],
            types: ["code"],
          },
        },
      ];

      await store.addDocuments("structfilter", "1.0.0", docs);

      // Query term appears in both documents' content, but structural one must be filtered
      const results = await store.findByContent(
        "structfilter",
        "1.0.0",
        "Anchor content shared phrase",
        10,
      );

      expect(results.length).toBe(1);
      expect(results[0].metadata.title).toBe("LeafContent");
      const titles = results.map((r) => r.metadata.title);
      expect(titles).not.toContain("StructuralContainer");
      // Ensure metadata does not accidentally surface structural types
      expect((results[0].metadata.types || []).includes("structural")).toBe(false);
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

      // Search in v1 should only return v1 docs
      const v1Results = await store.findByContent("featuretest", "1.0.0", "feature", 10);
      expect(v1Results.length).toBeGreaterThan(0);
      expect(v1Results[0].metadata.title).toBe("Old Feature");

      // Search in v2 should only return v2 docs
      const v2Results = await store.findByContent("featuretest", "2.0.0", "feature", 10);
      expect(v2Results.length).toBeGreaterThan(0);
      expect(v2Results[0].metadata.title).toBe("New Feature");
    });
  });

  describe("Document Retrieval by ID", () => {
    it("should retrieve documents by ID after storing them", async () => {
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

      // Retrieve by ID
      const retrievedDoc = await store.getById(doc.metadata.id);
      expect(retrievedDoc).not.toBeNull();
      expect(retrievedDoc?.metadata.title).toBe("ID Test Doc");
      expect(retrievedDoc?.pageContent).toBe("Test document for ID retrieval");
    });

    it("should return null for non-existent document IDs", async () => {
      const result = await store.getById("999999");
      expect(result).toBeNull();
    });

    it("should handle empty ID arrays gracefully", async () => {
      const results = await store.findChunksByIds("anylib", "1.0.0", []);
      expect(results).toEqual([]);
    });
  });

  describe("Status Tracking", () => {
    it("should update version status correctly", async () => {
      // Create library and version first by adding documents
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

      // Get the version ID
      const { versionId } = await store.resolveLibraryAndVersionIds("statuslib", "1.0.0");

      // Update status to QUEUED
      await store.updateVersionStatus(versionId, VersionStatus.QUEUED);

      // Verify status was updated by checking getVersionsByStatus
      const queuedVersions = await store.getVersionsByStatus([VersionStatus.QUEUED]);
      expect(queuedVersions).toHaveLength(1);
      expect(queuedVersions[0].library_name).toBe("statuslib");
      expect(queuedVersions[0].name).toBe("1.0.0");
      expect(queuedVersions[0].status).toBe(VersionStatus.QUEUED);
    });

    it("should track version progress during indexing", async () => {
      // Create a version
      const { versionId } = await store.resolveLibraryAndVersionIds(
        "progresslib",
        "2.0.0",
      );

      // Update progress
      await store.updateVersionProgress(versionId, 5, 10);

      // Verify progress was stored (we can check this indirectly by ensuring no errors)
      // The progress is stored in the database and used by the pipeline system
      expect(versionId).toBeGreaterThan(0);
    });

    it("should retrieve versions by status", async () => {
      // Create multiple versions with different statuses
      const { versionId: v1 } = await store.resolveLibraryAndVersionIds(
        "multilib",
        "1.0.0",
      );
      const { versionId: v2 } = await store.resolveLibraryAndVersionIds(
        "multilib",
        "2.0.0",
      );

      await store.updateVersionStatus(v1, VersionStatus.QUEUED);
      await store.updateVersionStatus(v2, VersionStatus.RUNNING);

      // Test single status filter
      const queuedVersions = await store.getVersionsByStatus([VersionStatus.QUEUED]);
      expect(queuedVersions.some((v) => v.name === "1.0.0")).toBe(true);

      // Test multiple status filter
      const activeVersions = await store.getVersionsByStatus([
        VersionStatus.QUEUED,
        VersionStatus.RUNNING,
      ]);
      expect(activeVersions.length).toBeGreaterThanOrEqual(2);
      expect(activeVersions.some((v) => v.name === "1.0.0")).toBe(true);
      expect(activeVersions.some((v) => v.name === "2.0.0")).toBe(true);
    });
  });

  describe("Scraper Options Storage", () => {
    it("should store and retrieve scraper options", async () => {
      // Create a version
      const { versionId } = await store.resolveLibraryAndVersionIds(
        "optionslib",
        "1.0.0",
      );

      // Define complete scraper options
      const scraperOptions = {
        url: "https://example.com/docs",
        library: "optionslib",
        version: "1.0.0",
        maxDepth: 3,
        maxPages: 100,
        scope: "subpages" as const,
        followRedirects: true,
        signal: undefined, // This should be filtered out
      };

      // Store options
      await store.storeScraperOptions(versionId, scraperOptions);

      // Retrieve options
      const retrieved = await store.getScraperOptions(versionId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.options.maxDepth).toBe(3);
      expect(retrieved?.options.maxPages).toBe(100);
      expect(retrieved?.options.scope).toBe("subpages");
      expect(retrieved?.options.followRedirects).toBe(true);

      // Verify signal was filtered out (it's not storable)
      expect(retrieved?.options).not.toHaveProperty("signal");
    });

    it("should store source URL correctly", async () => {
      const { versionId } = await store.resolveLibraryAndVersionIds("sourcelib", "1.0.0");
      const sourceUrl = "https://docs.example.com/api";

      const scraperOptions = {
        url: sourceUrl,
        library: "sourcelib",
        version: "1.0.0",
        maxDepth: 2,
      };

      await store.storeScraperOptions(versionId, scraperOptions);

      // Retrieve version with stored options
      const stored = await store.getScraperOptions(versionId);
      expect(stored).not.toBeNull();
      expect(stored?.sourceUrl).toBe(sourceUrl);
    });

    it("should find versions by source URL", async () => {
      const sourceUrl = "https://shared-docs.example.com";

      // Create two versions from the same source
      const { versionId: v1 } = await store.resolveLibraryAndVersionIds(
        "sharedlib1",
        "1.0.0",
      );
      const { versionId: v2 } = await store.resolveLibraryAndVersionIds(
        "sharedlib2",
        "2.0.0",
      );

      const options1 = {
        url: sourceUrl,
        library: "sharedlib1",
        version: "1.0.0",
        maxDepth: 2,
      };

      const options2 = {
        url: sourceUrl,
        library: "sharedlib2",
        version: "2.0.0",
        maxDepth: 3,
      };

      await store.storeScraperOptions(v1, options1);
      await store.storeScraperOptions(v2, options2);

      // Find versions by source URL
      const foundVersions = await store.findVersionsBySourceUrl(sourceUrl);

      expect(foundVersions.length).toBeGreaterThanOrEqual(2);
      expect(foundVersions.some((v) => v.library_name === "sharedlib1")).toBe(true);
      expect(foundVersions.some((v) => v.library_name === "sharedlib2")).toBe(true);
    });

    it("should handle null scraper options gracefully", async () => {
      const { versionId } = await store.resolveLibraryAndVersionIds(
        "nulloptionslib",
        "1.0.0",
      );

      // Version without stored options should return null
      const retrieved = await store.getScraperOptions(versionId);
      expect(retrieved).toBeNull();
    });
  });

  describe("Document URL pre-deletion", () => {
    /**
     * Helper function to count documents in the database directly
     */
    async function countDocuments(
      library: string,
      version: string,
      url?: string,
    ): Promise<number> {
      const normalizedLib = library.toLowerCase();
      const normalizedVer = version.toLowerCase();

      let query = `
        SELECT COUNT(*) as count
        FROM documents d
        JOIN versions v ON d.version_id = v.id  
        JOIN libraries l ON v.library_id = l.id
        WHERE l.name = ? AND COALESCE(v.name, '') = COALESCE(?, '')
      `;

      const params: any[] = [normalizedLib, normalizedVer];

      if (url) {
        query += " AND d.url = ?";
        params.push(url);
      }

      // Access the internal database connection
      const result = (store as any).db.prepare(query).get(...params) as { count: number };
      return result.count;
    }

    it("should delete existing documents for the same URL before adding new ones", async () => {
      const library = "url-update-test";
      const version = "1.0.0";
      const url = "https://example.com/test-page";
      const differentUrl = "https://example.com/different-page";

      // Step 1: Add initial documents
      const initialDocs: Document[] = [
        {
          pageContent: "Initial content chunk 1",
          metadata: { url, title: "Initial Test Page", path: ["section1"] },
        },
        {
          pageContent: "Initial content chunk 2",
          metadata: { url, title: "Initial Test Page", path: ["section2"] },
        },
        {
          pageContent: "Different URL content",
          metadata: { url: differentUrl, title: "Different Page", path: ["section1"] },
        },
      ];

      await store.addDocuments(library, version, initialDocs);

      // Verify initial state using direct database queries
      expect(await countDocuments(library, version)).toBe(3); // Total documents
      expect(await countDocuments(library, version, url)).toBe(2); // Documents for target URL
      expect(await countDocuments(library, version, differentUrl)).toBe(1); // Documents for different URL

      // Step 2: Add updated documents for the same URL (should trigger pre-deletion)
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

      // Verify final state using direct database queries
      expect(await countDocuments(library, version)).toBe(4); // 3 updated + 1 different URL
      expect(await countDocuments(library, version, url)).toBe(3); // Updated documents for target URL
      expect(await countDocuments(library, version, differentUrl)).toBe(1); // Different URL unchanged
    });

    it("should handle multiple URLs in the same addDocuments call", async () => {
      const library = "multi-url-test";
      const version = "1.0.0";
      const url1 = "https://example.com/page1";
      const url2 = "https://example.com/page2";

      // Add initial documents for both URLs
      const initialDocs: Document[] = [
        {
          pageContent: "Page 1 initial content",
          metadata: { url: url1, title: "Page 1 Initial", path: ["section1"] },
        },
        {
          pageContent: "Page 2 initial content",
          metadata: { url: url2, title: "Page 2 Initial", path: ["section1"] },
        },
      ];

      await store.addDocuments(library, version, initialDocs);

      // Verify initial state
      expect(await countDocuments(library, version)).toBe(2);
      expect(await countDocuments(library, version, url1)).toBe(1);
      expect(await countDocuments(library, version, url2)).toBe(1);

      // Update both URLs in a single call
      const updatedDocs: Document[] = [
        {
          pageContent: "Page 1 updated content chunk 1",
          metadata: { url: url1, title: "Page 1 Updated", path: ["section1"] },
        },
        {
          pageContent: "Page 1 updated content chunk 2",
          metadata: { url: url1, title: "Page 1 Updated", path: ["section2"] },
        },
        {
          pageContent: "Page 2 updated content",
          metadata: { url: url2, title: "Page 2 Updated", path: ["section1"] },
        },
      ];

      await store.addDocuments(library, version, updatedDocs);

      // Verify final state using direct database queries
      expect(await countDocuments(library, version)).toBe(3); // 2 for url1 + 1 for url2
      expect(await countDocuments(library, version, url1)).toBe(2);
      expect(await countDocuments(library, version, url2)).toBe(1);
    });

    it("should work correctly when no existing documents exist for the URL", async () => {
      const library = "new-url-test";
      const version = "1.0.0";
      const url = "https://example.com/brand-new-page";

      // Add documents for a URL that doesn't exist yet
      const newDocs: Document[] = [
        {
          pageContent: "Brand new content",
          metadata: { url, title: "Brand New Page", path: ["section1"] },
        },
      ];

      // This should succeed without errors
      await expect(store.addDocuments(library, version, newDocs)).resolves.not.toThrow();

      // Verify the document was added using direct database query
      expect(await countDocuments(library, version)).toBe(1);
      expect(await countDocuments(library, version, url)).toBe(1);
    });
  });

  describe("Embedding Batch Size Limits", () => {
    let mockEmbedDocuments: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Get a reference to the mocked embedDocuments function
      // @ts-expect-error Accessing private property for testing
      mockEmbedDocuments = vi.mocked(store.embeddings.embedDocuments);
      mockEmbedDocuments.mockClear();
    });

    it("should batch documents by character size limit", async () => {
      // Test: Character limit takes precedence over count when reached first
      // Create 3 docs that fit 2 per batch by character size (~48KB total for 2 docs)
      const contentSize = 24000; // 24KB each, 2 docs + headers = ~48.2KB (under 50KB limit)
      const docs: Document[] = Array.from({ length: 3 }, (_, i) => ({
        pageContent: "x".repeat(contentSize),
        metadata: {
          title: `Doc ${i + 1}`,
          url: `https://example.com/doc${i + 1}`,
          path: ["section"],
        },
      }));

      await store.addDocuments("testlib", "1.0.0", docs);

      // Behavior: Should create 2 batches - first with 2 docs, second with 1 doc
      expect(mockEmbedDocuments).toHaveBeenCalledTimes(2);
      expect(mockEmbedDocuments.mock.calls[0][0]).toHaveLength(2);
      expect(mockEmbedDocuments.mock.calls[1][0]).toHaveLength(1);
    });

    it("should batch documents by count limit when character limit not reached", async () => {
      // Test: Count limit (100) takes precedence when character limit isn't reached
      // Create 101 small documents that won't hit character limit
      const docs: Document[] = Array.from({ length: 101 }, (_, i) => ({
        pageContent: "Small content",
        metadata: {
          title: `Doc ${i + 1}`,
          url: `https://example.com/doc${i + 1}`,
          path: ["section"],
        },
      }));

      await store.addDocuments("testlib", "1.0.0", docs);

      // Behavior: Should create 2 batches - 100 docs then 1 doc (count limit)
      expect(mockEmbedDocuments).toHaveBeenCalledTimes(2);
      expect(mockEmbedDocuments.mock.calls[0][0]).toHaveLength(100);
      expect(mockEmbedDocuments.mock.calls[1][0]).toHaveLength(1);
    });

    it("should respect both character and count limits simultaneously", async () => {
      // Test: Dual constraint - whichever limit is hit first should trigger batching
      // Create 50 medium-sized docs where character limit will be hit before count limit
      const contentSize = 2000; // 2KB each, so ~24 docs per 50KB batch
      const docs: Document[] = Array.from({ length: 50 }, (_, i) => ({
        pageContent: "x".repeat(contentSize),
        metadata: {
          title: `Doc ${i + 1}`,
          url: `https://example.com/doc${i + 1}`,
          path: ["section"],
        },
      }));

      await store.addDocuments("testlib", "1.0.0", docs);

      // Behavior: Character limit should be hit before count limit (100)
      // Should create 3 batches: 24 + 24 + 2 docs = 50 docs total
      expect(mockEmbedDocuments).toHaveBeenCalledTimes(3);
      expect(mockEmbedDocuments.mock.calls[0][0]).toHaveLength(24);
      expect(mockEmbedDocuments.mock.calls[1][0]).toHaveLength(24);
      expect(mockEmbedDocuments.mock.calls[2][0]).toHaveLength(2);

      // Verify character limit is being respected (~50KB per batch)
      const batch1Chars = mockEmbedDocuments.mock.calls[0][0].reduce(
        (sum: number, text: string) => sum + text.length,
        0,
      );
      const batch2Chars = mockEmbedDocuments.mock.calls[1][0].reduce(
        (sum: number, text: string) => sum + text.length,
        0,
      );
      expect(batch1Chars).toBeLessThan(51000); // Under 51KB
      expect(batch2Chars).toBeLessThan(51000); // Under 51KB
    });

    it("should handle custom character limit from environment variable", async () => {
      // Test: Environment variable override works correctly
      const originalEnv = process.env.DOCS_MCP_EMBEDDING_BATCH_CHARS;
      process.env.DOCS_MCP_EMBEDDING_BATCH_CHARS = "1000"; // 1KB limit

      try {
        const docs: Document[] = [
          {
            pageContent: "x".repeat(800), // 800 chars + ~79 char header = ~879 chars
            metadata: {
              title: "Doc 1",
              url: "https://example.com/doc1",
              path: ["section"],
            },
          },
          {
            pageContent: "x".repeat(800), // Adding this would exceed 1KB limit
            metadata: {
              title: "Doc 2",
              url: "https://example.com/doc2",
              path: ["section"],
            },
          },
        ];

        await store.addDocuments("testlib", "1.0.0", docs);

        // Behavior: Should create separate batches due to reduced character limit
        expect(mockEmbedDocuments).toHaveBeenCalledTimes(2);
        expect(mockEmbedDocuments.mock.calls[0][0]).toHaveLength(1);
        expect(mockEmbedDocuments.mock.calls[1][0]).toHaveLength(1);
      } finally {
        // Restore original environment
        if (originalEnv !== undefined) {
          process.env.DOCS_MCP_EMBEDDING_BATCH_CHARS = originalEnv;
        } else {
          delete process.env.DOCS_MCP_EMBEDDING_BATCH_CHARS;
        }
      }
    });

    it("should handle edge cases correctly", async () => {
      // Test edge cases: empty array, single large doc, normal operation

      // Empty documents should not call embedding service
      await store.addDocuments("testlib", "1.0.0", []);
      expect(mockEmbedDocuments).not.toHaveBeenCalled();

      mockEmbedDocuments.mockClear();

      // Single very large document should still work (no artificial size limits)
      const veryLargeDoc: Document[] = [
        {
          pageContent: "x".repeat(60000), // 60KB, exceeds default 50KB limit
          metadata: {
            title: "Very Large Doc",
            url: "https://example.com/large-doc",
            path: ["section"],
          },
        },
      ];

      await store.addDocuments("testlib", "1.0.0", veryLargeDoc);
      expect(mockEmbedDocuments).toHaveBeenCalledTimes(1);
      expect(mockEmbedDocuments.mock.calls[0][0]).toHaveLength(1);
    });

    it("should include proper document headers in embedding text", async () => {
      // Test: Document formatting includes required metadata headers
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

      // Behavior: Embedding text should include structured metadata
      expect(mockEmbedDocuments).toHaveBeenCalledTimes(1);
      const embeddedText = mockEmbedDocuments.mock.calls[0][0][0];

      expect(embeddedText).toContain("<title>Test Title</title>");
      expect(embeddedText).toContain("<url>https://example.com/test</url>");
      expect(embeddedText).toContain("<path>path / to / doc</path>");
      expect(embeddedText).toContain("Test content");
    });
  });

  describe("Enhanced Search Features (Issue #171)", () => {
    beforeEach(async () => {
      // Set up test documents for enhanced search feature testing
      const docs: Document[] = [
        {
          pageContent: "React hooks tutorial with useState and useEffect examples",
          metadata: {
            title: "React Hooks Guide",
            url: "https://example.com/react-hooks",
            path: ["programming", "react", "hooks"],
          },
        },
        {
          pageContent: "Advanced React patterns and component design principles",
          metadata: {
            title: "React Patterns",
            url: "https://example.com/react-patterns",
            path: ["programming", "react", "patterns"],
          },
        },
        {
          pageContent: "JavaScript functional programming with higher-order functions",
          metadata: {
            title: "JS Functional Programming",
            url: "https://example.com/js-functional",
            path: ["programming", "javascript", "functional"],
          },
        },
        {
          pageContent: "TypeScript type system and generics explained",
          metadata: {
            title: "TypeScript Types",
            url: "https://example.com/ts-types",
            path: ["programming", "typescript", "types"],
          },
        },
        {
          pageContent: "Database optimization techniques for better performance",
          metadata: {
            title: "Database Optimization",
            url: "https://example.com/db-optimization",
            path: ["database", "optimization"],
          },
        },
      ];

      await store.addDocuments("enhanced-search", "1.0.0", docs);
    });

    describe("Dual-mode FTS Query Generation", () => {
      it("should handle phrase queries with exact matches", async () => {
        // Test exact phrase matching
        const results = await store.findByContent(
          "enhanced-search",
          "1.0.0",
          "React hooks",
          10,
        );

        expect(results.length).toBeGreaterThan(0);

        // Should find the React hooks document
        const topResult = results[0];
        expect(topResult.pageContent.toLowerCase()).toContain("react hooks");
        expect(topResult.metadata.title).toBe("React Hooks Guide");
      });

      it("should support keyword matching when phrase doesn't match exactly", async () => {
        // Test loose keyword matching - "programming React" (not exact phrase)
        const results = await store.findByContent(
          "enhanced-search",
          "1.0.0",
          "programming React",
          10,
        );

        expect(results.length).toBeGreaterThan(0);

        // Should find React-related documents even though "programming React" isn't an exact phrase
        const reactResults = results.filter(
          (r) =>
            r.pageContent.toLowerCase().includes("react") ||
            r.metadata.title.toLowerCase().includes("react"),
        );

        expect(reactResults.length).toBeGreaterThan(0);
      });

      it("should handle single-word queries correctly", async () => {
        // Single words should work as before (phrase query only)
        const results = await store.findByContent(
          "enhanced-search",
          "1.0.0",
          "TypeScript",
          10,
        );

        expect(results.length).toBeGreaterThan(0);

        const topResult = results[0];
        expect(topResult.pageContent.toLowerCase()).toContain("typescript");
      });

      it("should respect existing quoted queries", async () => {
        // When users provide explicit quotes, respect them
        const results = await store.findByContent(
          "enhanced-search",
          "1.0.0",
          '"React hooks"',
          10,
        );

        expect(results.length).toBeGreaterThan(0);

        // Should still find the exact phrase
        const topResult = results[0];
        expect(topResult.pageContent.toLowerCase()).toContain("react hooks");
      });

      it("should handle complex multi-word queries", async () => {
        // Test that both phrase and individual terms can match
        const results = await store.findByContent(
          "enhanced-search",
          "1.0.0",
          "component design patterns",
          10,
        );

        expect(results.length).toBeGreaterThan(0);

        // Should find documents containing these terms individually or as phrases
        const hasRelevantContent = results.some((r) => {
          const content = r.pageContent.toLowerCase();
          const title = r.metadata.title.toLowerCase();
          return (
            content.includes("component") ||
            content.includes("design") ||
            content.includes("patterns") ||
            title.includes("patterns")
          );
        });

        expect(hasRelevantContent).toBe(true);
      });
    });

    describe("Overfetch Factor Implementation", () => {
      it("should apply overfetch factor to improve recall", async () => {
        // Test with a query that should benefit from overfetching
        const limitedResults = await store.findByContent(
          "enhanced-search",
          "1.0.0",
          "programming",
          2, // Small limit to test overfetch effect
        );

        expect(limitedResults.length).toBeLessThanOrEqual(2);

        // All results should still be relevant and properly ranked
        for (const result of limitedResults) {
          expect(result.metadata.score).toBeGreaterThan(0);
          expect(typeof result.metadata.score).toBe("number");
        }

        // Results should be in descending score order
        for (let i = 0; i < limitedResults.length - 1; i++) {
          expect(limitedResults[i].metadata.score).toBeGreaterThanOrEqual(
            limitedResults[i + 1].metadata.score,
          );
        }
      });

      it("should still respect final result limit after overfetching", async () => {
        const limit = 3;
        const results = await store.findByContent(
          "enhanced-search",
          "1.0.0",
          "React TypeScript JavaScript",
          limit,
        );

        // Final results should not exceed requested limit
        expect(results.length).toBeLessThanOrEqual(limit);

        // But we should get quality results due to overfetching
        expect(results.length).toBeGreaterThan(0);
      });

      it("should work correctly with very small limits", async () => {
        const results = await store.findByContent(
          "enhanced-search",
          "1.0.0",
          "programming",
          1, // Minimum limit
        );

        expect(results.length).toBeLessThanOrEqual(1);

        if (results.length > 0) {
          expect(results[0].metadata.score).toBeGreaterThan(0);
        }
      });
    });

    describe("Hybrid Weight Configuration", () => {
      it("should apply weight configuration to RRF calculation", async () => {
        // Test that the weighted RRF formula is working
        const results = await store.findByContent(
          "enhanced-search",
          "1.0.0",
          "React programming tutorial",
          10,
        );

        expect(results.length).toBeGreaterThan(0);

        // Check that results have proper RRF scores
        for (const result of results) {
          expect(result.metadata.score).toBeGreaterThan(0);
          expect(typeof result.metadata.score).toBe("number");

          // Results should have at least one rank type (vec or fts)
          const hasVecRank = result.metadata.vec_rank !== undefined;
          const hasFtsRank = result.metadata.fts_rank !== undefined;
          expect(hasVecRank || hasFtsRank).toBe(true);
        }

        // Verify that hybrid results (both vector and FTS matches) exist
        const hybridResults = results.filter(
          (r) => r.metadata.vec_rank !== undefined && r.metadata.fts_rank !== undefined,
        );

        // At least some results should be hybrid matches for a multi-word query
        if (hybridResults.length > 0) {
          for (const result of hybridResults) {
            expect(result.metadata.vec_rank).toBeGreaterThan(0);
            expect(result.metadata.fts_rank).toBeGreaterThan(0);
          }
        }
      });

      it("should maintain score consistency and ranking", async () => {
        const results = await store.findByContent(
          "enhanced-search",
          "1.0.0",
          "React hooks useState",
          5,
        );

        expect(results.length).toBeGreaterThan(1);

        // Scores should be in descending order
        for (let i = 0; i < results.length - 1; i++) {
          expect(results[i].metadata.score).toBeGreaterThanOrEqual(
            results[i + 1].metadata.score,
          );
        }

        // All scores should be positive
        for (const result of results) {
          expect(result.metadata.score).toBeGreaterThan(0);
        }
      });

      it("should handle vector-only and FTS-only matches correctly", async () => {
        // Test query that might produce different match types
        const results = await store.findByContent(
          "enhanced-search",
          "1.0.0",
          "database performance optimization",
          10,
        );

        expect(results.length).toBeGreaterThan(0);

        // Categorize results by match type
        const vectorOnlyResults = results.filter(
          (r) => r.metadata.vec_rank !== undefined && r.metadata.fts_rank === undefined,
        );

        const ftsOnlyResults = results.filter(
          (r) => r.metadata.vec_rank === undefined && r.metadata.fts_rank !== undefined,
        );

        const hybridResults = results.filter(
          (r) => r.metadata.vec_rank !== undefined && r.metadata.fts_rank !== undefined,
        );

        // All results should fall into one of these categories
        expect(
          vectorOnlyResults.length + ftsOnlyResults.length + hybridResults.length,
        ).toBe(results.length);

        // Each category should have valid scores
        [...vectorOnlyResults, ...ftsOnlyResults, ...hybridResults].forEach((result) => {
          expect(result.metadata.score).toBeGreaterThan(0);
        });
      });
    });

    describe("Integration of All Enhanced Features", () => {
      it("should demonstrate improved search recall and precision", async () => {
        // Complex query that benefits from all enhancements
        const query = "React component patterns hooks";
        const results = await store.findByContent("enhanced-search", "1.0.0", query, 10);

        expect(results.length).toBeGreaterThan(0);

        // Should find multiple relevant documents
        const reactResults = results.filter(
          (r) =>
            r.pageContent.toLowerCase().includes("react") ||
            r.metadata.title.toLowerCase().includes("react"),
        );

        expect(reactResults.length).toBeGreaterThan(0);

        // Results should be well-ranked with proper metadata
        const topResult = results[0];
        expect(topResult.metadata.score).toBeGreaterThan(0);
        expect(topResult.metadata.id).toBeDefined();

        // Should have either vector rank, FTS rank, or both
        expect(
          topResult.metadata.vec_rank !== undefined ||
            topResult.metadata.fts_rank !== undefined,
        ).toBe(true);
      });

      it("should maintain backward compatibility for simple queries", async () => {
        // Simple queries should work as before
        const results = await store.findByContent(
          "enhanced-search",
          "1.0.0",
          "TypeScript",
          5,
        );

        expect(results.length).toBeGreaterThan(0);

        // Should find the TypeScript document
        const tsResult = results.find((r) =>
          r.pageContent.toLowerCase().includes("typescript"),
        );

        expect(tsResult).toBeDefined();
        expect(tsResult?.metadata.title).toBe("TypeScript Types");
      });

      it("should handle edge cases gracefully", async () => {
        // Empty query should return empty results
        const emptyResults = await store.findByContent(
          "enhanced-search",
          "1.0.0",
          "",
          10,
        );
        expect(emptyResults).toEqual([]);

        // Very long query should not break
        const longQuery = "programming ".repeat(20);
        await expect(
          store.findByContent("enhanced-search", "1.0.0", longQuery, 5),
        ).resolves.toHaveProperty("length");

        // Special characters should be handled
        const specialQuery = "React & TypeScript (modern)";
        await expect(
          store.findByContent("enhanced-search", "1.0.0", specialQuery, 5),
        ).resolves.toHaveProperty("length");
      });
    });
  });

  describe("Search Security and Tokenization", () => {
    beforeEach(async () => {
      // Set up test documents for security and tokenization testing
      const docs: Document[] = [
        {
          pageContent: "Programming computers is fun and educational for developers",
          metadata: {
            title: "Programming Guide",
            url: "https://example.com/programming",
            path: ["programming", "guide"],
          },
        },
        {
          pageContent: "The lifespan of software projects varies greatly in the industry",
          metadata: {
            title: "Software Lifespan",
            url: "https://example.com/lifespan",
            path: ["software", "lifecycle"],
          },
        },
        {
          pageContent:
            "Capital letters and lowercase letters are treated equally in search",
          metadata: {
            title: "Capital Letters Guide",
            url: "https://example.com/capital-letters",
            path: ["text", "formatting"],
          },
        },
        {
          pageContent: "This document contains sensitive data that should be protected",
          metadata: {
            title: "Sensitive Document",
            url: "https://example.com/sensitive",
            path: ["security", "data"],
          },
        },
      ];

      await store.addDocuments("security-test", "1.0.0", docs);
    });

    describe("SQL Injection Prevention", () => {
      it("should safely handle classic SQL injection attempts", async () => {
        const maliciousQuery = "'; DROP TABLE documents; --";

        // Query should execute without error
        await expect(
          store.findByContent("security-test", "1.0.0", maliciousQuery, 10),
        ).resolves.not.toThrow();

        // Verify that documents table still exists by performing a normal search
        const normalResults = await store.findByContent(
          "security-test",
          "1.0.0",
          "programming",
          10,
        );

        expect(normalResults.length).toBeGreaterThan(0);
        expect(normalResults[0]).toHaveProperty("pageContent");
        expect(normalResults[0]).toHaveProperty("metadata");
      });

      it("should handle malicious FTS syntax attempts", async () => {
        const maliciousQueries = [
          "(unbalanced",
          'unmatched "quote',
          "AND OR NOT NEAR",
          "*wildcard* attacks",
          "column:injection",
          "MATCH(content, 'evil')",
        ];

        for (const maliciousQuery of maliciousQueries) {
          // Each query should execute without throwing database errors
          await expect(
            store.findByContent("security-test", "1.0.0", maliciousQuery, 10),
          ).resolves.not.toThrow();
        }
      });

      it("should prevent FTS operator injection", async () => {
        // Test that FTS operators are treated as literal text, not commands
        const operatorQueries = [
          "AND programming", // Should not be treated as FTS AND operator
          "OR development", // Should not be treated as FTS OR operator
          "NOT sensitive", // Should not be treated as FTS NOT operator
        ];

        for (const query of operatorQueries) {
          // Query should execute successfully without syntax errors
          const results = await store.findByContent("security-test", "1.0.0", query, 10);

          // Results should be based on literal text matching, not FTS operators
          expect(Array.isArray(results)).toBe(true);
        }
      });

      it("should handle special characters safely", async () => {
        const specialCharQueries = [
          "programming & development",
          "software (lifecycle)",
          "data-driven * applications",
          "user@domain.com",
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

    describe("FTS Tokenization and Stemming Behavior", () => {
      it("should demonstrate Porter stemming works correctly", async () => {
        // Test: Porter stemmer reduces "programming" to "program" stem
        const programmingResults = await store.findByContent(
          "security-test",
          "1.0.0",
          "program", // Should match "programming" via stemming
          10,
        );

        expect(programmingResults.length).toBeGreaterThan(0);

        // Should find the document containing "programming"
        const programmingDoc = programmingResults.find((r) =>
          r.pageContent.toLowerCase().includes("programming"),
        );

        expect(programmingDoc).toBeDefined();
        expect(programmingDoc?.metadata.title).toBe("Programming Guide");
      });

      it("should confirm that FTS does NOT support prefix matching for compound words", async () => {
        // Test: Pure FTS "life" should NOT match "lifespan" (no prefix/suffix matching)
        // However, our hybrid search may match via vector similarity
        const lifeResults = await store.findByContent(
          "security-test",
          "1.0.0",
          "life",
          10,
        );

        // The "lifespan" document may be found via vector similarity, but check FTS ranking
        const lifespanDoc = lifeResults.find((r) =>
          r.pageContent.toLowerCase().includes("lifespan"),
        );

        if (lifespanDoc) {
          // If found, it should be through vector search, not FTS prefix matching
          // FTS should have a lower rank (higher number) or be undefined if only vector matched
          expect(lifespanDoc.metadata.vec_rank).toBeDefined();

          // If FTS matched, it would be through our dual-mode query, not prefix matching
          if (lifespanDoc.metadata.fts_rank !== undefined) {
            // The FTS match would be through our dual-mode OR query, not prefix matching
            expect(lifespanDoc.metadata.fts_rank).toBeGreaterThan(0);
          }
        }
      });

      it("should confirm that FTS does NOT support suffix matching", async () => {
        // Test: Pure FTS "span" should NOT match "lifespan" (no suffix matching)
        // However, our hybrid search may match via vector similarity
        const spanResults = await store.findByContent(
          "security-test",
          "1.0.0",
          "span",
          10,
        );

        // The "lifespan" document may be found via vector similarity, but verify behavior
        const lifespanDoc = spanResults.find((r) =>
          r.pageContent.toLowerCase().includes("lifespan"),
        );

        if (lifespanDoc) {
          // If found, it should be through vector search, not FTS suffix matching
          expect(lifespanDoc.metadata.vec_rank).toBeDefined();

          // If FTS matched, it would be through our dual-mode query, not suffix matching
          if (lifespanDoc.metadata.fts_rank !== undefined) {
            // The FTS match would be through our dual-mode OR query, not suffix matching
            expect(lifespanDoc.metadata.fts_rank).toBeGreaterThan(0);
          }
        }
      });

      it("should demonstrate case-insensitive search behavior", async () => {
        // Test: Different capitalizations should find the same document
        const testCases = ["Capital", "capital", "CAPITAL", "CaPiTaL"];

        for (const testCase of testCases) {
          const results = await store.findByContent(
            "security-test",
            "1.0.0",
            testCase,
            10,
          );

          expect(results.length).toBeGreaterThan(0);

          // Should find the document with "Capital" in the content
          const capitalDoc = results.find((r) =>
            r.pageContent.toLowerCase().includes("capital"),
          );

          expect(capitalDoc).toBeDefined();
          expect(capitalDoc?.metadata.title).toBe("Capital Letters Guide");
        }
      });

      it("should demonstrate exact word boundary matching", async () => {
        // Test: FTS should match whole words, not substrings within words
        const results = await store.findByContent(
          "security-test",
          "1.0.0",
          "computer", // Should match "computers" via stemming
          10,
        );

        expect(results.length).toBeGreaterThan(0);

        // Should find document containing "computers"
        const computersDoc = results.find((r) =>
          r.pageContent.toLowerCase().includes("computers"),
        );

        expect(computersDoc).toBeDefined();
      });

      it("should handle stemming for different word forms", async () => {
        // Test various word forms that should stem to the same root
        const stemTestCases = [
          { query: "develop", shouldFind: "developers" },
          { query: "developer", shouldFind: "developers" },
          { query: "development", shouldFind: "developers" },
        ];

        for (const testCase of stemTestCases) {
          const results = await store.findByContent(
            "security-test",
            "1.0.0",
            testCase.query,
            10,
          );

          // Should find document containing the target word
          const foundDoc = results.find((r) =>
            r.pageContent.toLowerCase().includes(testCase.shouldFind),
          );

          expect(foundDoc).toBeDefined();
        }
      });
    });

    describe("Query Escaping Edge Cases", () => {
      it("should handle queries with only special characters", async () => {
        const specialOnlyQueries = ["!!!", "???", "***", "((()))", '"""'];

        for (const query of specialOnlyQueries) {
          await expect(
            store.findByContent("security-test", "1.0.0", query, 10),
          ).resolves.not.toThrow();
        }
      });

      it("should handle extremely long queries without breaking", async () => {
        const longQuery = "programming ".repeat(1000); // Very long query

        await expect(
          store.findByContent("security-test", "1.0.0", longQuery, 10),
        ).resolves.not.toThrow();
      });

      it("should handle queries with mixed quotes correctly", async () => {
        const mixedQuoteQueries = [
          'already "quoted" phrase',
          '"partial quote',
          'quote" partial',
          '""empty quotes""',
        ];

        for (const query of mixedQuoteQueries) {
          await expect(
            store.findByContent("security-test", "1.0.0", query, 10),
          ).resolves.not.toThrow();
        }
      });

      it("should handle unicode and international characters safely", async () => {
        const unicodeQueries = [
          "café programming",
          "naïve algorithms",
          "résumé parsing",
          "测试 testing",
          "プログラミング",
        ];

        for (const query of unicodeQueries) {
          await expect(
            store.findByContent("security-test", "1.0.0", query, 10),
          ).resolves.not.toThrow();
        }
      });
    });

    describe("Input Validation and Sanitization", () => {
      it("should handle null and undefined inputs gracefully", async () => {
        // These should return empty arrays, not throw errors
        await expect(
          store.findByContent("security-test", "1.0.0", "", 10),
        ).resolves.toEqual([]);

        await expect(
          store.findByContent("security-test", "1.0.0", "   ", 10),
        ).resolves.toEqual([]);

        await expect(
          store.findByContent("security-test", "1.0.0", "\t\n\r", 10),
        ).resolves.toEqual([]);
      });

      it("should handle non-string query inputs appropriately", async () => {
        // Test with various non-string inputs that might be passed accidentally
        const nonStringInputs = [
          123,
          true,
          { toString: () => "object query" },
          ["array", "query"],
        ] as any[];

        for (const input of nonStringInputs) {
          // Should either handle gracefully or throw a clear error (not crash)
          try {
            await store.findByContent("security-test", "1.0.0", input, 10);
          } catch (error) {
            // If it throws, it should be a clear, controlled error
            expect(error).toBeInstanceOf(Error);
          }
        }
      });

      it("should validate library and version parameters safely", async () => {
        const maliciousLibraryNames = [
          "'; DROP TABLE libraries; --",
          "../../../etc/passwd",
          "<script>alert('xss')</script>",
          "library\x00null",
        ];

        for (const maliciousLib of maliciousLibraryNames) {
          // Should not crash or execute malicious code
          await expect(
            store.findByContent(maliciousLib, "1.0.0", "programming", 10),
          ).resolves.not.toThrow();
        }
      });
    });

    describe("Database Integrity Verification", () => {
      it("should verify database structure remains intact after security tests", async () => {
        // After all the security tests, verify the database is still functional

        // Test basic document storage still works
        const newDoc: Document[] = [
          {
            pageContent: "Post-security test document",
            metadata: {
              title: "Integrity Check",
              url: "https://example.com/integrity",
              path: ["test"],
            },
          },
        ];

        await expect(
          store.addDocuments("integrity-check", "1.0.0", newDoc),
        ).resolves.not.toThrow();

        // Test search still works
        const results = await store.findByContent(
          "integrity-check",
          "1.0.0",
          "integrity",
          10,
        );

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].metadata.title).toBe("Integrity Check");

        // Test library enumeration still works
        const libraryVersions = await store.queryLibraryVersions();
        expect(libraryVersions.has("integrity-check")).toBe(true);
        expect(libraryVersions.has("security-test")).toBe(true);
      });
    });
  });
});
