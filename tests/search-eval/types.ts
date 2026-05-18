/**
 * Shared types for the search-quality benchmark.
 *
 * The benchmark spec (openspec/changes/define-search-benchmark) is the source of
 * truth for what these structures must contain. Keep this file in sync when the
 * spec evolves.
 */

export type QueryIntent =
  | "api-lookup"
  | "conceptual"
  | "comparison"
  | "troubleshooting";

export const QUERY_INTENTS: readonly QueryIntent[] = [
  "api-lookup",
  "conceptual",
  "comparison",
  "troubleshooting",
];

export interface Qrel {
  url: string;
  grade: number;
}

export interface DatasetEntry {
  library: string;
  query: string;
  intent: QueryIntent;
  qrels: Qrel[];
}

export interface DatasetFile {
  status?: "draft" | "reviewed";
  notes?: string;
  entries: DatasetEntry[];
}

export interface SearchResultRecord {
  url: string;
  score: number;
  position: number;
  content: string;
}

export interface ProviderMetadata {
  results: SearchResultRecord[];
  library: string;
  query: string;
}

/** Headline IR metrics computed per query. */
export interface IrMetricsPerQuery {
  mrr: number;
  recall_at_3: number;
  recall_at_5: number;
  recall_at_10: number;
  ndcg_at_5: number;
  ndcg_at_10: number;
  hit_at_1: number;
  hit_at_3: number;
  hit_at_5: number;
}

export interface StructuralChecksPerQuery {
  code_block_balance: boolean;
  non_empty_content: boolean;
  url_presence: boolean;
}

export interface LlmJudgeScore {
  metric: string;
  judge: string;
  score: number;
  reason?: string;
}

export interface JudgeAllowlistEntry {
  id: string;
  provider: "openai" | "anthropic" | "google";
  deprecated?: boolean;
}

/**
 * Chunk-assembly parameters that materially affect retrieval quality. Captured
 * in every run snapshot so two baselines can be compared meaningfully — a
 * change to `childLimit` or `maxChunkDistance` can shift recall by tens of
 * points, and a baseline that doesn't record them looks misleadingly
 * comparable across configs.
 */
export interface AssemblyConfigSnapshot {
  childLimit: number;
  precedingSiblingsLimit: number;
  subsequentSiblingsLimit: number;
  maxChunkDistance: number;
}

export interface RunConfigSnapshot {
  embeddingModel: string;
  topK: number;
  judge: string;
  crossJudge?: string;
  crossJudgeSampleSize?: number;
  datasetFile: string;
  datasetStatus: "draft" | "reviewed";
  datasetEntryCount: number;
  assembly: AssemblyConfigSnapshot;
  timestamp: string;
}

export interface PerIntentBreakdown {
  intent: QueryIntent;
  n: number;
  mrr: number;
  recall_at_5: number;
  ndcg_at_5: number;
  hit_at_3: number;
}

export interface CrossJudgeAgreement {
  metric: string;
  sampleSize: number;
  primaryMean: number;
  secondaryMean: number;
  meanAbsoluteDelta: number;
}

export interface RunSummary {
  config: RunConfigSnapshot;
  ir: {
    mrr: number;
    recall_at_3: number;
    recall_at_5: number;
    recall_at_10: number;
    ndcg_at_5: number;
    ndcg_at_10: number;
    hit_at_1: number;
    hit_at_3: number;
    hit_at_5: number;
  };
  perIntent: PerIntentBreakdown[];
  structuralPassRate: {
    code_block_balance: number;
    non_empty_content: number;
    url_presence: number;
  };
  llmJudged: Array<{
    metric: string;
    mean: number;
    n: number;
  }>;
  crossJudge: CrossJudgeAgreement[];
  /**
   * Regression status per metric, populated by the orchestrator after the
   * baseline comparison runs. CI consumers can read this directly from the
   * machine-readable summary without re-running the comparator.
   */
  regression?: RegressionReport;
}

export interface RegressionReport {
  hasBaseline: boolean;
  incompatibilities: string[];
  regressions: RegressionEntry[];
  improvements: RegressionEntry[];
  stable: RegressionEntry[];
}

export interface BaselineFile {
  recordedAt: string | null;
  config: RunConfigSnapshot | null;
  summary: RunSummary | null;
}

export type RegressionStatus = "improved" | "stable" | "regressed";

export interface RegressionEntry {
  metric: string;
  baseline: number;
  current: number;
  relativeDelta: number;
  status: RegressionStatus;
  scope: "headline" | "per-intent";
  scopeKey?: string;
}

export interface ToleranceConfig {
  headlineRelative: number;
  perIntentRelative: number;
}

export const DEFAULT_TOLERANCES: ToleranceConfig = {
  headlineRelative: 0.05,
  perIntentRelative: 0.1,
};
