import { afterEach, describe, expect, it, vi } from "vitest";
import { VoyageReranker } from "./VoyageReranker";

describe("VoyageReranker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("maps a complete official Voyage response through the Reranker interface", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
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
    );
    vi.stubGlobal("fetch", fetchMock);
    const reranker = new VoyageReranker({
      apiKey: "test-voyage-secret",
      model: "rerank-2.5-lite",
      requestTimeoutMs: 5000,
    });

    const result = await reranker.rerank("exact Search Query", [
      { index: 0, content: "Baseline first" },
      { index: 1, content: "Baseline second" },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.voyageai.com/v1/rerank");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      authorization: "Bearer test-voyage-secret",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      model: "rerank-2.5-lite",
      query: "exact Search Query",
      documents: ["Baseline first", "Baseline second"],
      return_documents: false,
      truncation: false,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({
      scores: [
        { index: 1, score: 0.95 },
        { index: 0, score: 0.25 },
      ],
      usageTokens: 42,
    });
  });

  it.each([
    ["missing result", [{ index: 0, relevance_score: 0.8 }]],
    [
      "duplicate index",
      [
        { index: 0, relevance_score: 0.8 },
        { index: 0, relevance_score: 0.7 },
      ],
    ],
    [
      "extra result",
      [
        { index: 0, relevance_score: 0.8 },
        { index: 1, relevance_score: 0.7 },
        { index: 1, relevance_score: 0.6 },
      ],
    ],
    ["missing index", [{ relevance_score: 0.8 }, { index: 1, relevance_score: 0.7 }]],
    [
      "non-integer index",
      [
        { index: 0.5, relevance_score: 0.8 },
        { index: 1, relevance_score: 0.7 },
      ],
    ],
    [
      "out-of-range index",
      [
        { index: 0, relevance_score: 0.8 },
        { index: 2, relevance_score: 0.7 },
      ],
    ],
    ["missing score", [{ index: 0, relevance_score: 0.8 }, { index: 1 }]],
    [
      "non-finite score",
      [
        { index: 0, relevance_score: 0.8 },
        { index: 1, relevance_score: Number.POSITIVE_INFINITY },
      ],
    ],
  ])("rejects the whole response for %s", async (_caseName, data) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const reranker = new VoyageReranker({
      apiKey: "test-key",
      model: "rerank-2.5-lite",
      requestTimeoutMs: 5000,
    });

    await expect(
      reranker.rerank("query", [
        { index: 0, content: "first" },
        { index: 1, content: "second" },
      ]),
    ).rejects.toThrow("Voyage reranking failed: invalid_response");
  });

  it("aborts the complete provider request at the configured five-second deadline", async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        capturedSignal = init.signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          capturedSignal?.addEventListener("abort", () => {
            reject(new DOMException("request content", "AbortError"));
          });
        });
      }),
    );
    const reranker = new VoyageReranker({
      apiKey: "test-key",
      model: "rerank-2.5-lite",
      requestTimeoutMs: 5000,
    });

    const pendingResult = reranker.rerank("query", [{ index: 0, content: "candidate" }]);
    const rejection = expect(pendingResult).rejects.toThrow(
      "Voyage reranking failed: timeout",
    );
    await vi.advanceTimersByTimeAsync(4999);
    expect(capturedSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await rejection;
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("keeps credentials and request/provider content out of errors and output", async () => {
    const sensitiveText = [
      "test-voyage-secret",
      "private Search Query",
      "private Search Candidate",
      "raw provider response",
    ];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error(sensitiveText.join(" | "))),
    );
    const reranker = new VoyageReranker({
      apiKey: sensitiveText[0],
      model: "rerank-2.5-lite",
      requestTimeoutMs: 5000,
    });

    const error = await reranker
      .rerank(sensitiveText[1], [{ index: 0, content: sensitiveText[2] }])
      .catch((caught: unknown) => caught);
    const serializedOutput = [
      String(error),
      ...consoleError.mock.calls,
      ...consoleWarn.mock.calls,
    ]
      .flat()
      .join(" ");

    expect(String(error)).toBe(
      "VoyageRerankerError: Voyage reranking failed: request_failed",
    );
    for (const value of sensitiveText) {
      expect(serializedOutput).not.toContain(value);
    }
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });
});
