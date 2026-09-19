import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../utils/config";
import { loadConfig } from "../utils/config";
import { logger } from "../utils/logger";
import {
  CircuitBreakingReranker,
  RerankerUnavailableError,
} from "./CircuitBreakingReranker";
import { DocumentRetrieverService } from "./DocumentRetrieverService";
import { DocumentStore } from "./DocumentStore";
import type { DbChunkRank, DbPageChunk, StoreSearchResult } from "./types";
import { VoyageReranker } from "./VoyageReranker";

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

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("skips an enabled reranker when Baseline Ranking is empty", async () => {
    const rerank = vi.fn();
    config.search.reranker.enabled = true;
    service = new DocumentRetrieverService(store, config, { rerank });
    vi.spyOn(store, "findByContent").mockResolvedValue([]);

    const results = await service.search("lib", "1.0.0", "query");

    expect(results).toEqual([]);
    expect(rerank).not.toHaveBeenCalled();
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

  it("preserves Baseline Ranking behavior when reranking is disabled", async () => {
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
    const rerank = vi.fn();
    service = new DocumentRetrieverService(store, config, { rerank });

    vi.spyOn(store, "findByContent").mockResolvedValue([initialResult]);
    vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChunksByIds").mockResolvedValue([initialResult]);

    const results = await service.search(library, version, query, limit);

    expect(store.findByContent).toHaveBeenCalledWith(library, version, query, limit);
    expect(rerank).not.toHaveBeenCalled();
    expect(results).toEqual([
      {
        content: "Main chunk",
        url: "url",
        score: 0.5,
      },
    ]);
  });

  it("passes raw search candidates to an enabled reranker before context assembly", async () => {
    const candidate = {
      id: "doc1",
      content: "Raw candidate content",
      url: "https://example.com/doc",
      score: 0.5,
      sort_order: 1,
      metadata: {},
    } as DbPageChunk & DbChunkRank;
    const rerank = vi.fn().mockResolvedValue({
      scores: [{ index: 0, score: 0.9 }],
    });
    config.search.reranker.enabled = true;
    service = new DocumentRetrieverService(store, config, { rerank });

    vi.spyOn(store, "findByContent").mockResolvedValue([candidate]);
    vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChunksByIds").mockResolvedValue([candidate]);

    await service.search("lib", "1.0.0", "exact search query", 3);

    expect(rerank).toHaveBeenCalledWith("exact search query", [
      {
        index: 0,
        content: "Raw candidate content",
        sourceUrl: "https://example.com/doc",
      },
    ]);
  });

  it("returns the exact Baseline Ranking prefix when the reranker fails", async () => {
    const candidates = [
      {
        id: "first",
        content: "Baseline first",
        url: "https://example.com/first",
        score: 0.91,
        sort_order: 1,
        metadata: {},
      },
      {
        id: "second",
        content: "Baseline second",
        url: "https://example.com/second",
        score: 0.73,
        sort_order: 1,
        metadata: {},
      },
      {
        id: "third",
        content: "Outside prefix",
        url: "https://example.com/third",
        score: 0.42,
        sort_order: 1,
        metadata: {},
      },
    ] as (DbPageChunk & DbChunkRank)[];
    const rerank = vi.fn().mockRejectedValue(new Error("raw provider cause"));
    config.search.reranker.enabled = true;
    service = new DocumentRetrieverService(store, config, { rerank });

    vi.spyOn(store, "findByContent").mockResolvedValue(candidates);
    vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChunksByIds").mockImplementation(async (_lib, _ver, ids) =>
      candidates.filter((candidate) => ids.includes(candidate.id)),
    );

    const results = await service.search("lib", "1.0.0", "private query", 2);

    expect(results).toEqual([
      {
        content: "Baseline first",
        url: "https://example.com/first",
        score: 0.91,
        mimeType: undefined,
        sourceMimeType: undefined,
      },
      {
        content: "Baseline second",
        url: "https://example.com/second",
        score: 0.73,
        mimeType: undefined,
        sourceMimeType: undefined,
      },
    ]);
  });

  it.each([400, 401, 403, 429, 500, 502, 503, 504])(
    "uses the exact Baseline Ranking prefix for Voyage HTTP %i",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response("private provider response body", {
            status,
          }),
        ),
      );

      await expectVoyageFailOpen();
    },
  );

  it("uses the exact Baseline Ranking prefix for a Voyage network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new Error("raw cause from https://private-provider.example/internal"),
        ),
    );

    await expectVoyageFailOpen();
  });

  it("uses the exact Baseline Ranking prefix for invalid Voyage JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{private invalid json", { status: 200 })),
    );

    await expectVoyageFailOpen();
  });

  it.each([
    ["missing data", {}],
    ["missing result", { data: [{ index: 0, relevance_score: 0.8 }] }],
    [
      "duplicate index",
      {
        data: [
          { index: 0, relevance_score: 0.8 },
          { index: 0, relevance_score: 0.7 },
          { index: 2, relevance_score: 0.6 },
        ],
      },
    ],
    [
      "extra result",
      {
        data: [
          { index: 0, relevance_score: 0.8 },
          { index: 1, relevance_score: 0.7 },
          { index: 2, relevance_score: 0.6 },
          { index: 2, relevance_score: 0.5 },
        ],
      },
    ],
    [
      "missing index",
      {
        data: [
          { relevance_score: 0.8 },
          { index: 1, relevance_score: 0.7 },
          { index: 2, relevance_score: 0.6 },
        ],
      },
    ],
    [
      "non-integer index",
      {
        data: [
          { index: 0.5, relevance_score: 0.8 },
          { index: 1, relevance_score: 0.7 },
          { index: 2, relevance_score: 0.6 },
        ],
      },
    ],
    [
      "out-of-range index",
      {
        data: [
          { index: 0, relevance_score: 0.8 },
          { index: 1, relevance_score: 0.7 },
          { index: 3, relevance_score: 0.6 },
        ],
      },
    ],
    [
      "missing score",
      {
        data: [
          { index: 0, relevance_score: 0.8 },
          { index: 1 },
          { index: 2, relevance_score: 0.6 },
        ],
      },
    ],
    [
      "non-finite score",
      {
        data: [
          { index: 0, relevance_score: 0.8 },
          { index: 1, relevance_score: Number.POSITIVE_INFINITY },
          { index: 2, relevance_score: 0.6 },
        ],
      },
    ],
  ])(
    "uses the exact Baseline Ranking prefix for Voyage shape: %s",
    async (_name, body) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      );

      await expectVoyageFailOpen();
    },
  );

  it("uses the exact Baseline Ranking prefix after the Voyage deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new DOMException("private timeout cause", "AbortError"));
          });
        });
      }),
    );

    const pendingResults = expectVoyageFailOpen();
    await vi.advanceTimersByTimeAsync(5_000);

    await pendingResults;
  });

  it.each([
    "timeout",
    "request_failed",
    "provider_error",
    "invalid_response",
    "circuit_open",
    "probe_in_progress",
  ] as const)("logs only the sanitized fallback category: %s", async (category) => {
    const candidate = {
      id: "candidate",
      content: "private Search Candidate",
      url: "https://example.com/candidate",
      score: 0.91,
      sort_order: 1,
      metadata: {},
    } as DbPageChunk & DbChunkRank;
    config.search.reranker.enabled = true;
    service = new DocumentRetrieverService(store, config, {
      rerank: vi.fn().mockRejectedValue(new RerankerUnavailableError(category)),
    });
    vi.spyOn(store, "findByContent").mockResolvedValue([candidate]);
    vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChunksByIds").mockResolvedValue([candidate]);

    await service.search("lib", "1.0.0", "private Search Query", 1);

    expectFallbackLogCategory(category);
  });

  it("logs successful usage through the same operational metadata whitelist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { index: 1, relevance_score: 0.95 },
              { index: 0, relevance_score: 0.25 },
            ],
            usage: { total_tokens: 42 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const candidates = [
      {
        id: "first",
        content: "First candidate",
        url: "https://example.com/first",
        score: 0.9,
        sort_order: 1,
        metadata: {},
      },
      {
        id: "second",
        content: "Second candidate",
        url: "https://example.com/second",
        score: 0.8,
        sort_order: 1,
        metadata: {},
      },
    ] as (DbPageChunk & DbChunkRank)[];
    config.search.reranker.enabled = true;
    service = new DocumentRetrieverService(
      store,
      config,
      new CircuitBreakingReranker(
        new VoyageReranker({
          apiKey: "test-voyage-secret",
          model: config.search.reranker.model,
          requestTimeoutMs: 5_000,
        }),
      ),
    );
    vi.spyOn(store, "findByContent").mockResolvedValue(candidates);
    vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChunksByIds").mockImplementation(async (_lib, _ver, ids) =>
      candidates.filter((candidate) => ids.includes(candidate.id)),
    );

    await service.search("lib", "1.0.0", "private Search Query", 2);

    const message = vi
      .mocked(logger.debug)
      .mock.calls.map(([loggedMessage]) => loggedMessage)
      .find((loggedMessage) => loggedMessage.startsWith("Reranker operation "));
    expect(message).toBeDefined();
    if (!message) {
      throw new Error("Missing Reranker operation log");
    }
    const metadata = JSON.parse(message.slice(message.indexOf("{")));
    expect(metadata).toMatchObject({
      provider: "voyage",
      model: "rerank-2.5-lite",
      candidateCount: 2,
      outcome: "success",
      returnedCount: 2,
      usageTokens: 42,
      fallbackCategory: "none",
    });
  });

  it("logs only whitelisted operational metadata for Fail-open Search", async () => {
    const sensitiveValues = [
      "test-voyage-secret",
      "private Search Query",
      "private Search Candidate",
      "private provider response body",
      "raw provider cause",
      "https://private-provider.example/internal",
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error(sensitiveValues.join(" | "))),
    );

    await runVoyageFailure(sensitiveValues[1], sensitiveValues[2]);

    expect(logger.warn).toHaveBeenCalledOnce();
    const message = vi.mocked(logger.warn).mock.calls[0][0];
    for (const sensitiveValue of sensitiveValues) {
      expect(message).not.toContain(sensitiveValue);
    }
    const metadata = JSON.parse(message.slice(message.indexOf("{")));
    expect(Object.keys(metadata)).toEqual([
      "provider",
      "model",
      "candidateCount",
      "elapsedTimeMs",
      "outcome",
      "returnedCount",
      "usageTokens",
      "fallbackCategory",
    ]);
    expect(metadata).toMatchObject({
      provider: "voyage",
      model: "rerank-2.5-lite",
      candidateCount: 3,
      outcome: "fallback",
      returnedCount: 2,
      usageTokens: null,
      fallbackCategory: "request_failed",
    });
    expect(metadata.elapsedTimeMs).toEqual(expect.any(Number));
  });

  it("restores the exact user-limit Baseline Ranking after reranker failure", async () => {
    const widenedCandidate = {
      id: "widened",
      content: "Widened candidate",
      url: "https://example.com/widened",
      score: 0.2,
      sort_order: 1,
      metadata: {},
    } as DbPageChunk & DbChunkRank;
    const baselineCandidate = {
      id: "baseline",
      content: "Baseline candidate",
      url: "https://example.com/baseline",
      score: 0.9,
      sort_order: 1,
      metadata: {},
    } as DbPageChunk & DbChunkRank;
    config.search.reranker.enabled = true;
    service = new DocumentRetrieverService(store, config, {
      rerank: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    });
    vi.spyOn(store, "findByContent").mockImplementation(
      async (_library, _version, _query, searchLimit) =>
        searchLimit === 30 ? [widenedCandidate] : [baselineCandidate],
    );
    vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChunksByIds").mockResolvedValue([baselineCandidate]);

    const results = await service.search("lib", "1.0.0", "private query", 1);

    expect(store.findByContent).toHaveBeenNthCalledWith(
      2,
      "lib",
      "1.0.0",
      "private query",
      1,
    );
    expect(results).toEqual([
      {
        content: "Baseline candidate",
        url: "https://example.com/baseline",
        score: 0.9,
        mimeType: undefined,
        sourceMimeType: undefined,
      },
    ]);
  });

  async function expectVoyageFailOpen(
    query = "private Search Query",
    firstContent = "private Search Candidate",
  ): Promise<void> {
    const results = await runVoyageFailure(query, firstContent);

    expect(results).toEqual([
      {
        content: firstContent,
        url: "https://example.com/baseline-first",
        score: 0.91,
        mimeType: undefined,
        sourceMimeType: undefined,
      },
      {
        content: "Baseline second",
        url: "https://example.com/baseline-second",
        score: 0.73,
        mimeType: undefined,
        sourceMimeType: undefined,
      },
    ]);
  }

  async function runVoyageFailure(
    query: string,
    firstContent: string,
  ): Promise<StoreSearchResult[]> {
    const candidates = [
      {
        id: "baseline-first",
        content: firstContent,
        url: "https://example.com/baseline-first",
        score: 0.91,
        sort_order: 1,
        metadata: {},
      },
      {
        id: "baseline-second",
        content: "Baseline second",
        url: "https://example.com/baseline-second",
        score: 0.73,
        sort_order: 1,
        metadata: {},
      },
      {
        id: "outside-prefix",
        content: "Outside prefix",
        url: "https://example.com/outside-prefix",
        score: 0.42,
        sort_order: 1,
        metadata: {},
      },
    ] as (DbPageChunk & DbChunkRank)[];
    config.search.reranker.enabled = true;
    config.search.reranker.requestTimeoutMs = 5_000;
    service = new DocumentRetrieverService(
      store,
      config,
      new CircuitBreakingReranker(
        new VoyageReranker({
          apiKey: "test-voyage-secret",
          model: config.search.reranker.model,
          requestTimeoutMs: config.search.reranker.requestTimeoutMs,
        }),
      ),
    );
    vi.spyOn(store, "findByContent").mockResolvedValue(candidates);
    vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChunksByIds").mockImplementation(async (_lib, _ver, ids) =>
      candidates.filter((candidate) => ids.includes(candidate.id)),
    );

    return service.search("lib", "1.0.0", query, 2);
  }

  function expectFallbackLogCategory(expectedCategory: string): void {
    expect(logger.warn).toHaveBeenCalledOnce();
    const message = vi.mocked(logger.warn).mock.calls[0][0];
    const metadata = JSON.parse(message.slice(message.indexOf("{")));
    expect(metadata.fallbackCategory).toBe(expectedCategory);
  }

  it("uses the configured candidate limit when it exceeds the user limit", async () => {
    const candidate = {
      id: "doc1",
      content: "Candidate",
      url: "https://example.com/doc",
      score: 0.5,
      sort_order: 1,
      metadata: {},
    } as DbPageChunk & DbChunkRank;
    const rerank = vi.fn().mockResolvedValue({
      scores: [{ index: 0, score: 0.9 }],
    });
    config.search.reranker.enabled = true;
    service = new DocumentRetrieverService(store, config, { rerank });

    vi.spyOn(store, "findByContent").mockResolvedValue([candidate]);
    vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChunksByIds").mockResolvedValue([candidate]);

    await service.search("lib", "1.0.0", "query", 3);

    expect(store.findByContent).toHaveBeenCalledWith("lib", "1.0.0", "query", 30);
  });

  it("does not perform fallback retrieval on a successful rerank", async () => {
    const candidate = {
      id: "doc1",
      content: "Candidate",
      url: "https://example.com/doc",
      score: 0.5,
      sort_order: 1,
      metadata: {},
    } as DbPageChunk & DbChunkRank;
    const rerank = vi.fn().mockResolvedValue({
      scores: [{ index: 0, score: 0.9 }],
    });
    config.search.reranker.enabled = true;
    service = new DocumentRetrieverService(store, config, { rerank });
    vi.spyOn(store, "findByContent")
      .mockResolvedValueOnce([candidate])
      .mockRejectedValueOnce(new Error("fallback retrieval must remain lazy"));
    vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChunksByIds").mockResolvedValue([candidate]);

    await expect(service.search("lib", "1.0.0", "query", 1)).resolves.toEqual([
      expect.objectContaining({ score: 0.9 }),
    ]);
    expect(rerank).toHaveBeenCalledOnce();
    expect(store.findByContent).toHaveBeenCalledOnce();
  });

  it("propagates reranker scores into final ordering after context assembly", async () => {
    const firstCandidate = {
      id: "first",
      content: "Baseline first",
      url: "https://example.com/first",
      score: 0.9,
      sort_order: 1,
      metadata: {},
    } as DbPageChunk & DbChunkRank;
    const secondCandidate = {
      id: "second",
      content: "Reranked first",
      url: "https://example.com/second",
      score: 0.8,
      sort_order: 1,
      metadata: {},
    } as DbPageChunk & DbChunkRank;
    const rerank = vi.fn().mockResolvedValue({
      scores: [
        { index: 0, score: 0.1 },
        { index: 1, score: 0.95 },
      ],
    });
    config.search.reranker.enabled = true;
    service = new DocumentRetrieverService(store, config, { rerank });

    vi.spyOn(store, "findByContent").mockResolvedValue([firstCandidate, secondCandidate]);
    vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChunksByIds").mockImplementation(async (_lib, _ver, ids) =>
      ids.includes("first") ? [firstCandidate] : [secondCandidate],
    );

    const results = await service.search("lib", "1.0.0", "query", 2);

    expect(results).toEqual([
      {
        content: "Reranked first",
        url: "https://example.com/second",
        score: 0.95,
        mimeType: undefined,
        sourceMimeType: undefined,
      },
      {
        content: "Baseline first",
        url: "https://example.com/first",
        score: 0.1,
        mimeType: undefined,
        sourceMimeType: undefined,
      },
    ]);
  });

  it("keeps the maximum reranker score when same-page candidates are assembled", async () => {
    const candidates = [
      {
        id: "first",
        content: "First nearby candidate",
        url: "https://example.com/same-page",
        score: 0.9,
        sort_order: 10,
        metadata: {},
      },
      {
        id: "second",
        content: "Second nearby candidate",
        url: "https://example.com/same-page",
        score: 0.8,
        sort_order: 12,
        metadata: {},
      },
    ] as (DbPageChunk & DbChunkRank)[];
    const rerank = vi.fn().mockResolvedValue({
      scores: [
        { index: 0, score: 0.2 },
        { index: 1, score: 0.95 },
      ],
    });
    config.search.reranker.enabled = true;
    service = new DocumentRetrieverService(store, config, { rerank });

    vi.spyOn(store, "findByContent").mockResolvedValue(candidates);
    vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChunksByIds").mockResolvedValue(candidates);

    const results = await service.search("lib", "1.0.0", "query", 2);

    expect(results).toEqual([
      {
        content: "First nearby candidate\n\nSecond nearby candidate",
        url: "https://example.com/same-page",
        score: 0.95,
        mimeType: undefined,
        sourceMimeType: undefined,
      },
    ]);
  });

  it("does not reduce a user limit above the reranker candidate limit", async () => {
    const candidate = {
      id: "doc1",
      content: "Candidate",
      url: "https://example.com/doc",
      score: 0.5,
      sort_order: 1,
      metadata: {},
    } as DbPageChunk & DbChunkRank;
    const rerank = vi.fn().mockResolvedValue({
      scores: [{ index: 0, score: 0.7 }],
    });
    config.search.reranker.enabled = true;
    service = new DocumentRetrieverService(store, config, { rerank });

    vi.spyOn(store, "findByContent").mockResolvedValue([candidate]);
    vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChunksByIds").mockResolvedValue([candidate]);

    await service.search("lib", "1.0.0", "query", 50);

    expect(store.findByContent).toHaveBeenCalledWith("lib", "1.0.0", "query", 50);
  });

  it("applies the user limit to reranked candidates before context assembly", async () => {
    const candidates = [
      {
        id: "excluded",
        content: "Excluded candidate",
        url: "https://example.com/excluded",
        score: 0.9,
        sort_order: 1,
        metadata: {},
      },
      {
        id: "first",
        content: "First selected candidate",
        url: "https://example.com/first",
        score: 0.8,
        sort_order: 1,
        metadata: {},
      },
      {
        id: "second",
        content: "Second selected candidate",
        url: "https://example.com/second",
        score: 0.7,
        sort_order: 1,
        metadata: {},
      },
    ] as (DbPageChunk & DbChunkRank)[];
    const rerank = vi.fn().mockResolvedValue({
      scores: [
        { index: 0, score: 0.1 },
        { index: 1, score: 0.9 },
        { index: 2, score: 0.8 },
      ],
    });
    config.search.reranker.enabled = true;
    service = new DocumentRetrieverService(store, config, { rerank });

    vi.spyOn(store, "findByContent").mockResolvedValue(candidates);
    vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    const findChunksByIds = vi
      .spyOn(store, "findChunksByIds")
      .mockImplementation(async (_lib, _ver, ids) =>
        candidates.filter((candidate) => ids.includes(candidate.id)),
      );

    const results = await service.search("lib", "1.0.0", "query", 2);

    expect(results.map((result) => result.url)).toEqual([
      "https://example.com/first",
      "https://example.com/second",
    ]);
    expect(findChunksByIds).not.toHaveBeenCalledWith(
      "lib",
      "1.0.0",
      expect.arrayContaining(["excluded"]),
    );
  });

  it("preserves Baseline Ranking when reranker scores are equal", async () => {
    const firstCandidate = {
      id: "first",
      content: "Baseline first",
      url: "https://example.com/first",
      score: 0.9,
      sort_order: 1,
      metadata: {},
    } as DbPageChunk & DbChunkRank;
    const secondCandidate = {
      id: "second",
      content: "Baseline second",
      url: "https://example.com/second",
      score: 0.8,
      sort_order: 1,
      metadata: {},
    } as DbPageChunk & DbChunkRank;
    const rerank = vi.fn().mockResolvedValue({
      scores: [
        { index: 1, score: 0.5 },
        { index: 0, score: 0.5 },
      ],
    });
    config.search.reranker.enabled = true;
    service = new DocumentRetrieverService(store, config, { rerank });

    vi.spyOn(store, "findByContent").mockResolvedValue([firstCandidate, secondCandidate]);
    vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChunksByIds").mockImplementation(async (_lib, _ver, ids) =>
      ids.includes("first") ? [firstCandidate] : [secondCandidate],
    );

    const results = await service.search("lib", "1.0.0", "query", 2);

    expect(results.map((result) => result.url)).toEqual([
      "https://example.com/first",
      "https://example.com/second",
    ]);
  });

  it("preserves Baseline Ranking for equal-score interleaved same-page clusters", async () => {
    const candidates = [
      {
        id: "same-page-later",
        content: "Baseline first",
        url: "https://example.com/same-page",
        score: 0.9,
        sort_order: 100,
        metadata: {},
      },
      {
        id: "other-page",
        content: "Baseline second",
        url: "https://example.com/other-page",
        score: 0.8,
        sort_order: 1,
        metadata: {},
      },
      {
        id: "same-page-earlier",
        content: "Baseline third",
        url: "https://example.com/same-page",
        score: 0.7,
        sort_order: 1,
        metadata: {},
      },
    ] as (DbPageChunk & DbChunkRank)[];
    const rerank = vi.fn().mockResolvedValue({
      scores: [
        { index: 2, score: 0.5 },
        { index: 1, score: 0.5 },
        { index: 0, score: 0.5 },
      ],
    });
    config.search.reranker.enabled = true;
    service = new DocumentRetrieverService(store, config, { rerank });

    vi.spyOn(store, "findByContent").mockResolvedValue(candidates);
    vi.spyOn(store, "findParentChunk").mockResolvedValue(null);
    vi.spyOn(store, "findPrecedingSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChildChunks").mockResolvedValue([]);
    vi.spyOn(store, "findSubsequentSiblingChunks").mockResolvedValue([]);
    vi.spyOn(store, "findChunksByIds").mockImplementation(async (_lib, _ver, ids) =>
      candidates.filter((candidate) => ids.includes(candidate.id)),
    );

    const results = await service.search("lib", "1.0.0", "query", 3);

    expect(results.map((result) => result.content)).toEqual([
      "Baseline first",
      "Baseline second",
      "Baseline third",
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
      source_content_type: mimeType,
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
      sourceMimeType: "text/html",
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
      sourceMimeType: undefined,
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
        source_content_type: "text/markdown",
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
        sourceMimeType: "text/markdown",
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
        source_content_type: "text/x-typescript",
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
        sourceMimeType: "text/x-typescript",
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
        source_content_type: "application/json",
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
        sourceMimeType: "application/json",
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
