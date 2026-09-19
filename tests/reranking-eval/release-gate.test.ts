import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildModeSummary,
  evaluateReleaseGate,
  loadLockedDataset,
  ObservedForcedFailOpenReranker,
  selectCandidateLimit,
  summarizePageEvidence,
  type QueryMeasurement,
} from "./release-gate";

const query = (
  id: string,
  kind: "lexical" | "semantic",
  rankedFiles: string[],
  candidateFiles = rankedFiles,
): QueryMeasurement => ({
  id,
  kind,
  qrels: [{ file: `${id}.md`, grade: 3 }],
  rankedFiles,
  candidateFiles,
  candidateCount: candidateFiles.length,
  candidatePageCount: new Set(candidateFiles).size,
  returnedPageCount: new Set(rankedFiles).size,
  searchLatencyMs: 100,
  rerankerLatencyMs: 25,
  usageTokens: 10,
  providerFailure: null,
  fallbackCategory: null,
});

describe("ONEC reranking release gate", () => {
  it("derives forced Fail-open evidence from the actual reranker call", async () => {
    const reranker = new ObservedForcedFailOpenReranker();
    const candidates = [
      { index: 0, content: "first", sourceUrl: "https://private.example/a/index.md" },
      { index: 1, content: "second", sourceUrl: "https://private.example/b/index.md" },
    ];

    await expect(reranker.rerank("query", candidates)).rejects.toMatchObject({
      category: "request_failed",
    });

    expect(reranker.observations.get("query")).toEqual({
      failureCategory: "request_failed",
      candidates,
    });
  });

  it("counts page identities without persisting full source URLs", () => {
    expect(
      summarizePageEvidence([
        "https://private.example/a/index.md",
        "https://private.example/b/index.md",
      ]),
    ).toEqual({ files: ["index.md", "index.md"], pageCount: 2 });
  });

  it("accepts only the immutable 40-query ONEC dataset contract", () => {
    const entries = Array.from({ length: 40 }, (_, index) => ({
      id: `Q${String(index + 1).padStart(2, "0")}`,
      kind: index % 2 === 0 ? "lexical" : "semantic",
      query: `query ${index + 1}`,
      qrels: [{ file: `file-${index + 1}.md`, grade: 3 }],
    }));
    const contents = [
      "status: measured",
      "library: ONEC_ERP_IMPLEMENTATION",
      'version: "2026.8.8"',
      "top_k: 5",
      `entries: ${JSON.stringify(entries)}`,
    ].join("\n");
    const hash = createHash("sha256").update(contents).digest("hex");

    expect(loadLockedDataset(contents, hash).entries).toHaveLength(40);

    expect(() => loadLockedDataset(contents, "wrong hash")).toThrow(
      "Dataset SHA-256 does not match the immutable lock",
    );
  });

  it("reports deterministic metrics, intent breakdowns, ranks, and operational totals", () => {
    const measurements = [
      query("Q01", "lexical", ["Q01.md", "other.md"]),
      query("Q30", "semantic", ["other.md", "Q30.md"], ["Q30.md", "other.md"]),
    ];

    const summary = buildModeSummary("rerank-30", measurements, 0.02);

    expect(summary.metrics).toEqual({
      mrr: 0.75,
      recallAt3: 1,
      recallAt5: 1,
      recallAt10: 1,
      recallAt30: 1,
      ndcgAt5: 0.8154648767857288,
      ndcgAt10: 0.8154648767857288,
      hitAt1: 0.5,
      hitAt3: 1,
      hitAt5: 1,
    });
    expect(summary.intents.lexical.count).toBe(1);
    expect(summary.intents.semantic.count).toBe(1);
    expect(summary.queryRanks.Q30).toEqual({ candidateRank: 1, resultRank: 2 });
    expect(summary.candidates).toEqual({ total: 4, uniquePages: 4 });
    expect(summary.returnedPages).toBe(4);
    expect(summary.tokens).toBe(20);
    expect(summary.costUsd).toBeCloseTo(0.0000004, 12);
    expect(summary.latencyMs).toEqual({ min: 100, mean: 100, p50: 100, p95: 100, max: 100 });
    expect(summary.rerankerLatencyMs).toEqual({ min: 25, mean: 25, p50: 25, p95: 25, max: 25 });
    expect(summary.providerFailures).toEqual({ total: 0, byCategory: {} });
    expect(summary.fallbacks).toEqual({ total: 0, byCategory: {} });
  });

  it("keeps 30 unless 50 has a material quality benefit", () => {
    const metrics30 = { mrr: 0.91, ndcgAt5: 0.92, recallAt30: 0.975 };

    expect(
      selectCandidateLimit(metrics30, {
        mrr: 0.915,
        ndcgAt5: 0.929,
        recallAt30: 0.975,
      }),
    ).toEqual({ candidateLimit: 30, reason: "materially_equivalent" });
    expect(
      selectCandidateLimit(metrics30, {
        mrr: 0.921,
        ndcgAt5: 0.92,
        recallAt30: 0.975,
      }),
    ).toEqual({ candidateLimit: 50, reason: "material_quality_benefit" });
  });

  it("fails closed on missing Q30 candidates or unexpected live failures", () => {
    const baseline = buildModeSummary("baseline", [query("Q30", "semantic", ["Q30.md"])], 0.02);
    const rerank30Measurement = query("Q30", "semantic", ["Q30.md"], ["other.md"]);
    rerank30Measurement.providerFailure = "timeout";
    rerank30Measurement.fallbackCategory = "timeout";
    const rerank30 = buildModeSummary("rerank-30", [rerank30Measurement], 0.02);
    const rerank50 = buildModeSummary("rerank-50", [query("Q30", "semantic", ["Q30.md"])], 0.02);
    const failOpenMeasurement = query("Q30", "semantic", ["Q30.md"]);
    failOpenMeasurement.fallbackCategory = "request_failed";
    const failOpen = buildModeSummary("forced-fail-open", [failOpenMeasurement], 0.02);

    const gate = evaluateReleaseGate({ baseline, rerank30, rerank50, failOpen });

    expect(gate.pass).toBe(false);
    expect(gate.checks).toContainEqual({ name: "q30_candidate_present_30", pass: false });
    expect(gate.checks).toContainEqual({ name: "unexpected_provider_failures", pass: false });
    expect(gate.checks).toContainEqual({ name: "forced_fail_open_complete", pass: true });
  });

  it("gates Recall@30 on the selected production configuration", () => {
    const perfect = Array.from({ length: 40 }, (_, index) => {
      const id = `Q${String(index + 1).padStart(2, "0")}`;
      return query(id, index % 2 === 0 ? "lexical" : "semantic", [`${id}.md`]);
    });
    const regressed50 = perfect.map((measurement) => ({
      ...measurement,
      rankedFiles: measurement.id === "Q40" ? [] : measurement.rankedFiles,
    }));
    const forced = perfect.map((measurement) => ({
      ...measurement,
      fallbackCategory: "request_failed",
    }));
    const baseline = buildModeSummary("baseline", perfect, 0.02);
    const rerank30 = buildModeSummary("rerank-30", perfect, 0.02);
    const rerank50 = buildModeSummary("rerank-50", regressed50, 0.02);
    const failOpen = buildModeSummary("forced-fail-open", forced, 0.02);

    const gate = evaluateReleaseGate({ baseline, rerank30, rerank50, failOpen });

    expect(gate.selectedCandidateLimit).toBe(30);
    expect(gate.pass).toBe(true);
  });
});
