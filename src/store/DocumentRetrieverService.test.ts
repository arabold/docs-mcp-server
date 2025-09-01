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
});
