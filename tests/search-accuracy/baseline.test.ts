import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/utils/config";
import {
  type Baseline,
  buildBaseline,
  compareWithBaseline,
  type RunResult,
  type RunSnapshot,
} from "./baseline";
import type { Level, Metrics, Mode, QueryScore } from "./evaluate";
import type { GoldenQuery } from "./golden";

const QUERIES: GoldenQuery[] = ["react", "react", "vite", "vite"].map(
  (library, index) => ({
    id: `${library}-${index}`,
    library,
    query: `query ${index}`,
    intent: "how-to",
    style: "question",
    passages: [{ page: "a.md", text: "answer", grade: 3 }],
  }),
);

/** Scores of a one-passage query whose passage is first found at `rank`. */
function scoreAt(queryId: string, rank: number | null): QueryScore {
  const metrics: Metrics = {
    mrr: rank ? 1 / rank : 0,
    hit_at_1: rank !== null && rank <= 1 ? 1 : 0,
    hit_at_3: rank !== null && rank <= 3 ? 1 : 0,
    hit_at_5: rank !== null && rank <= 5 ? 1 : 0,
    hit_at_10: rank !== null && rank <= 10 ? 1 : 0,
    recall_at_10: rank !== null && rank <= 10 ? 1 : 0,
    ndcg_at_10: rank !== null && rank <= 10 ? 1 / Math.log2(rank + 1) : 0,
  };
  return { queryId, chunkRank: rank, pageRank: rank, chunk: metrics, page: metrics };
}

const SNAPSHOT: RunSnapshot = {
  corpusSha256: "corpus",
  goldenSha256: "golden",
  embeddingModel: "openai:text-embedding-3-small",
  vectorDimension: 1536,
  search: loadConfig().search,
  resultLimit: 10,
};

function run(
  ranks: Partial<Record<Mode, (number | null)[]>>,
  overrides: Partial<RunResult> = {},
): RunResult {
  const queries = overrides.queries ?? QUERIES;
  const modes: RunResult["modes"] = {};
  for (const [mode, modeRanks] of Object.entries(ranks) as [Mode, (number | null)[]][]) {
    const scores = queries.map((query, index) => scoreAt(query.id, modeRanks[index]));
    modes[mode] = {
      status: "scored",
      levels: { store: scores, final: scores } as Record<Level, QueryScore[]>,
    };
  }
  return {
    snapshot: SNAPSHOT,
    queries,
    modes,
    passages: { split: [] },
    embeddingRequests: 0,
    ...overrides,
  };
}

const baselineOf = (result: RunResult): Baseline => buildBaseline(result, null);

describe("compareWithBaseline", () => {
  it("asks for a baseline when there is none", () => {
    expect(compareWithBaseline(run({ fts: [1, 1, 1, 1] }), null).status).toBe(
      "no-baseline",
    );
  });

  it("refuses to compare across a changed golden set", () => {
    const baseline = baselineOf(run({ fts: [1, 1, 1, 1] }));
    const changed = run(
      { fts: [1, 1, 1, 1] },
      { snapshot: { ...SNAPSHOT, goldenSha256: "other" } },
    );

    const comparison = compareWithBaseline(changed, baseline);

    expect(comparison.status).toBe("config-mismatch");
    expect(comparison.mismatches).toEqual(["golden.yaml changed"]);
  });

  it("fails a gated metric that drops by more than 0.02", () => {
    const baseline = baselineOf(run({ hybrid: [1, 1, 1, 1] }));

    const comparison = compareWithBaseline(run({ hybrid: [1, 1, 1, 2] }), baseline);

    expect(comparison.regressions).toContainEqual({
      mode: "hybrid",
      level: "store",
      side: "chunk",
      metric: "mrr",
      baseline: 1,
      current: 0.875,
    });
  });

  it("accepts a drop within the tolerance", () => {
    const many = Array.from({ length: 100 }, (_, index) => ({
      ...QUERIES[0],
      id: `q-${index}`,
    }));
    const baseline = baselineOf(run({ fts: many.map(() => 1) }, { queries: many }));
    const oneWorse = many.map((_, index) => (index === 0 ? 2 : 1));

    const comparison = compareWithBaseline(
      run({ fts: oneWorse }, { queries: many }),
      baseline,
    );

    expect(comparison.regressions).toEqual([]);
    expect(comparison.rankChanges).toContainEqual({
      mode: "fts",
      level: "store",
      queryId: "q-0",
      before: 1,
      after: 2,
    });
  });

  it("compares full-text but not hybrid scores across embedding models", () => {
    const baseline = baselineOf(run({ fts: [1, 1, 1, 1], hybrid: [1, 1, 1, 1] }));
    const otherModel = run(
      { fts: [1, 1, 1, 1], hybrid: [9, 9, 9, 9] },
      { snapshot: { ...SNAPSHOT, embeddingModel: "openai:text-embedding-3-large" } },
    );

    const comparison = compareWithBaseline(otherModel, baseline);

    expect(comparison.regressions).toEqual([]);
    expect(comparison.notCompared.map((entry) => entry.mode)).toEqual(["hybrid"]);
  });

  it("compares a run over some libraries with the same queries of the baseline", () => {
    const baseline = baselineOf(run({ fts: [1, 1, null, null] }));
    const reactOnly = QUERIES.filter((query) => query.library === "react");

    const comparison = compareWithBaseline(
      run({ fts: [1, 1] }, { queries: reactOnly }),
      baseline,
    );

    expect(comparison.regressions).toEqual([]);
    expect(comparison.baselineSummary.fts?.store.chunk.mrr).toBe(1);
  });
});

describe("buildBaseline", () => {
  it("keeps modes the refresh did not score while the configuration is unchanged", () => {
    const previous = baselineOf(run({ fts: [1, 1, 1, 1], hybrid: [2, 2, 2, 2] }));

    const refreshed = buildBaseline(
      run({ fts: [1, 2, 1, 1] }, { snapshot: { ...SNAPSHOT, embeddingModel: null } }),
      previous,
    );

    expect(refreshed.queries.hybrid).toEqual(previous.queries.hybrid);
    expect(refreshed.queries.fts?.store["react-1"].chunkRank).toBe(2);
    expect(refreshed.snapshot.embeddingModel).toBe(SNAPSHOT.embeddingModel);
  });
});
