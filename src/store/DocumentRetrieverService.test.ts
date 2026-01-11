import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../utils/config";
import { loadConfig } from "../utils/config";
import { DocumentRetrieverService } from "./DocumentRetrieverService";
import { DocumentStore } from "./DocumentStore";
import type { DbChunkRank, DbPageChunk } from "./types";

vi.mock("./DocumentStore");

describe("DocumentRetrieverService", () => {
  let store: DocumentStore;
  let service: DocumentRetrieverService;
  let config: AppConfig;

  beforeEach(async () => {
    vi.clearAllMocks();
    config = loadConfig();
    store = new DocumentStore(":memory:", config);
    await store.initialize();
    service = new DocumentRetrieverService(store, config);
  });

  it("should return an empty array when no documents are found", async () => {
    vi.spyOn(store, "findByContent").mockResolvedValue([]);
    const results = await service.search("lib", "1.0.0", "query");
    expect(results).toEqual([]);
  });

  it("should consolidate multiple hits from the same URL into a single ordered result", async () => {
    const library = "lib";
    const version = "1.0.0";
    const query = "test";
    // Two initial hits from the same URL, with overlapping context
    const initialResult1 = {
      id: "doc1",
      content: "Chunk A",
      url: "url",
      score: 0.9,
      sort_order: 1,
      metadata: {},
    } as DbPageChunk & DbChunkRank;
    const initialResult2 = {
      id: "doc3",
      content: "Chunk C",
      url: "url",
      score: 0.8,
      sort_order: 3,
      metadata: {},
    } as DbPageChunk & DbChunkRank;
    const doc2 = {
      id: "doc2",
      content: "Chunk B",
      url: "url",
      sort_order: 2,
      metadata: {},
    } as DbPageChunk & DbChunkRank;

    vi.spyOn(store, "findByContent").mockResolvedValue([initialResult1, initialResult2]);

    vi.spyOn(store, "findParentChunk").mockImplementation(async () => null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockImplementation(async () => []);
    vi.spyOn(store, "findChildChunks").mockImplementation(async (_lib, _ver, id) =>
      id === "doc1" ? [doc2] : [],
    );
    vi.spyOn(store, "findSubsequentSiblingChunks").mockImplementation(
      async (_lib, _ver, id) => (id === "doc1" ? [doc2] : []),
    );
    const findChunksByIdsSpy = vi.spyOn(store, "findChunksByIds").mockResolvedValue([
      initialResult1, // doc1 (Chunk A)
      doc2, // doc2 (Chunk B)
      initialResult2, // doc3 (Chunk C)
    ]);

    const results = await service.search(library, version, query);

    expect(findChunksByIdsSpy).toHaveBeenCalledWith(
      library,
      version,
      expect.arrayContaining(["doc1", "doc2", "doc3"]),
    );
    expect(results).toEqual([
      {
        content: "Chunk A\n\nChunk B\n\nChunk C",
        url: "url",
        score: 0.9,
      },
    ]);
  });

  it("should return a single result for a single hit with context", async () => {
    const library = "lib";
    const version = "1.0.0";
    const query = "test";
    const initialResult = {
      id: "doc1",
      content: "Main chunk",
      score: 0.7,
      url: "url",
      metadata: {},
    } as DbPageChunk & DbChunkRank;
    const parent = {
      id: "parent1",
      content: "Parent",
      url: "url",
      metadata: {},
    } as DbPageChunk & DbChunkRank;
    const child = {
      id: "child1",
      content: "Child",
      url: "url",
      metadata: {},
    } as DbPageChunk & DbChunkRank;

    vi.spyOn(store, "findByContent").mockResolvedValue([initialResult]);
    vi.spyOn(store, "findParentChunk").mockResolvedValue(parent);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([child]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    const findChunksByIdsSpy = vi
      .spyOn(store, "findChunksByIds")
      .mockResolvedValue([parent, initialResult, child]);

    const results = await service.search(library, version, query);

    expect(findChunksByIdsSpy).toHaveBeenCalledWith(
      library,
      version,
      expect.arrayContaining(["parent1", "doc1", "child1"]),
    );
    expect(results).toEqual([
      {
        content: "Parent\n\nMain chunk\n\nChild",
        url: "url",
        score: 0.7,
      },
    ]);
  });

  it("should return multiple results for hits from different URLs", async () => {
    const library = "lib";
    const version = "1.0.0";
    const query = "test";
    const docA = {
      id: "a1",
      content: "A1",
      url: "urlA",
      score: 0.8,
      metadata: {},
    } as DbPageChunk & DbChunkRank;
    const docB = {
      id: "b1",
      content: "B1",
      url: "urlB",
      score: 0.9,
      metadata: {},
    } as DbPageChunk & DbChunkRank;

    vi.spyOn(store, "findByContent").mockResolvedValue([docA, docB]);
    vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChunksByIds").mockImplementation(async (_lib, _ver, ids) => {
      if (ids.includes("a1")) return [docA];
      if (ids.includes("b1")) return [docB];
      return [];
    });

    const results = await service.search(library, version, query);

    expect(results).toEqual([
      {
        content: "B1",
        url: "urlB",
        score: 0.9,
      },
      {
        content: "A1",
        url: "urlA",
        score: 0.8,
      },
    ]);
  });

  it("should handle all context lookups returning empty", async () => {
    const library = "lib";
    const version = "1.0.0";
    const query = "test";
    const initialResult = {
      id: "doc1",
      content: "Main chunk",
      url: "url",
      score: 0.5,
      metadata: {},
    } as DbPageChunk & DbChunkRank;

    vi.spyOn(store, "findByContent").mockResolvedValue([initialResult]);
    vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    const findChunksByIdsSpy = vi
      .spyOn(store, "findChunksByIds")
      .mockResolvedValue([initialResult]);

    const results = await service.search(library, version, query);

    expect(findChunksByIdsSpy).toHaveBeenCalledWith(
      library,
      version,
      expect.arrayContaining(["doc1"]),
    );
    expect(results).toEqual([
      {
        content: "Main chunk",
        url: "url",
        score: 0.5,
      },
    ]);
  });

  it("should use the provided limit", async () => {
    const library = "lib";
    const version = "1.0.0";
    const query = "test";
    const limit = 3;
    const initialResult = {
      id: "doc1",
      content: "Main chunk",
      url: "url",
      score: 0.5,
      metadata: {},
    } as DbPageChunk & DbChunkRank;

    vi.spyOn(store, "findByContent").mockResolvedValue([initialResult]);
    vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChunksByIds").mockResolvedValue([initialResult]);

    const results = await service.search(library, version, query, limit);

    expect(store.findByContent).toHaveBeenCalledWith(library, version, query, limit);
    expect(results).toEqual([
      {
        content: "Main chunk",
        url: "url",
        score: 0.5,
      },
    ]);
  });

  it("should extract mimeType from document metadata and include it in search result", async () => {
    const library = "lib";
    const version = "1.0.0";
    const query = "test";
    const mimeType = "text/html";

    // Create a document with mimeType in metadata
    const initialResult = {
      id: "doc1",
      content: "HTML content",
      url: "https://example.com",
      score: 0.9,
      content_type: mimeType,
      metadata: {},
    } as DbPageChunk & DbChunkRank;

    vi.spyOn(store, "findByContent").mockResolvedValue([initialResult]);
    vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChunksByIds").mockResolvedValue([initialResult]);

    const results = await service.search(library, version, query);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      url: "https://example.com",
      content: "HTML content",
      score: 0.9,
      mimeType: "text/html",
    });
  });

  it("should handle missing mimeType gracefully", async () => {
    const library = "lib";
    const version = "1.0.0";
    const query = "test";

    // Create a document without mimeType in metadata
    const initialResult = {
      id: "doc1",
      content: "Plain content",
      url: "https://example.com",
      score: 0.9,
      metadata: {},
    } as DbPageChunk & DbChunkRank;

    vi.spyOn(store, "findByContent").mockResolvedValue([initialResult]);
    vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChunksByIds").mockResolvedValue([initialResult]);

    const results = await service.search(library, version, query);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      url: "https://example.com",
      content: "Plain content",
      score: 0.9,
      mimeType: undefined,
    });
  });

  describe("Context Retrieval and Hierarchical Reassembly", () => {
    it("should find parent chunks based on path hierarchy", async () => {
      const library = "lib";
      const version = "1.0.0";
      const query = "test";

      // Child chunk with path ["Chapter 1", "Section 1.1"]
      const childResult = {
        id: "child1",
        content: "Child content",
        url: "https://example.com",
        score: 0.8,
        metadata: {
          path: ["Chapter 1", "Section 1.1"],
          level: 2,
        },
      } as DbPageChunk & DbChunkRank;

      // Parent chunk with path ["Chapter 1"]
      const parentChunk = {
        id: "parent1",
        content: "Parent content",
        url: "https://example.com",
        metadata: {
          path: ["Chapter 1"],
          level: 1,
        },
      } as DbPageChunk & DbChunkRank;

      vi.spyOn(store, "findByContent").mockResolvedValue([childResult]);
      vi.spyOn(store, "findParentChunk").mockResolvedValue(parentChunk);
      vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
      vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
      vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
      vi.spyOn(store, "findChunksByIds").mockResolvedValue([parentChunk, childResult]);

      const results = await service.search(library, version, query);

      expect(store.findParentChunk).toHaveBeenCalledWith(library, version, "child1");
      expect(results).toEqual([
        {
          url: "https://example.com",
          content: "Parent content\n\nChild content",
          score: 0.8,
          mimeType: undefined,
        },
      ]);
    });

    it("should find sibling chunks at the same hierarchical level", async () => {
      const library = "lib";
      const version = "1.0.0";
      const query = "test";

      // Main result chunk
      const mainResult = {
        id: "main1",
        content: "Main content",
        url: "https://example.com",
        score: 0.9,
        metadata: {
          path: ["Chapter 1", "Section 1.2"],
          level: 2,
        },
      } as DbPageChunk & DbChunkRank;

      // Preceding sibling with same path level
      const precedingSibling = {
        id: "preceding1",
        content: "Preceding content",
        url: "https://example.com",
        metadata: {
          path: ["Chapter 1", "Section 1.1"],
          level: 2,
        },
      } as DbPageChunk & DbChunkRank;

      // Subsequent sibling with same path level
      const subsequentSibling = {
        id: "subsequent1",
        content: "Subsequent content",
        url: "https://example.com",
        metadata: {
          path: ["Chapter 1", "Section 1.3"],
          level: 2,
        },
      } as DbPageChunk & DbChunkRank;

      vi.spyOn(store, "findByContent").mockResolvedValue([mainResult]);
      vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
      vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([precedingSibling]);
      vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([
        subsequentSibling,
      ]);
      vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
      vi.spyOn(store, "findChunksByIds").mockResolvedValue([
        precedingSibling,
        mainResult,
        subsequentSibling,
      ]);

      const results = await service.search(library, version, query);

      expect(store.findPrecedingSiblingChunks).toHaveBeenCalledWith(
        library,
        version,
        "main1",
        1,
      );
      expect(store.findSubsequentSiblingChunks).toHaveBeenCalledWith(
        library,
        version,
        "main1",
        2,
      );
      expect(results).toEqual([
        {
          url: "https://example.com",
          content: "Preceding content\n\nMain content\n\nSubsequent content",
          score: 0.9,
          mimeType: undefined,
        },
      ]);
    });

    it("should find child chunks at deeper hierarchical levels", async () => {
      const library = "lib";
      const version = "1.0.0";
      const query = "test";

      // Parent result chunk
      const parentResult = {
        id: "parent1",
        content: "Parent section",
        url: "https://example.com",
        score: 0.7,
        metadata: {
          path: ["Chapter 1"],
          level: 1,
        },
      } as DbPageChunk & DbChunkRank;

      // Child chunks at deeper level
      const child1 = {
        id: "child1",
        content: "First subsection",
        url: "https://example.com",
        metadata: {
          path: ["Chapter 1", "Section 1.1"],
          level: 2,
        },
      } as DbPageChunk & DbChunkRank;

      const child2 = {
        id: "child2",
        content: "Second subsection",
        url: "https://example.com",
        metadata: {
          path: ["Chapter 1", "Section 1.2"],
          level: 2,
        },
      } as DbPageChunk & DbChunkRank;

      vi.spyOn(store, "findByContent").mockResolvedValue([parentResult]);
      vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
      vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
      vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
      vi.spyOn(store, "findChildChunks").mockResolvedValue([child1, child2]);
      vi.spyOn(store, "findChunksByIds").mockResolvedValue([
        parentResult,
        child1,
        child2,
      ]);

      const results = await service.search(library, version, query);

      expect(store.findChildChunks).toHaveBeenCalledWith(library, version, "parent1", 3);
      expect(results).toEqual([
        {
          url: "https://example.com",
          content: "Parent section\n\nFirst subsection\n\nSecond subsection",
          score: 0.7,
          mimeType: undefined,
        },
      ]);
    });

    it("should demonstrate sort_order-based reassembly within same URL", async () => {
      const library = "lib";
      const version = "1.0.0";
      const query = "test";

      // Multiple chunks from same document/URL, returned out of sort_order
      const chunk3 = {
        id: "chunk3",
        content: "Third chunk",
        url: "https://example.com",
        score: 0.6,
        sort_order: 3,
        metadata: {
          path: ["Section C"],
          level: 1,
        },
      } as DbPageChunk & DbChunkRank;

      const chunk1 = {
        id: "chunk1",
        content: "First chunk",
        url: "https://example.com",
        score: 0.8,
        sort_order: 1,
        metadata: {
          path: ["Section A"],
          level: 1,
        },
      } as DbPageChunk & DbChunkRank;

      vi.spyOn(store, "findByContent").mockResolvedValue([chunk3, chunk1]);
      vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
      vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
      vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
      vi.spyOn(store, "findChildChunks").mockResolvedValue([]);

      // findChunksByIds returns chunks in sort_order (simulating database ORDER BY)
      vi.spyOn(store, "findChunksByIds").mockResolvedValue([chunk1, chunk3]);

      const results = await service.search(library, version, query);

      // Should be reassembled in sort_order, not in initial search result order
      expect(results).toEqual([
        {
          url: "https://example.com",
          content: "First chunk\n\nThird chunk",
          score: 0.8, // Highest score from the chunks
          mimeType: undefined,
        },
      ]);
    });

    it("should demonstrate complex hierarchical context expansion", async () => {
      const library = "lib";
      const version = "1.0.0";
      const query = "test";

      // Main search result - a subsection
      const mainResult = {
        id: "main1",
        content: "Key subsection content",
        url: "https://example.com",
        score: 0.9,
        metadata: {
          path: ["Guide", "Installation", "Setup"],
          level: 3,
        },
      } as DbPageChunk & DbChunkRank;

      // Parent at level 2
      const parent = {
        id: "parent1",
        content: "Installation overview",
        url: "https://example.com",
        metadata: {
          path: ["Guide", "Installation"],
          level: 2,
        },
      } as DbPageChunk & DbChunkRank;

      // Preceding sibling at same level
      const precedingSibling = {
        id: "preceding1",
        content: "Prerequisites section",
        url: "https://example.com",
        metadata: {
          path: ["Guide", "Installation", "Prerequisites"],
          level: 3,
        },
      } as DbPageChunk & DbChunkRank;

      // Child at deeper level
      const child = {
        id: "child1",
        content: "Detailed setup steps",
        url: "https://example.com",
        metadata: {
          path: ["Guide", "Installation", "Setup", "Steps"],
          level: 4,
        },
      } as DbPageChunk & DbChunkRank;

      // Subsequent sibling
      const subsequentSibling = {
        id: "subsequent1",
        content: "Configuration section",
        url: "https://example.com",
        metadata: {
          path: ["Guide", "Installation", "Configuration"],
          level: 3,
        },
      } as DbPageChunk & DbChunkRank;

      vi.spyOn(store, "findByContent").mockResolvedValue([mainResult]);
      vi.spyOn(store, "findParentChunk").mockResolvedValue(parent);
      vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([precedingSibling]);
      vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([
        subsequentSibling,
      ]);
      vi.spyOn(store, "findChildChunks").mockResolvedValue([child]);

      // Database returns in sort_order
      vi.spyOn(store, "findChunksByIds").mockResolvedValue([
        parent,
        precedingSibling,
        mainResult,
        child,
        subsequentSibling,
      ]);

      const results = await service.search(library, version, query);

      expect(results).toEqual([
        {
          url: "https://example.com",
          content:
            "Installation overview\n\nPrerequisites section\n\nKey subsection content\n\nDetailed setup steps\n\nConfiguration section",
          score: 0.9,
          mimeType: undefined,
        },
      ]);
    });
  });

  describe("Content-Type-Aware Assembly Strategy", () => {
    it("should use MarkdownAssemblyStrategy for markdown content", async () => {
      const library = "lib";
      const version = "1.0.0";
      const query = "test";

      const markdownChunk = {
        id: "md1",
        content: "# Heading\n\nSome content",
        url: "https://example.com/doc.md",
        score: 0.9,
        content_type: "text/markdown",
        metadata: {},
      } as DbPageChunk & DbChunkRank;

      vi.spyOn(store, "findByContent").mockResolvedValue([markdownChunk]);
      vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
      vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
      vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
      vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
      vi.spyOn(store, "findChunksByIds").mockResolvedValue([markdownChunk]);

      const results = await service.search(library, version, query);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        url: "https://example.com/doc.md",
        content: "# Heading\n\nSome content", // Should use "\n\n" joining for markdown
        score: 0.9,
        mimeType: "text/markdown",
      });
    });

    it("should use HierarchicalAssemblyStrategy for source code content", async () => {
      const library = "lib";
      const version = "1.0.0";
      const query = "test";

      const codeChunk = {
        id: "ts1",
        content: "function test() {\n  return 'hello';\n}",
        url: "https://example.com/code.ts",
        score: 0.9,
        content_type: "text/x-typescript",
        metadata: {},
      } as DbPageChunk & DbChunkRank;

      vi.spyOn(store, "findByContent").mockResolvedValue([codeChunk]);
      // Mock the hierarchical strategy's fallback behavior since we don't have full hierarchy implementation
      vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
      vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
      vi.spyOn(store, "findChunksByIds").mockResolvedValue([codeChunk]);

      const results = await service.search(library, version, query);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        url: "https://example.com/code.ts",
        content: "function test() {\n  return 'hello';\n}", // Should use simple concatenation for code
        score: 0.9,
        mimeType: "text/x-typescript",
      });
    });

    it("should use HierarchicalAssemblyStrategy for JSON content", async () => {
      const library = "lib";
      const version = "1.0.0";
      const query = "test";

      const jsonChunk = {
        id: "json1",
        content: '{"key": "value"}',
        url: "https://example.com/config.json",
        score: 0.9,
        content_type: "application/json",
        metadata: {},
      } as DbPageChunk & DbChunkRank;

      vi.spyOn(store, "findByContent").mockResolvedValue([jsonChunk]);
      vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
      vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
      vi.spyOn(store, "findChunksByIds").mockResolvedValue([jsonChunk]);

      const results = await service.search(library, version, query);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        url: "https://example.com/config.json",
        content: '{"key": "value"}', // Should use simple concatenation for JSON
        score: 0.9,
        mimeType: "application/json",
      });
    });

    it("should handle missing MIME type with default MarkdownAssemblyStrategy", async () => {
      const library = "lib";
      const version = "1.0.0";
      const query = "test";

      const unknownChunk = {
        id: "unknown1",
        content: "Some content",
        url: "https://example.com/unknown",
        score: 0.9,
        // No mimeType specified
        metadata: {},
      } as DbPageChunk & DbChunkRank;

      vi.spyOn(store, "findByContent").mockResolvedValue([unknownChunk]);
      vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
      vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
      vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
      vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
      vi.spyOn(store, "findChunksByIds").mockResolvedValue([unknownChunk]);

      const results = await service.search(library, version, query);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        url: "https://example.com/unknown",
        content: "Some content", // Should default to markdown strategy
        score: 0.9,
        mimeType: undefined,
      });
    });
  });

  describe("Smart Chunking (Distance-based Clustering)", () => {
    it("should split distant chunks from the same URL into separate results", async () => {
      const library = "lib";
      const version = "1.0.0";
      const query = "test";

      // Two chunks from same URL but far apart
      const chunk1 = {
        id: "chunk1",
        content: "First chunk",
        url: "https://example.com/doc",
        score: 0.9,
        sort_order: 10,
        metadata: {},
      } as DbPageChunk & DbChunkRank;

      const chunk2 = {
        id: "chunk2",
        content: "Second chunk",
        url: "https://example.com/doc",
        score: 0.8,
        sort_order: 100, // Distance = 90 > maxChunkDistance (3)
        metadata: {},
      } as DbPageChunk & DbChunkRank;

      vi.spyOn(store, "findByContent").mockResolvedValue([chunk1, chunk2]);
      vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
      vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
      vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
      vi.spyOn(store, "findChildChunks").mockResolvedValue([]);

      // Mock findChunksByIds to return the specific chunk requested
      vi.spyOn(store, "findChunksByIds").mockImplementation(async (_lib, _ver, ids) => {
        if (ids.includes("chunk1")) return [chunk1];
        if (ids.includes("chunk2")) return [chunk2];
        return [];
      });

      const results = await service.search(library, version, query);

      expect(results).toHaveLength(2);
      // Results should be separate
      expect(results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ content: "First chunk", score: 0.9 }),
          expect.objectContaining({ content: "Second chunk", score: 0.8 }),
        ]),
      );
    });

    it("should merge close chunks from the same URL", async () => {
      const library = "lib";
      const version = "1.0.0";
      const query = "test";

      // Two chunks from same URL and close together
      const chunk1 = {
        id: "chunk1",
        content: "First chunk",
        url: "https://example.com/doc",
        score: 0.9,
        sort_order: 10,
        metadata: {},
      } as DbPageChunk & DbChunkRank;

      const chunk2 = {
        id: "chunk2",
        content: "Second chunk",
        url: "https://example.com/doc",
        score: 0.8,
        sort_order: 12, // Distance = 2 <= maxChunkDistance (3)
        metadata: {},
      } as DbPageChunk & DbChunkRank;

      vi.spyOn(store, "findByContent").mockResolvedValue([chunk1, chunk2]);
      vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
      vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
      vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
      vi.spyOn(store, "findChildChunks").mockResolvedValue([]);

      // When merged, findChunksByIds is called with both IDs.
      // It should return them sorted by sort_order.
      vi.spyOn(store, "findChunksByIds").mockResolvedValue([chunk1, chunk2]);

      const results = await service.search(library, version, query);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(
        expect.objectContaining({
          content: "First chunk\n\nSecond chunk",
          score: 0.9, // Should take the max score
        }),
      );
    });

    it("should sort final results by score", async () => {
      const library = "lib";
      const version = "1.0.0";
      const query = "test";

      // Three chunks:
      // A: score 0.5 (low)
      // B: score 0.9 (high) - separate from A
      // C: score 0.7 (medium) - different URL

      const chunkA = {
        id: "chunkA",
        content: "Chunk A",
        url: "https://example.com/doc1",
        score: 0.5,
        sort_order: 10,
        metadata: {},
      } as DbPageChunk & DbChunkRank;

      const chunkB = {
        id: "chunkB",
        content: "Chunk B",
        url: "https://example.com/doc1",
        score: 0.9,
        sort_order: 100, // Far from A
        metadata: {},
      } as DbPageChunk & DbChunkRank;

      const chunkC = {
        id: "chunkC",
        content: "Chunk C",
        url: "https://example.com/doc2",
        score: 0.7,
        sort_order: 5,
        metadata: {},
      } as DbPageChunk & DbChunkRank;

      vi.spyOn(store, "findByContent").mockResolvedValue([chunkA, chunkB, chunkC]);
      vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
      vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
      vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
      vi.spyOn(store, "findChildChunks").mockResolvedValue([]);

      vi.spyOn(store, "findChunksByIds").mockImplementation(async (_lib, _ver, ids) => {
        if (ids.includes("chunkA")) return [chunkA];
        if (ids.includes("chunkB")) return [chunkB];
        if (ids.includes("chunkC")) return [chunkC];
        return [];
      });

      const results = await service.search(library, version, query);

      expect(results).toHaveLength(3);
      // Order should be B (0.9), then C (0.7), then A (0.5)
      expect(results[0].content).toBe("Chunk B");
      expect(results[1].content).toBe("Chunk C");
      expect(results[2].content).toBe("Chunk A");
    });
  });
});
