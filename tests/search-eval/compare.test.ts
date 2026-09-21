/**
 * Tests for the baseline comparator's compatibility guard.
 *
 * The guard exists to stop a mismatched baseline producing false regressions.
 * Its failure mode is the opposite and quieter: when it reports a difference
 * that is not one, it disables regression checking entirely and every
 * subsequent run passes without ever comparing a number. That happened in
 * practice — the embedding model spec gained its canonical `openai:` prefix
 * once the resolver started reporting it, and the gate went inert against a
 * baseline recorded before the change.
 */

import { describe, expect, it } from "vitest";
import { compare } from "./compare";
import type { BaselineFile, RunSummary } from "./types";

/** A config snapshot with the fields the compatibility guard inspects. */
function config(overrides: Record<string, unknown> = {}) {
  return {
    provider: "local",
    embeddingModel: "openai:text-embedding-3-small",
    topK: 5,
    judge: "openai:gpt-5.4-mini",
    datasetFile: "tests/search-eval/dataset.yaml",
    datasetStatus: "draft",
    datasetEntryCount: 59,
    assembly: {
      childLimit: 3,
      precedingSiblingsLimit: 1,
      subsequentSiblingsLimit: 2,
      maxChunkDistance: 3,
    },
    timestamp: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

const IR = {
  mrr: 0.75,
  recall_at_3: 0.66,
  recall_at_5: 0.72,
  recall_at_10: 0.72,
  ndcg_at_5: 0.7,
  ndcg_at_10: 0.7,
  hit_at_1: 0.69,
  hit_at_3: 0.81,
  hit_at_5: 0.85,
};

function summary(overrides: Record<string, unknown> = {}): RunSummary {
  return {
    config: config(overrides.config as Record<string, unknown> | undefined),
    ir: { ...IR, ...((overrides.ir as Record<string, number>) ?? {}) },
    perIntent: [],
    structuralPassRate: {
      code_block_balance: 1,
      non_empty_content: 1,
      url_presence: 1,
    },
    llmJudged: [],
    crossJudge: null,
    regression: null,
  } as unknown as RunSummary;
}

function baseline(overrides: Record<string, unknown> = {}): BaselineFile {
  return {
    recordedAt: "2026-05-19T00:00:00.000Z",
    config: config(overrides.config as Record<string, unknown> | undefined),
    summary: summary(overrides),
  } as unknown as BaselineFile;
}

describe("compare — embedding model compatibility", () => {
  it("treats a bare model name and its prefixed form as the same model", () => {
    // The regression that made this test necessary: same model, two spellings.
    const base = baseline({ config: { embeddingModel: "text-embedding-3-small" } });
    const run = summary({ config: { embeddingModel: "openai:text-embedding-3-small" } });

    const result = compare(run, base);

    expect(result.incompatibilities).toEqual([]);
  });

  it("still reports a genuinely different embedding model", () => {
    const base = baseline({ config: { embeddingModel: "openai:text-embedding-3-small" } });
    const run = summary({ config: { embeddingModel: "openai:text-embedding-3-large" } });

    const result = compare(run, base);

    expect(result.incompatibilities).toHaveLength(1);
    expect(result.incompatibilities[0]).toContain("embeddingModel");
  });

  it("reports a different provider prefix on the same model name", () => {
    // `gemini:` and `openai:` resolve to different services; the model name
    // matching is irrelevant.
    const base = baseline({ config: { embeddingModel: "openai:embedding-001" } });
    const run = summary({ config: { embeddingModel: "gemini:embedding-001" } });

    const result = compare(run, base);

    expect(result.incompatibilities).toHaveLength(1);
  });

  it("classifies regressions once the configs are compatible", () => {
    // The point of fixing the guard: a real drop has to be caught, not skipped.
    const base = baseline({ config: { embeddingModel: "text-embedding-3-small" } });
    const run = summary({
      config: { embeddingModel: "openai:text-embedding-3-small" },
      ir: { mrr: 0.5 },
    });

    const result = compare(run, base);

    expect(result.incompatibilities).toEqual([]);
    expect(result.regressions.map((r) => r.metric)).toContain("mrr");
  });

  it("does not treat a baseline without the field as a mismatch", () => {
    const base = baseline();
    // biome-ignore lint/performance/noDelete: modelling a legacy baseline shape
    delete (base.summary?.config as unknown as Record<string, unknown>).embeddingModel;
    const run = summary();

    const result = compare(run, base);

    expect(result.incompatibilities).toEqual([]);
  });
});
