import { Document } from "@langchain/core/documents";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentRetrieverService } from "./DocumentRetrieverService";
import { DocumentStore } from "./DocumentStore";

vi.mock("./DocumentStore");
vi.mock("../utils/logger");

describe("DocumentRetrieverService (consolidated logic)", () => {
  let retrieverService: DocumentRetrieverService;
  let mockDocumentStore: DocumentStore;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDocumentStore = new DocumentStore("mock_connection_string");
    retrieverService = new DocumentRetrieverService(mockDocumentStore);
  });

  it("should return an empty array when no documents are found", async () => {
    vi.spyOn(mockDocumentStore, "findByContent").mockResolvedValue([]);
    const results = await retrieverService.search("lib", "1.0.0", "query");
    expect(results).toEqual([]);
  });

  it("should consolidate multiple hits from the same URL into a single ordered result", async () => {
    const library = "lib";
    const version = "1.0.0";
    const query = "test";
    // Two initial hits from the same URL, with overlapping context
    const initialResult1 = new Document({
      id: "doc1",
      pageContent: "Chunk A",
      metadata: { url: "url", score: 0.9 },
    });
    const initialResult2 = new Document({
      id: "doc3",
      pageContent: "Chunk C",
      metadata: { url: "url", score: 0.8 },
    });
    const doc2 = new Document({
      id: "doc2",
      pageContent: "Chunk B",
      metadata: { url: "url" },
    });

    vi.spyOn(mockDocumentStore, "findByContent").mockResolvedValue([
      initialResult1,
      initialResult2,
    ]);
    vi.spyOn(mockDocumentStore, "findParentChunk").mockImplementation(async () => null);
    vi.spyOn(mockDocumentStore, "findPrecedingSiblingChunks").mockImplementation(
      async () => [],
    );
    vi.spyOn(mockDocumentStore, "findChildChunks").mockImplementation(
      async (_lib, _ver, id) => (id === "doc1" ? [doc2] : []),
    );
    vi.spyOn(mockDocumentStore, "findSubsequentSiblingChunks").mockImplementation(
      async (_lib, _ver, id) => (id === "doc1" ? [doc2] : []),
    );
    const findChunksByIdsSpy = vi
      .spyOn(mockDocumentStore, "findChunksByIds")
      .mockResolvedValue([
        initialResult1, // doc1 (Chunk A)
        doc2, // doc2 (Chunk B)
        initialResult2, // doc3 (Chunk C)
      ]);

    const results = await retrieverService.search(library, version, query);

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
    const initialResult = new Document({
      id: "doc1",
      pageContent: "Main chunk",
      metadata: { url: "url", score: 0.7 },
    });
    const parent = new Document({
      id: "parent1",
      pageContent: "Parent",
      metadata: { url: "url" },
    });
    const child = new Document({
      id: "child1",
      pageContent: "Child",
      metadata: { url: "url" },
    });

    vi.spyOn(mockDocumentStore, "findByContent").mockResolvedValue([initialResult]);
    vi.spyOn(mockDocumentStore, "findParentChunk").mockResolvedValue(parent);
    vi.spyOn(mockDocumentStore, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(mockDocumentStore, "findChildChunks").mockResolvedValue([child]);
    vi.spyOn(mockDocumentStore, "findSubsequentSiblingChunks").mockResolvedValue([]);
    const findChunksByIdsSpy = vi
      .spyOn(mockDocumentStore, "findChunksByIds")
      .mockResolvedValue([parent, initialResult, child]);

    const results = await retrieverService.search(library, version, query);

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
    const docA = new Document({
      id: "a1",
      pageContent: "A1",
      metadata: { url: "urlA", score: 0.8 },
    });
    const docB = new Document({
      id: "b1",
      pageContent: "B1",
      metadata: { url: "urlB", score: 0.9 },
    });

    vi.spyOn(mockDocumentStore, "findByContent").mockResolvedValue([docA, docB]);
    vi.spyOn(mockDocumentStore, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(mockDocumentStore, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(mockDocumentStore, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(mockDocumentStore, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(mockDocumentStore, "findChunksByIds").mockImplementation(
      async (_lib, _ver, ids) => {
        if (ids.includes("a1")) return [docA];
        if (ids.includes("b1")) return [docB];
        return [];
      },
    );

    const results = await retrieverService.search(library, version, query);

    expect(results).toEqual([
      {
        content: "A1",
        url: "urlA",
        score: 0.8,
      },
      {
        content: "B1",
        url: "urlB",
        score: 0.9,
      },
    ]);
  });

  it("should handle all context lookups returning empty", async () => {
    const library = "lib";
    const version = "1.0.0";
    const query = "test";
    const initialResult = new Document({
      id: "doc1",
      pageContent: "Main chunk",
      metadata: { url: "url", score: 0.5 },
    });

    vi.spyOn(mockDocumentStore, "findByContent").mockResolvedValue([initialResult]);
    vi.spyOn(mockDocumentStore, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(mockDocumentStore, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(mockDocumentStore, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(mockDocumentStore, "findSubsequentSiblingChunks").mockResolvedValue([]);
    const findChunksByIdsSpy = vi
      .spyOn(mockDocumentStore, "findChunksByIds")
      .mockResolvedValue([initialResult]);

    const results = await retrieverService.search(library, version, query);

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
    const initialResult = new Document({
      id: "doc1",
      pageContent: "Main chunk",
      metadata: { url: "url", score: 0.5 },
    });

    vi.spyOn(mockDocumentStore, "findByContent").mockResolvedValue([initialResult]);
    vi.spyOn(mockDocumentStore, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(mockDocumentStore, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(mockDocumentStore, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(mockDocumentStore, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(mockDocumentStore, "findChunksByIds").mockResolvedValue([initialResult]);

    const results = await retrieverService.search(library, version, query, limit);

    expect(mockDocumentStore.findByContent).toHaveBeenCalledWith(
      library,
      version,
      query,
      limit,
    );
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
    const initialResult = new Document({
      id: "doc1",
      pageContent: "HTML content",
      metadata: { url: "https://example.com", score: 0.9, mimeType },
    });

    vi.spyOn(mockDocumentStore, "findByContent").mockResolvedValue([initialResult]);
    vi.spyOn(mockDocumentStore, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(mockDocumentStore, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(mockDocumentStore, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(mockDocumentStore, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(mockDocumentStore, "findChunksByIds").mockResolvedValue([initialResult]);

    const results = await retrieverService.search(library, version, query);

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
    const initialResult = new Document({
      id: "doc1",
      pageContent: "Plain content",
      metadata: { url: "https://example.com", score: 0.9 },
    });

    vi.spyOn(mockDocumentStore, "findByContent").mockResolvedValue([initialResult]);
    vi.spyOn(mockDocumentStore, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(mockDocumentStore, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(mockDocumentStore, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(mockDocumentStore, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(mockDocumentStore, "findChunksByIds").mockResolvedValue([initialResult]);

    const results = await retrieverService.search(library, version, query);

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
      const childResult = new Document({
        id: "child1",
        pageContent: "Child content",
        metadata: {
          url: "https://example.com",
          score: 0.8,
          path: ["Chapter 1", "Section 1.1"],
          level: 2,
        },
      });

      // Parent chunk with path ["Chapter 1"]
      const parentChunk = new Document({
        id: "parent1",
        pageContent: "Parent content",
        metadata: {
          url: "https://example.com",
          path: ["Chapter 1"],
          level: 1,
        },
      });

      vi.spyOn(mockDocumentStore, "findByContent").mockResolvedValue([childResult]);
      vi.spyOn(mockDocumentStore, "findParentChunk").mockResolvedValue(parentChunk);
      vi.spyOn(mockDocumentStore, "findPrecedingSiblingChunks").mockResolvedValue([]);
      vi.spyOn(mockDocumentStore, "findSubsequentSiblingChunks").mockResolvedValue([]);
      vi.spyOn(mockDocumentStore, "findChildChunks").mockResolvedValue([]);
      vi.spyOn(mockDocumentStore, "findChunksByIds").mockResolvedValue([
        parentChunk,
        childResult,
      ]);

      const results = await retrieverService.search(library, version, query);

      expect(mockDocumentStore.findParentChunk).toHaveBeenCalledWith(
        library,
        version,
        "child1",
      );
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
      const mainResult = new Document({
        id: "main1",
        pageContent: "Main content",
        metadata: {
          url: "https://example.com",
          score: 0.9,
          path: ["Chapter 1", "Section 1.2"],
          level: 2,
        },
      });

      // Preceding sibling with same path level
      const precedingSibling = new Document({
        id: "preceding1",
        pageContent: "Preceding content",
        metadata: {
          url: "https://example.com",
          path: ["Chapter 1", "Section 1.1"],
          level: 2,
        },
      });

      // Subsequent sibling with same path level
      const subsequentSibling = new Document({
        id: "subsequent1",
        pageContent: "Subsequent content",
        metadata: {
          url: "https://example.com",
          path: ["Chapter 1", "Section 1.3"],
          level: 2,
        },
      });

      vi.spyOn(mockDocumentStore, "findByContent").mockResolvedValue([mainResult]);
      vi.spyOn(mockDocumentStore, "findParentChunk").mockResolvedValue(null);
      vi.spyOn(mockDocumentStore, "findPrecedingSiblingChunks").mockResolvedValue([
        precedingSibling,
      ]);
      vi.spyOn(mockDocumentStore, "findSubsequentSiblingChunks").mockResolvedValue([
        subsequentSibling,
      ]);
      vi.spyOn(mockDocumentStore, "findChildChunks").mockResolvedValue([]);
      vi.spyOn(mockDocumentStore, "findChunksByIds").mockResolvedValue([
        precedingSibling,
        mainResult,
        subsequentSibling,
      ]);

      const results = await retrieverService.search(library, version, query);

      expect(mockDocumentStore.findPrecedingSiblingChunks).toHaveBeenCalledWith(
        library,
        version,
        "main1",
        1,
      );
      expect(mockDocumentStore.findSubsequentSiblingChunks).toHaveBeenCalledWith(
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
      const parentResult = new Document({
        id: "parent1",
        pageContent: "Parent section",
        metadata: {
          url: "https://example.com",
          score: 0.7,
          path: ["Chapter 1"],
          level: 1,
        },
      });

      // Child chunks at deeper level
      const child1 = new Document({
        id: "child1",
        pageContent: "First subsection",
        metadata: {
          url: "https://example.com",
          path: ["Chapter 1", "Section 1.1"],
          level: 2,
        },
      });

      const child2 = new Document({
        id: "child2",
        pageContent: "Second subsection",
        metadata: {
          url: "https://example.com",
          path: ["Chapter 1", "Section 1.2"],
          level: 2,
        },
      });

      vi.spyOn(mockDocumentStore, "findByContent").mockResolvedValue([parentResult]);
      vi.spyOn(mockDocumentStore, "findParentChunk").mockResolvedValue(null);
      vi.spyOn(mockDocumentStore, "findPrecedingSiblingChunks").mockResolvedValue([]);
      vi.spyOn(mockDocumentStore, "findSubsequentSiblingChunks").mockResolvedValue([]);
      vi.spyOn(mockDocumentStore, "findChildChunks").mockResolvedValue([child1, child2]);
      vi.spyOn(mockDocumentStore, "findChunksByIds").mockResolvedValue([
        parentResult,
        child1,
        child2,
      ]);

      const results = await retrieverService.search(library, version, query);

      expect(mockDocumentStore.findChildChunks).toHaveBeenCalledWith(
        library,
        version,
        "parent1",
        3,
      );
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
      const chunk3 = new Document({
        id: "chunk3",
        pageContent: "Third chunk",
        metadata: {
          url: "https://example.com",
          score: 0.6,
          path: ["Section C"],
          level: 1,
        },
      });

      const chunk1 = new Document({
        id: "chunk1",
        pageContent: "First chunk",
        metadata: {
          url: "https://example.com",
          score: 0.8,
          path: ["Section A"],
          level: 1,
        },
      });

      vi.spyOn(mockDocumentStore, "findByContent").mockResolvedValue([chunk3, chunk1]);
      vi.spyOn(mockDocumentStore, "findParentChunk").mockResolvedValue(null);
      vi.spyOn(mockDocumentStore, "findPrecedingSiblingChunks").mockResolvedValue([]);
      vi.spyOn(mockDocumentStore, "findSubsequentSiblingChunks").mockResolvedValue([]);
      vi.spyOn(mockDocumentStore, "findChildChunks").mockResolvedValue([]);

      // findChunksByIds returns chunks in sort_order (simulating database ORDER BY)
      vi.spyOn(mockDocumentStore, "findChunksByIds").mockResolvedValue([chunk1, chunk3]);

      const results = await retrieverService.search(library, version, query);

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
      const mainResult = new Document({
        id: "main1",
        pageContent: "Key subsection content",
        metadata: {
          url: "https://example.com",
          score: 0.9,
          path: ["Guide", "Installation", "Setup"],
          level: 3,
        },
      });

      // Parent at level 2
      const parent = new Document({
        id: "parent1",
        pageContent: "Installation overview",
        metadata: {
          url: "https://example.com",
          path: ["Guide", "Installation"],
          level: 2,
        },
      });

      // Preceding sibling at same level
      const precedingSibling = new Document({
        id: "preceding1",
        pageContent: "Prerequisites section",
        metadata: {
          url: "https://example.com",
          path: ["Guide", "Installation", "Prerequisites"],
          level: 3,
        },
      });

      // Child at deeper level
      const child = new Document({
        id: "child1",
        pageContent: "Detailed setup steps",
        metadata: {
          url: "https://example.com",
          path: ["Guide", "Installation", "Setup", "Steps"],
          level: 4,
        },
      });

      // Subsequent sibling
      const subsequentSibling = new Document({
        id: "subsequent1",
        pageContent: "Configuration section",
        metadata: {
          url: "https://example.com",
          path: ["Guide", "Installation", "Configuration"],
          level: 3,
        },
      });

      vi.spyOn(mockDocumentStore, "findByContent").mockResolvedValue([mainResult]);
      vi.spyOn(mockDocumentStore, "findParentChunk").mockResolvedValue(parent);
      vi.spyOn(mockDocumentStore, "findPrecedingSiblingChunks").mockResolvedValue([
        precedingSibling,
      ]);
      vi.spyOn(mockDocumentStore, "findSubsequentSiblingChunks").mockResolvedValue([
        subsequentSibling,
      ]);
      vi.spyOn(mockDocumentStore, "findChildChunks").mockResolvedValue([child]);

      // Database returns in sort_order
      vi.spyOn(mockDocumentStore, "findChunksByIds").mockResolvedValue([
        parent,
        precedingSibling,
        mainResult,
        child,
        subsequentSibling,
      ]);

      const results = await retrieverService.search(library, version, query);

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

      const markdownChunk = new Document({
        id: "md1",
        pageContent: "# Heading\n\nSome content",
        metadata: {
          url: "https://example.com/doc.md",
          score: 0.9,
          mimeType: "text/markdown",
        },
      });

      vi.spyOn(mockDocumentStore, "findByContent").mockResolvedValue([markdownChunk]);
      vi.spyOn(mockDocumentStore, "findParentChunk").mockResolvedValue(null);
      vi.spyOn(mockDocumentStore, "findPrecedingSiblingChunks").mockResolvedValue([]);
      vi.spyOn(mockDocumentStore, "findChildChunks").mockResolvedValue([]);
      vi.spyOn(mockDocumentStore, "findSubsequentSiblingChunks").mockResolvedValue([]);
      vi.spyOn(mockDocumentStore, "findChunksByIds").mockResolvedValue([markdownChunk]);

      const results = await retrieverService.search(library, version, query);

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

      const codeChunk = new Document({
        id: "ts1",
        pageContent: "function test() {\n  return 'hello';\n}",
        metadata: {
          url: "https://example.com/code.ts",
          score: 0.9,
          mimeType: "text/x-typescript",
        },
      });

      vi.spyOn(mockDocumentStore, "findByContent").mockResolvedValue([codeChunk]);
      // Mock the hierarchical strategy's fallback behavior since we don't have full hierarchy implementation
      vi.spyOn(mockDocumentStore, "findParentChunk").mockResolvedValue(null);
      vi.spyOn(mockDocumentStore, "findChildChunks").mockResolvedValue([]);
      vi.spyOn(mockDocumentStore, "findChunksByIds").mockResolvedValue([codeChunk]);

      const results = await retrieverService.search(library, version, query);

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

      const jsonChunk = new Document({
        id: "json1",
        pageContent: '{"key": "value"}',
        metadata: {
          url: "https://example.com/config.json",
          score: 0.9,
          mimeType: "application/json",
        },
      });

      vi.spyOn(mockDocumentStore, "findByContent").mockResolvedValue([jsonChunk]);
      vi.spyOn(mockDocumentStore, "findParentChunk").mockResolvedValue(null);
      vi.spyOn(mockDocumentStore, "findChildChunks").mockResolvedValue([]);
      vi.spyOn(mockDocumentStore, "findChunksByIds").mockResolvedValue([jsonChunk]);

      const results = await retrieverService.search(library, version, query);

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

      const unknownChunk = new Document({
        id: "unknown1",
        pageContent: "Some content",
        metadata: {
          url: "https://example.com/unknown",
          score: 0.9,
          // No mimeType specified
        },
      });

      vi.spyOn(mockDocumentStore, "findByContent").mockResolvedValue([unknownChunk]);
      vi.spyOn(mockDocumentStore, "findParentChunk").mockResolvedValue(null);
      vi.spyOn(mockDocumentStore, "findPrecedingSiblingChunks").mockResolvedValue([]);
      vi.spyOn(mockDocumentStore, "findChildChunks").mockResolvedValue([]);
      vi.spyOn(mockDocumentStore, "findSubsequentSiblingChunks").mockResolvedValue([]);
      vi.spyOn(mockDocumentStore, "findChunksByIds").mockResolvedValue([unknownChunk]);

      const results = await retrieverService.search(library, version, query);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        url: "https://example.com/unknown",
        content: "Some content", // Should default to markdown strategy
        score: 0.9,
        mimeType: undefined,
      });
    });
  });
});
