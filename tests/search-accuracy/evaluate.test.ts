import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/utils/config";
import { aggregate, modeConfig, scoreQuery } from "./evaluate";
import type { GoldenQuery } from "./golden";

const ROOT = "file:///cache/react@abc/src/content";

function query(overrides: Partial<GoldenQuery> = {}): GoldenQuery {
  return {
    id: "react-001",
    library: "react",
    query: "keep a value between renders",
    intent: "how-to",
    style: "question",
    passages: [
      {
        page: "reference/react/useRef.md",
        text: "useRef is a React Hook that lets you reference a value",
        grade: 3,
      },
    ],
    ...overrides,
  };
}

const result = (page: string, content: string) => ({ url: `${ROOT}/${page}`, content });
const answer = result(
  "reference/react/useRef.md",
  "`useRef` is a React Hook that lets you reference a value that's not needed for rendering.",
);

describe("scoreQuery", () => {
  it("is stricter at chunk level than at page level", () => {
    const score = scoreQuery(query(), [
      result("reference/react/useRef.md", "## Parameters"),
      result("learn/state.md", "State is a component's memory."),
      answer,
    ]);

    expect(score.pageRank).toBe(1);
    expect(score.chunkRank).toBe(3);
    expect(score.page.mrr).toBe(1);
    expect(score.chunk.mrr).toBeCloseTo(1 / 3);
    expect(score.chunk.hit_at_1).toBe(0);
    expect(score.chunk.hit_at_3).toBe(1);
  });

  it("does not count the passage on another page", () => {
    const elsewhere = { ...answer, url: `${ROOT}/learn/referencing-values-with-refs.md` };

    expect(scoreQuery(query(), [elsewhere]).chunkRank).toBeNull();
  });

  it("scores a miss as zero", () => {
    const score = scoreQuery(query(), [result("learn/state.md", "unrelated")]);

    expect(score.chunkRank).toBeNull();
    expect(score.chunk).toEqual({
      mrr: 0,
      hit_at_1: 0,
      hit_at_3: 0,
      hit_at_5: 0,
      hit_at_10: 0,
      recall_at_10: 0,
      ndcg_at_10: 0,
    });
  });

  it("ranks a grade 3 passage above a grade 1 passage higher in nDCG", () => {
    const graded = query({
      passages: [
        { page: "a.md", text: "direct answer", grade: 3 },
        { page: "b.md", text: "useful context", grade: 1 },
      ],
    });
    const direct = result("a.md", "the direct answer is here");
    const context = result("b.md", "some useful context");

    const best = scoreQuery(graded, [direct, context]).chunk.ndcg_at_10;
    const reversed = scoreQuery(graded, [context, direct]).chunk.ndcg_at_10;

    expect(best).toBeCloseTo(1);
    expect(reversed).toBeLessThan(best);
  });
});

describe("aggregate", () => {
  it("averages overall and per library, intent and style", () => {
    const hit = query({ id: "react-001" });
    const miss = query({ id: "vite-001", library: "vite", style: "keywords" });
    const scores = [
      scoreQuery(hit, [answer]),
      scoreQuery(miss, [result("learn/state.md", "unrelated")]),
    ];

    const breakdown = aggregate(scores, [hit, miss]);

    expect(breakdown.overall.chunk.mrr).toBe(0.5);
    expect(breakdown.overall.chunkMisses).toBe(1);
    expect(breakdown.byLibrary.react.chunk.mrr).toBe(1);
    expect(breakdown.byLibrary.vite.chunk.mrr).toBe(0);
    expect(breakdown.byStyle.keywords.queries).toBe(1);
    expect(breakdown.byIntent["how-to"].queries).toBe(2);
  });
});

describe("modeConfig", () => {
  const config = loadConfig();

  it("turns vector search off for full-text mode", () => {
    expect(modeConfig("fts", config).app.embeddingModel).toBe("");
  });

  it("ranks by vector alone in vector mode", () => {
    const vector = modeConfig("vector", config);

    expect(vector.search.weightFts).toBe(0);
    expect(vector.search.weightVec).toBe(config.search.weightVec);
  });

  it("leaves hybrid mode and the given configuration unchanged", () => {
    const before = structuredClone(config);

    expect(modeConfig("hybrid", config)).toEqual(config);
    modeConfig("fts", config);
    expect(config).toEqual(before);
  });
});
