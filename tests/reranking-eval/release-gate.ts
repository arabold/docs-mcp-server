import { createHash } from "node:crypto";
import path from "node:path";
import yaml from "yaml";
import { RerankerUnavailableError } from "../../src/store/CircuitBreakingReranker";
import type { RerankCandidate, Reranker, RerankResult } from "../../src/store/Reranker";

/** Absolute MRR or nDCG@5 gain required to select 50 Search Candidates. */
export const MATERIAL_BENEFIT_ABSOLUTE = 0.01;

export const DETERMINISTIC_METRIC_KEYS = [
  "mrr",
  "recallAt3",
  "recallAt5",
  "recallAt10",
  "recallAt30",
  "ndcgAt5",
  "ndcgAt10",
  "hitAt1",
  "hitAt3",
  "hitAt5",
] as const;

export type EvaluationMode =
  | "baseline"
  | "rerank-30"
  | "rerank-50"
  | "forced-fail-open";

export interface EvaluationQrel {
  file: string;
  grade: number;
}

export interface EvaluationDatasetEntry {
  id: string;
  kind: "lexical" | "semantic";
  query: string;
  qrels: EvaluationQrel[];
}

export interface EvaluationDataset {
  status: string;
  library: "ONEC_ERP_IMPLEMENTATION";
  version: "2026.8.8";
  top_k: 5;
  entries: EvaluationDatasetEntry[];
}

export interface QueryMeasurement {
  id: string;
  kind: "lexical" | "semantic";
  qrels: EvaluationQrel[];
  rankedFiles: string[];
  candidateFiles: string[];
  candidateCount: number;
  candidatePageCount: number;
  returnedPageCount: number;
  searchLatencyMs: number;
  rerankerLatencyMs: number | null;
  usageTokens: number | null;
  providerFailure: string | null;
  fallbackCategory: string | null;
}

export type DeterministicMetrics = Record<
  (typeof DETERMINISTIC_METRIC_KEYS)[number],
  number
>;

export interface ModeSummary {
  mode: EvaluationMode;
  queryCount: number;
  metrics: DeterministicMetrics;
  intents: Record<"lexical" | "semantic", { count: number; metrics: DeterministicMetrics }>;
  queryRanks: Record<string, { candidateRank: number | null; resultRank: number | null }>;
  candidates: { total: number; uniquePages: number };
  returnedPages: number;
  tokens: number;
  costUsd: number;
  latencyMs: LatencyDistribution;
  rerankerLatencyMs: LatencyDistribution | null;
  providerFailures: CategoryCounts;
  fallbacks: CategoryCounts;
  queries: QueryMeasurement[];
}

export interface LatencyDistribution {
  min: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
}

export interface CategoryCounts {
  total: number;
  byCategory: Record<string, number>;
}

export interface GateCheck {
  name: string;
  pass: boolean;
}

export interface ReleaseGateResult {
  pass: boolean;
  selectedCandidateLimit: 30 | 50;
  selectionReason: "materially_equivalent" | "material_quality_benefit";
  checks: GateCheck[];
}

/** Evidence from one forced Reranker failure observed at the production seam. */
export interface ForcedFailOpenObservation {
  failureCategory: "request_failed";
  candidates: readonly RerankCandidate[];
}

/** Forces and records the failure that exercises Search fail-open behavior. */
export class ObservedForcedFailOpenReranker implements Reranker {
  readonly observations = new Map<string, ForcedFailOpenObservation>();

  /**
   * Records the actual Search Candidates and forces a normalized failure.
   * @param query Exact Search Query received from the retrieval service.
   * @param candidates Actual Search Candidates passed by the retrieval service.
   * @returns A rejected promise that activates fail-open behavior.
   */
  async rerank(
    query: string,
    candidates: readonly RerankCandidate[],
  ): Promise<RerankResult> {
    this.observations.set(query, { failureCategory: "request_failed", candidates });
    throw new RerankerUnavailableError("request_failed");
  }
}

const ZERO_METRICS: DeterministicMetrics = {
  mrr: 0,
  recallAt3: 0,
  recallAt5: 0,
  recallAt10: 0,
  recallAt30: 0,
  ndcgAt5: 0,
  ndcgAt10: 0,
  hitAt1: 0,
  hitAt3: 0,
  hitAt5: 0,
};

/**
 * Parses the ONEC dataset only when its bytes and 40-query contract match the lock.
 * @param contents Exact dataset file contents.
 * @param expectedSha256 Immutable expected digest.
 * @returns Validated 40-query evaluation dataset.
 */
export function loadLockedDataset(
  contents: string,
  expectedSha256: string,
): EvaluationDataset {
  const actualSha256 = createHash("sha256").update(contents).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error("Dataset SHA-256 does not match the immutable lock");
  }
  const parsed: unknown = yaml.parse(contents);
  if (!isRecord(parsed)) throw new Error("Dataset must be an object");
  if (
    parsed.library !== "ONEC_ERP_IMPLEMENTATION" ||
    parsed.version !== "2026.8.8" ||
    parsed.top_k !== 5 ||
    !Array.isArray(parsed.entries) ||
    parsed.entries.length !== 40
  ) {
    throw new Error("Dataset does not match the 40-query ONEC contract");
  }
  const entries = parsed.entries.map((entry, index) => parseDatasetEntry(entry, index));
  const expectedIds = entries.map((_, index) => `Q${String(index + 1).padStart(2, "0")}`);
  if (entries.some((entry, index) => entry.id !== expectedIds[index])) {
    throw new Error("Dataset query ids must be the unchanged Q01 through Q40 sequence");
  }
  return {
    status: typeof parsed.status === "string" ? parsed.status : "unknown",
    library: "ONEC_ERP_IMPLEMENTATION",
    version: "2026.8.8",
    top_k: 5,
    entries,
  };
}

/**
 * Builds filename evidence while counting pages by their complete in-memory identity.
 * @param sourceUrls Source URLs observed at the Search or Reranker seam.
 * @param deduplicatePages Whether to retain only the first result for each page.
 * @returns Sanitized filenames and the distinct page count.
 */
export function summarizePageEvidence(
  sourceUrls: readonly string[],
  deduplicatePages = false,
): { files: string[]; pageCount: number } {
  const pageCount = new Set(sourceUrls).size;
  const evidenceUrls = deduplicatePages ? [...new Set(sourceUrls)] : sourceUrls;
  return {
    files: evidenceUrls.map((sourceUrl) => fileFromUrl(sourceUrl)),
    pageCount,
  };
}

/**
 * Builds the deterministic and operational evidence for one evaluation mode.
 * @param mode Evaluated search mode.
 * @param queries Per-query safe measurements.
 * @param pricePerMillionTokensUsd Reranker tariff used for metered cost.
 * @returns Complete mode summary.
 */
export function buildModeSummary(
  mode: EvaluationMode,
  queries: QueryMeasurement[],
  pricePerMillionTokensUsd: number,
): ModeSummary {
  const intents = {
    lexical: queries.filter((query) => query.kind === "lexical"),
    semantic: queries.filter((query) => query.kind === "semantic"),
  };
  const tokens = queries.reduce((sum, query) => sum + (query.usageTokens ?? 0), 0);
  const rerankerLatencies = queries.flatMap((query) =>
    query.rerankerLatencyMs === null ? [] : [query.rerankerLatencyMs],
  );

  return {
    mode,
    queryCount: queries.length,
    metrics: aggregateMetrics(queries),
    intents: {
      lexical: { count: intents.lexical.length, metrics: aggregateMetrics(intents.lexical) },
      semantic: {
        count: intents.semantic.length,
        metrics: aggregateMetrics(intents.semantic),
      },
    },
    queryRanks: Object.fromEntries(
      queries.map((query) => [
        query.id,
        {
          candidateRank: firstRelevantRank(query.candidateFiles, query.qrels),
          resultRank: firstRelevantRank(query.rankedFiles, query.qrels),
        },
      ]),
    ),
    candidates: {
      total: queries.reduce((sum, query) => sum + query.candidateCount, 0),
      uniquePages: queries.reduce((sum, query) => sum + query.candidatePageCount, 0),
    },
    returnedPages: queries.reduce((sum, query) => sum + query.returnedPageCount, 0),
    tokens,
    costUsd: (tokens * pricePerMillionTokensUsd) / 1_000_000,
    latencyMs: latencyDistribution(queries.map((query) => query.searchLatencyMs)),
    rerankerLatencyMs:
      rerankerLatencies.length === 0 ? null : latencyDistribution(rerankerLatencies),
    providerFailures: countCategories(queries.map((query) => query.providerFailure)),
    fallbacks: countCategories(queries.map((query) => query.fallbackCategory)),
    queries,
  };
}

/**
 * Selects 50 only for an absolute one-point quality benefit without Recall loss.
 * @param metrics30 Quality metrics for 30 Search Candidates.
 * @param metrics50 Quality metrics for 50 Search Candidates.
 * @returns Selected limit and deterministic reason.
 */
export function selectCandidateLimit(
  metrics30: Pick<DeterministicMetrics, "mrr" | "ndcgAt5" | "recallAt30">,
  metrics50: Pick<DeterministicMetrics, "mrr" | "ndcgAt5" | "recallAt30">,
): {
  candidateLimit: 30 | 50;
  reason: "materially_equivalent" | "material_quality_benefit";
} {
  const materiallyBetter =
    metrics50.recallAt30 >= metrics30.recallAt30 &&
    (metrics50.mrr - metrics30.mrr >= MATERIAL_BENEFIT_ABSOLUTE ||
      metrics50.ndcgAt5 - metrics30.ndcgAt5 >= MATERIAL_BENEFIT_ABSOLUTE);
  return materiallyBetter
    ? { candidateLimit: 50, reason: "material_quality_benefit" }
    : { candidateLimit: 30, reason: "materially_equivalent" };
}

/**
 * Compares per-query nDCG@5 outcomes against Baseline Ranking.
 * @param baseline Baseline Ranking measurements.
 * @param measured Reranked measurements.
 * @returns Wins, ties, and losses.
 */
export function compareModeOutcomes(
  baseline: ModeSummary,
  measured: ModeSummary,
): { wins: number; ties: number; losses: number } {
  const baselineById = new Map(baseline.queries.map((query) => [query.id, query]));
  let wins = 0;
  let ties = 0;
  let losses = 0;
  for (const query of measured.queries) {
    const baselineQuery = baselineById.get(query.id);
    if (!baselineQuery) continue;
    const delta = queryMetrics(query).ndcgAt5 - queryMetrics(baselineQuery).ndcgAt5;
    if (delta > 1e-12) wins += 1;
    else if (delta < -1e-12) losses += 1;
    else ties += 1;
  }
  return { wins, ties, losses };
}

/**
 * Evaluates every quality, reliability, and forced Fail-open release check.
 * @param input All four required mode summaries.
 * @returns Selected configuration and individual gate results.
 */
export function evaluateReleaseGate(input: {
  baseline: ModeSummary;
  rerank30: ModeSummary;
  rerank50: ModeSummary;
  failOpen: ModeSummary;
}): ReleaseGateResult {
  const selection = selectCandidateLimit(input.rerank30.metrics, input.rerank50.metrics);
  const selected = selection.candidateLimit === 30 ? input.rerank30 : input.rerank50;
  const q30Rank30 = input.rerank30.queryRanks.Q30?.candidateRank ?? null;
  const q30Rank50 = input.rerank50.queryRanks.Q30?.candidateRank ?? null;
  const failOpenMatchesBaseline = equalRankings(input.baseline, input.failOpen);
  const checks: GateCheck[] = [
    { name: "query_count_40", pass: input.baseline.queryCount === 40 },
    {
      name: "unexpected_provider_failures",
      pass:
        input.rerank30.providerFailures.total === 0 &&
        input.rerank50.providerFailures.total === 0,
    },
    {
      name: "unexpected_fallbacks",
      pass: input.rerank30.fallbacks.total === 0 && input.rerank50.fallbacks.total === 0,
    },
    {
      name: "selected_recall_at_30_not_worse",
      pass: selected.metrics.recallAt30 >= input.baseline.metrics.recallAt30,
    },
    { name: "q30_candidate_present_30", pass: q30Rank30 !== null && q30Rank30 <= 30 },
    { name: "q30_candidate_present_50", pass: q30Rank50 !== null && q30Rank50 <= 50 },
    { name: "selected_mrr_at_least_0_90", pass: selected.metrics.mrr >= 0.9 },
    { name: "selected_ndcg_at_5_at_least_0_90", pass: selected.metrics.ndcgAt5 >= 0.9 },
    {
      name: "forced_fail_open_complete",
      pass:
        input.failOpen.fallbacks.total === input.baseline.queryCount &&
        failOpenMatchesBaseline,
    },
  ];
  return {
    pass: checks.every((check) => check.pass),
    selectedCandidateLimit: selection.candidateLimit,
    selectionReason: selection.reason,
    checks,
  };
}

function aggregateMetrics(queries: QueryMeasurement[]): DeterministicMetrics {
  if (queries.length === 0) return { ...ZERO_METRICS };
  const totals = { ...ZERO_METRICS };
  for (const query of queries) {
    const metrics = queryMetrics(query);
    for (const key of DETERMINISTIC_METRIC_KEYS) totals[key] += metrics[key];
  }
  for (const key of DETERMINISTIC_METRIC_KEYS) totals[key] /= queries.length;
  return totals;
}

function queryMetrics(query: QueryMeasurement): DeterministicMetrics {
  const uniqueFiles = [...new Set(query.rankedFiles)];
  const qrelByFile = new Map(query.qrels.map((qrel) => [qrel.file, qrel.grade]));
  const rank = firstRelevantRank(uniqueFiles, query.qrels);
  const recall = (k: number) => {
    const found = new Set(uniqueFiles.slice(0, k).filter((file) => qrelByFile.has(file)));
    return found.size / query.qrels.length;
  };
  const hit = (k: number) => (recall(k) > 0 ? 1 : 0);
  return {
    mrr: rank === null ? 0 : 1 / rank,
    recallAt3: recall(3),
    recallAt5: recall(5),
    recallAt10: recall(10),
    recallAt30: recall(30),
    ndcgAt5: ndcg(uniqueFiles, qrelByFile, 5),
    ndcgAt10: ndcg(uniqueFiles, qrelByFile, 10),
    hitAt1: hit(1),
    hitAt3: hit(3),
    hitAt5: hit(5),
  };
}

function ndcg(files: string[], qrels: Map<string, number>, k: number): number {
  const dcg = files.slice(0, k).reduce((sum, file, index) => {
    const grade = qrels.get(file) ?? 0;
    return sum + (2 ** grade - 1) / Math.log2(index + 2);
  }, 0);
  const ideal = [...qrels.values()]
    .sort((first, second) => second - first)
    .slice(0, k)
    .reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
  return ideal === 0 ? 0 : dcg / ideal;
}

function firstRelevantRank(files: string[], qrels: EvaluationQrel[]): number | null {
  const relevant = new Set(qrels.map((qrel) => qrel.file));
  const index = files.findIndex((file) => relevant.has(file));
  return index === -1 ? null : index + 1;
}

function latencyDistribution(values: number[]): LatencyDistribution {
  const sorted = [...values].sort((first, second) => first - second);
  if (sorted.length === 0) return { min: 0, mean: 0, p50: 0, p95: 0, max: 0 };
  return {
    min: sorted[0],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
  };
}

function percentile(sorted: number[], quantile: number): number {
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

function countCategories(values: Array<string | null>): CategoryCounts {
  const byCategory: Record<string, number> = {};
  for (const value of values) {
    if (value === null) continue;
    byCategory[value] = (byCategory[value] ?? 0) + 1;
  }
  return { total: Object.values(byCategory).reduce((sum, count) => sum + count, 0), byCategory };
}

function equalRankings(first: ModeSummary, second: ModeSummary): boolean {
  const secondById = new Map(second.queries.map((query) => [query.id, query.rankedFiles]));
  return first.queries.every(
    (query) => JSON.stringify(query.rankedFiles) === JSON.stringify(secondById.get(query.id)),
  );
}

function parseDatasetEntry(value: unknown, index: number): EvaluationDatasetEntry {
  if (!isRecord(value)) throw new Error(`Dataset entry ${index + 1} must be an object`);
  if (
    typeof value.id !== "string" ||
    (value.kind !== "lexical" && value.kind !== "semantic") ||
    typeof value.query !== "string" ||
    !Array.isArray(value.qrels) ||
    value.qrels.length === 0
  ) {
    throw new Error(`Dataset entry ${index + 1} is invalid`);
  }
  const qrels = value.qrels.map((qrel, qrelIndex) => {
    if (
      !isRecord(qrel) ||
      typeof qrel.file !== "string" ||
      typeof qrel.grade !== "number" ||
      !Number.isInteger(qrel.grade) ||
      qrel.grade < 1
    ) {
      throw new Error(`Dataset entry ${index + 1} qrel ${qrelIndex + 1} is invalid`);
    }
    return { file: qrel.file, grade: qrel.grade };
  });
  return { id: value.id, kind: value.kind, query: value.query, qrels };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fileFromUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return decodeURIComponent(path.posix.basename(parsed.pathname));
  } catch {
    return decodeURIComponent(path.posix.basename(value.split(/[?#]/, 1)[0]));
  }
}
