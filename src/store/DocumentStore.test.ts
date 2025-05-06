import {
  type Mock,
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { VECTOR_DIMENSION } from "./types";

// --- Mocking Setup ---

// Mock the embedding factory
vi.mock("./embeddings/EmbeddingFactory");

// Mock embedding functions
const mockEmbedQuery = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
const mockEmbedDocuments = vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]);

import { createEmbeddingModel } from "./embeddings/EmbeddingFactory";
(createEmbeddingModel as Mock).mockReturnValue({
  embedQuery: vi.fn(),
  embedDocuments: vi.fn(),
});

/**
 * Initial generic mocks for better-sqlite3.
 * Will be replaced with dynamic mocks after vi.mock due to hoisting.
 */
const mockStatementAll = vi.fn().mockReturnValue([]);
const mockStatement = {
  all: mockStatementAll,
  run: vi.fn().mockReturnValue({ changes: 0, lastInsertRowid: 1 }),
  get: vi.fn().mockReturnValue(undefined),
};
let mockPrepare = vi.fn().mockReturnValue(mockStatement);
const mockDb = {
  prepare: (...args: unknown[]) => mockPrepare(...args),
  exec: vi.fn(),
  transaction: vi.fn(
    (fn) =>
      (...args: unknown[]) =>
        fn(...args),
  ),
  close: vi.fn(),
};
vi.mock("better-sqlite3", () => ({
  default: vi.fn(() => mockDb),
}));

/**
 * Simplified mockPrepare: always returns a generic statement object.
 * Test-specific SQL overrides are set up in each test/describe as needed.
 */
mockPrepare = vi.fn(() => ({
  get: vi.fn().mockReturnValue(undefined),
  run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
  all: mockStatementAll,
}));
mockDb.prepare = (...args: unknown[]) => mockPrepare(...args);

// Mock sqlite-vec
vi.mock("sqlite-vec", () => ({
  load: vi.fn(),
}));

// Mock the migration runner to prevent DB calls during init in tests
vi.mock("./applyMigrations", () => ({
  applyMigrations: vi.fn(), // Mock the exported function
}));

// --- Test Suite ---

// Import DocumentStore AFTER mocks are defined
import { DocumentStore } from "./DocumentStore";

describe("DocumentStore", () => {
  let documentStore: DocumentStore;

  beforeEach(async () => {
    vi.clearAllMocks(); // Clear call history etc.
    mockStatementAll.mockClear();
    mockStatementAll.mockReturnValue([]);

    // Reset the mock factory implementation for this test run
    (createEmbeddingModel as ReturnType<typeof vi.fn>).mockReturnValue({
      embedQuery: mockEmbedQuery,
      embedDocuments: mockEmbedDocuments,
    });
    // Reset embedQuery to handle initialization vector
    mockEmbedQuery.mockResolvedValue(new Array(VECTOR_DIMENSION).fill(0.1));

    // Now create the store and initialize.
    // initialize() will call 'new OpenAIEmbeddings()', which uses our fresh mock implementation.
    documentStore = new DocumentStore(":memory:");
    await documentStore.initialize();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe("findChunksByIds", () => {
    const library = "test-lib";
    const version = "1.0.0";

    it("should fetch and return documents for given IDs, sorted by sort_order", async () => {
      const ids = ["id1", "id2", "id3"];
      const mockRows = [
        {
          id: "id2",
          library,
          version,
          url: "url2",
          content: "content2",
          metadata: JSON.stringify({ url: "url2", score: 0.5 }),
          embedding: null,
          sort_order: 1,
          score: 0.5,
        },
        {
          id: "id1",
          library,
          version,
          url: "url1",
          content: "content1",
          metadata: JSON.stringify({ url: "url1", score: 0.9 }),
          embedding: null,
          sort_order: 0,
          score: 0.9,
        },
        {
          id: "id3",
          library,
          version,
          url: "url3",
          content: "content3",
          metadata: JSON.stringify({ url: "url3", score: 0.7 }),
          embedding: null,
          sort_order: 2,
          score: 0.7,
        },
      ];
      // Should be returned sorted by sort_order: id1, id2, id3
      mockStatementAll.mockReturnValueOnce([mockRows[1], mockRows[0], mockRows[2]]);
      const result = await documentStore.findChunksByIds(library, version, ids);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("id IN"));
      expect(mockStatementAll).toHaveBeenCalledWith(
        library.toLowerCase(),
        version.toLowerCase(),
        ...ids,
      );
      expect(result.length).toBe(3);
      expect(result[0].id).toBe("id1");
      expect(result[1].id).toBe("id2");
      expect(result[2].id).toBe("id3");
      expect(result[0].pageContent).toBe("content1");
      expect(result[1].pageContent).toBe("content2");
      expect(result[2].pageContent).toBe("content3");
    });

    it("should return an empty array if no IDs are provided", async () => {
      const prepareCallsBefore = mockPrepare.mock.calls.length;
      const allCallsBefore = mockStatementAll.mock.calls.length;
      const result = await documentStore.findChunksByIds(library, version, []);
      expect(result).toEqual([]);
      expect(mockPrepare.mock.calls.length).toBe(prepareCallsBefore);
      expect(mockStatementAll.mock.calls.length).toBe(allCallsBefore);
    });

    it("should return an empty array if no documents are found", async () => {
      mockStatementAll.mockReturnValueOnce([]);
      const result = await documentStore.findChunksByIds(library, version, ["idX"]);
      expect(result).toEqual([]);
      expect(mockPrepare).toHaveBeenCalled();
      expect(mockStatementAll).toHaveBeenCalled();
    });
  });

  describe("findByContent", () => {
    const library = "test-lib";
    const version = "1.0.0";
    const limit = 10;

    it("should call embedQuery and prepare/all with escaped FTS query for double quotes", async () => {
      const query = 'find "quotes"';
      const expectedFtsQuery = '"find ""quotes"""'; // Escaped and wrapped

      await documentStore.findByContent(library, version, query, limit);

      // 1. Check if embedQuery was called with correct args
      // Note: embedQuery is called twice - once during init and once for search
      const embedCalls = mockEmbedQuery.mock.calls;
      expect(embedCalls[embedCalls.length - 1][0]).toBe(query); // Last call should be our search

      // 2. Check if db.prepare was called correctly during findByContent
      // It's called multiple times during initialize, so check the specific call
      const prepareCall = mockPrepare.mock.calls.find((call) =>
        call[0].includes("WITH vec_scores AS"),
      );
      expect(prepareCall).toBeDefined();

      // 3. Check the arguments passed to the statement's 'all' method
      expect(mockStatementAll).toHaveBeenCalledTimes(1); // Only the findByContent call should use 'all'
      const lastCallArgs = mockStatementAll.mock.lastCall;
      expect(lastCallArgs).toEqual([
        library.toLowerCase(),
        version.toLowerCase(),
        expect.any(String), // Embedding JSON
        limit,
        library.toLowerCase(),
        version.toLowerCase(),
        expectedFtsQuery, // Check the escaped query string
        limit,
      ]);
    });

    it("should correctly escape FTS operators", async () => {
      const query = "search AND this OR that";
      const expectedFtsQuery = '"search AND this OR that"';
      await documentStore.findByContent(library, version, query, limit);
      expect(mockStatementAll).toHaveBeenCalledTimes(1);
      const lastCallArgs = mockStatementAll.mock.lastCall;
      expect(lastCallArgs?.[6]).toBe(expectedFtsQuery); // Check only the FTS query argument
    });

    it("should correctly escape parentheses", async () => {
      const query = "function(arg)";
      const expectedFtsQuery = '"function(arg)"';
      await documentStore.findByContent(library, version, query, limit);
      expect(mockStatementAll).toHaveBeenCalledTimes(1);
      const lastCallArgs = mockStatementAll.mock.lastCall;
      expect(lastCallArgs?.[6]).toBe(expectedFtsQuery);
    });

    it("should correctly escape asterisks", async () => {
      const query = "wildcard*";
      const expectedFtsQuery = '"wildcard*"';
      await documentStore.findByContent(library, version, query, limit);
      expect(mockStatementAll).toHaveBeenCalledTimes(1);
      const lastCallArgs = mockStatementAll.mock.lastCall;
      expect(lastCallArgs?.[6]).toBe(expectedFtsQuery);
    });

    it("should correctly escape already quoted strings", async () => {
      const query = '"already quoted"';
      const expectedFtsQuery = '"""already quoted"""';
      await documentStore.findByContent(library, version, query, limit);
      expect(mockStatementAll).toHaveBeenCalledTimes(1);
      const lastCallArgs = mockStatementAll.mock.lastCall;
      expect(lastCallArgs?.[6]).toBe(expectedFtsQuery);
    });

    it("should correctly handle empty string", async () => {
      const query = "";
      const expectedFtsQuery = '""';
      await documentStore.findByContent(library, version, query, limit);
      expect(mockStatementAll).toHaveBeenCalledTimes(1);
      const lastCallArgs = mockStatementAll.mock.lastCall;
      expect(lastCallArgs?.[6]).toBe(expectedFtsQuery);
    });
  });

  describe("addDocuments - Batching", () => {
    it("should process embeddings in batches when document count exceeds EMBEDDING_BATCH_SIZE", async () => {
      const { EMBEDDING_BATCH_SIZE } = await import("../utils/config");
      const numDocuments = EMBEDDING_BATCH_SIZE + 5;
      const documents = Array.from({ length: numDocuments }, (_, i) => ({
        pageContent: `doc${i + 1} text`,
        metadata: { title: `t${i + 1}`, url: `u1/${i + 1}`, path: [`p${i + 1}`] },
      }));

      const mockEmbeddingDim = VECTOR_DIMENSION;
      const firstBatchEmbeddings = Array.from({ length: EMBEDDING_BATCH_SIZE }, () =>
        new Array(mockEmbeddingDim).fill(0.1),
      );
      const secondBatchEmbeddings = Array.from(
        { length: numDocuments - EMBEDDING_BATCH_SIZE },
        () => new Array(mockEmbeddingDim).fill(0.2),
      );

      mockEmbedDocuments
        .mockResolvedValueOnce(firstBatchEmbeddings)
        .mockResolvedValueOnce(secondBatchEmbeddings);

      // Mock insertDocument to return sequential rowids
      for (let i = 0; i < numDocuments; i++) {
        mockStatement.run.mockReturnValueOnce({
          changes: 1,
          lastInsertRowid: BigInt(i + 1),
        });
      }

      await documentStore.addDocuments("test-lib-large-batch", "1.0.0", documents);

      expect(mockEmbedDocuments).toHaveBeenCalledTimes(2);
      expect((mockEmbedDocuments.mock.calls[0][0] as string[]).length).toBe(
        EMBEDDING_BATCH_SIZE,
      );
      expect((mockEmbedDocuments.mock.calls[1][0] as string[]).length).toBe(
        numDocuments - EMBEDDING_BATCH_SIZE,
      );
    });
  });

  describe("Embedding Model Dimensions", () => {
    let getLibraryIdByNameMock: Mock;
    let insertLibraryMock: Mock;
    let lastInsertedVector: number[];

    beforeEach(() => {
      getLibraryIdByNameMock = vi.fn().mockReturnValue({ id: 1 });
      insertLibraryMock = vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 });
      lastInsertedVector = [];

      mockPrepare.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id FROM libraries WHERE name = ?")) {
          return {
            get: getLibraryIdByNameMock,
            run: vi.fn(),
            all: mockStatementAll,
          };
        }
        if (sql.includes("INSERT INTO libraries")) {
          return {
            run: insertLibraryMock,
            get: vi.fn(),
            all: mockStatementAll,
          };
        }
        if (sql.includes("INSERT INTO documents_vec")) {
          return {
            run: vi.fn((...args) => {
              if (typeof args[3] === "string") {
                try {
                  const arr = JSON.parse(args[3]);
                  if (Array.isArray(arr)) lastInsertedVector = arr;
                } catch {}
              }
              return { changes: 1, lastInsertRowid: 1 };
            }),
            get: vi.fn(),
            all: mockStatementAll,
          };
        }
        return {
          get: vi.fn(),
          run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
          all: mockStatementAll,
        };
      });
    });

    afterEach(() => {
      mockPrepare.mockImplementation(() => ({
        get: vi.fn().mockReturnValue(undefined),
        run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
        all: mockStatementAll,
      }));
    });

    it("should accept a model that produces ${VECTOR_DIMENSION}-dimensional vectors", async () => {
      mockEmbedQuery.mockResolvedValueOnce(new Array(VECTOR_DIMENSION).fill(0.1));
      documentStore = new DocumentStore(":memory:");
      await expect(documentStore.initialize()).resolves.not.toThrow();
    });

    it("should accept and pad vectors from models with smaller dimensions", async () => {
      mockEmbedQuery.mockResolvedValueOnce(new Array(768).fill(0.1));
      mockEmbedDocuments.mockResolvedValueOnce([new Array(768).fill(0.1)]);

      documentStore = new DocumentStore(":memory:");
      await documentStore.initialize();

      const doc = {
        pageContent: "test content",
        metadata: { title: "test", url: "http://test.com", path: ["test"] },
      };

      await expect(
        documentStore.addDocuments("test-lib", "1.0.0", [doc]),
      ).resolves.not.toThrow();
    });

    it("should reject models that produce vectors larger than ${VECTOR_DIMENSION} dimensions", async () => {
      mockEmbedQuery.mockResolvedValueOnce(new Array(3072).fill(0.1));
      documentStore = new DocumentStore(":memory:");
      await expect(documentStore.initialize()).rejects.toThrow(
        new RegExp(`exceeds.*${VECTOR_DIMENSION}`),
      );
    });

    it("should pad both document and query vectors consistently", async () => {
      const smallVector = new Array(768).fill(0.1);
      mockEmbedQuery
        .mockResolvedValueOnce(smallVector)
        .mockResolvedValueOnce(smallVector);
      mockEmbedDocuments.mockResolvedValueOnce([smallVector]);

      documentStore = new DocumentStore(":memory:");
      await documentStore.initialize();

      const doc = {
        pageContent: "test content",
        metadata: { title: "test", url: "http://test.com", path: ["test"] },
      };

      mockStatementAll.mockImplementationOnce(() => [
        {
          id: "id1",
          content: "content",
          metadata: JSON.stringify({}),
          vec_score: 1,
          fts_score: 1,
        },
      ]);

      await documentStore.addDocuments("test-lib", "1.0.0", [doc]);

      await expect(
        documentStore.findByContent("test-lib", "1.0.0", "test query", 5),
      ).resolves.not.toThrow();

      const searchCall = mockStatementAll.mock.lastCall;
      const searchVector = JSON.parse(searchCall?.[2] || "[]");

      expect(lastInsertedVector.length).toBe(VECTOR_DIMENSION);
      expect(searchVector.length).toBe(VECTOR_DIMENSION);
    });
  });

  describe("queryLibraryVersions", () => {
    it("should return a map of libraries to their detailed versions", async () => {
      const mockData = [
        {
          library: "react",
          version: "18.2.0",
          documentCount: 150,
          uniqueUrlCount: 50,
          indexedAt: "2024-01-10T10:00:00.000Z",
        },
        {
          library: "react",
          version: "17.0.1",
          documentCount: 120,
          uniqueUrlCount: 45,
          indexedAt: "2023-05-15T12:30:00.000Z",
        },
        {
          library: "vue",
          version: "3.3.0",
          documentCount: 200,
          uniqueUrlCount: 70,
          indexedAt: "2024-02-20T08:00:00.000Z",
        },
        {
          library: "react",
          version: "", // Internal empty version, should be filtered out
          documentCount: 5,
          uniqueUrlCount: 1,
          indexedAt: "2023-01-01T00:00:00.000Z",
        },
        {
          library: "old-lib",
          version: "1.0.0",
          documentCount: 10,
          uniqueUrlCount: 5,
          indexedAt: null, // Test null indexedAt
        },
        {
          library: "unversioned-only", // Test lib with only unversioned
          version: "",
          documentCount: 1,
          uniqueUrlCount: 1,
          indexedAt: "2024-04-01T00:00:00.000Z",
        },
        {
          library: "mixed-versions", // Test lib with semver and unversioned
          version: "1.0.0",
          documentCount: 5,
          uniqueUrlCount: 2,
          indexedAt: "2024-04-02T00:00:00.000Z",
        },
        {
          library: "mixed-versions", // Test lib with semver and unversioned
          version: "",
          documentCount: 2,
          uniqueUrlCount: 1,
          indexedAt: "2024-04-03T00:00:00.000Z",
        },
      ];
      mockStatementAll.mockReturnValue(mockData); // Configure mock return for this test

      const result = await documentStore.queryLibraryVersions();

      // Check the prepared statement was called
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("GROUP BY library, version"),
      );
      expect(mockStatementAll).toHaveBeenCalledTimes(1);

      // Check the structure and content
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(5); // react, vue, old-lib, unversioned-only, mixed-versions

      // Check React versions (should include "" sorted first)
      const reactVersions = result.get("react");
      expect(reactVersions).toBeDefined();
      expect(reactVersions?.length).toBe(3); // Expect 3 versions now
      expect(reactVersions?.[0]).toEqual({
        // Unversioned first
        version: "",
        documentCount: 5,
        uniqueUrlCount: 1,
        indexedAt: new Date("2023-01-01T00:00:00.000Z").toISOString(),
      });
      expect(reactVersions?.[1]).toEqual({
        // Then 17.0.1
        version: "17.0.1",
        documentCount: 120,
        uniqueUrlCount: 45,
        indexedAt: new Date("2023-05-15T12:30:00.000Z").toISOString(),
      });
      expect(reactVersions?.[2]).toEqual({
        // Then 18.2.0
        version: "18.2.0",
        documentCount: 150,
        uniqueUrlCount: 50,
        indexedAt: new Date("2024-01-10T10:00:00.000Z").toISOString(),
      });

      // Check Vue version
      const vueVersions = result.get("vue");
      expect(vueVersions).toBeDefined();
      expect(vueVersions?.length).toBe(1);
      expect(vueVersions?.[0]).toEqual({
        version: "3.3.0",
        documentCount: 200,
        uniqueUrlCount: 70,
        indexedAt: new Date("2024-02-20T08:00:00.000Z").toISOString(),
      });

      // Check Old Lib version (with null indexedAt)
      const oldLibVersions = result.get("old-lib");
      expect(oldLibVersions).toBeDefined();
      expect(oldLibVersions?.length).toBe(1);
      expect(oldLibVersions?.[0]).toEqual({
        version: "1.0.0",
        documentCount: 10,
        uniqueUrlCount: 5,
        indexedAt: null,
      });

      // Check Unversioned Only lib
      const unversionedOnly = result.get("unversioned-only");
      expect(unversionedOnly).toBeDefined();
      expect(unversionedOnly?.length).toBe(1);
      expect(unversionedOnly?.[0]).toEqual({
        version: "", // Expect empty string version
        documentCount: 1,
        uniqueUrlCount: 1,
        indexedAt: new Date("2024-04-01T00:00:00.000Z").toISOString(),
      });

      // Check Mixed Versions lib (should include "" and be sorted)
      const mixedVersions = result.get("mixed-versions");
      expect(mixedVersions).toBeDefined();
      expect(mixedVersions?.length).toBe(2);
      // Empty string version should come first due to semver compare treating it lowest
      expect(mixedVersions?.[0]).toEqual({
        version: "",
        documentCount: 2,
        uniqueUrlCount: 1,
        indexedAt: new Date("2024-04-03T00:00:00.000Z").toISOString(),
      });
      expect(mixedVersions?.[1]).toEqual({
        version: "1.0.0",
        documentCount: 5,
        uniqueUrlCount: 2,
        indexedAt: new Date("2024-04-02T00:00:00.000Z").toISOString(),
      });
    });

    it("should return an empty map if no libraries are found", async () => {
      mockStatementAll.mockReturnValue([]); // No data
      const result = await documentStore.queryLibraryVersions();
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });
  });
});
