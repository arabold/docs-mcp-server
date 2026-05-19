/**
 * Aggregate promptfoo's raw output into the benchmark summary.
 *
 * Input:  tests/search-eval/results/promptfoo-raw.json   (written by promptfoo)
 *         tests/search-eval/results/cross-judge.json     (optional, written by cross-judge.ts)
 * Output: tests/search-eval/results/summary.json
 *
 * Defensive against promptfoo version drift: the raw output's shape has
 * changed across releases, so we look up named scores by metric name first
 * and only fall back to componentResults if needed.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import {
  QUERY_INTENTS,
  type CrossJudgeAgreement,
  type DatasetEntry,
  type PerIntentBreakdown,
  type QueryIntent,
  type RunConfigSnapshot,
  type RunSummary,
} from "./types";
import { loadDataset } from "./loader";
import { normalizeProviderName } from "./providers";

const require = createRequire(import.meta.url);
const { mean } = require("./lib/metrics.cjs") as { mean: (xs: number[]) => number };

const IR_METRIC_KEYS = [
  "mrr",
  "recall_at_3",
  "recall_at_5",
  "recall_at_10",
  "ndcg_at_5",
  "ndcg_at_10",
  "hit_at_1",
  "hit_at_3",
  "hit_at_5",
] as const;

const STRUCTURAL_KEYS = [
  "structural_code_block_balance",
  "structural_non_empty_content",
  "structural_url_presence",
] as const;

const LLM_KEYS = ["chunk_coherence", "content_faithfulness", "answerability"] as const;

interface RawPromptfooResult {
  vars?: Record<string, unknown>;
  namedScores?: Record<string, number>;
  gradingResult?: {
    componentResults?: Array<{
      assertion?: { value?: string; type?: string; metric?: string };
      score?: number;
      pass?: boolean;
    }>;
    namedScores?: Record<string, number>;
  };
}

function loadRaw(rawPath: string): RawPromptfooResult[] {
  const parsed = JSON.parse(readFileSync(rawPath, "utf8"));
  // Promptfoo wraps results under `.results.results` in current versions; older
  // shapes used a flat `.results` array. Accept both.
  const candidate =
    parsed?.results?.results ?? parsed?.results ?? parsed?.evalResults ?? null;
  if (!Array.isArray(candidate)) {
    throw new Error(`Unrecognised promptfoo output shape at ${rawPath}.`);
  }
  return candidate as RawPromptfooResult[];
}

function pickScore(r: RawPromptfooResult, name: string): number | null {
  // Prefer top-level namedScores; fall back to grading namedScores; finally
  // scan componentResults for an assertion labelled with `name`.
  const fromTop = r.namedScores?.[name];
  if (typeof fromTop === "number") return fromTop;

  const fromGrading = r.gradingResult?.namedScores?.[name];
  if (typeof fromGrading === "number") return fromGrading;

  const components = r.gradingResult?.componentResults ?? [];
  for (const c of components) {
    const label = c.assertion?.value ?? "";
    if (label.endsWith(`:${name}`) || label === name || c.assertion?.metric === name) {
      if (typeof c.score === "number") return c.score;
    }
  }
  return null;
}

function intentOf(r: RawPromptfooResult): QueryIntent | null {
  const v = (r.vars?.intent ?? null) as string | null;
  if (v && QUERY_INTENTS.includes(v as QueryIntent)) return v as QueryIntent;
  return null;
}

export interface AggregateOptions {
  rawPath: string;
  datasetPath: string;
  config: RunConfigSnapshot;
  crossJudgePath?: string;
  outputPath: string;
}

export function aggregate(opts: AggregateOptions): RunSummary {
  const raw = loadRaw(opts.rawPath);
  const dataset = loadDataset(opts.datasetPath);

  if (raw.length !== dataset.entries.length) {
    // Soft warning rather than hard fail — a partial promptfoo run can still
    // produce a meaningful summary, but we annotate the gap.
    console.warn(
      `[aggregate] promptfoo emitted ${raw.length} results but dataset has ${dataset.entries.length} entries.`,
    );
  }

  // Headline IR metrics: per-query → dataset-level mean.
  const irMeans: Record<string, number> = {};
  for (const key of IR_METRIC_KEYS) {
    const xs: number[] = [];
    for (const r of raw) {
      const v = pickScore(r, key);
      if (typeof v === "number") xs.push(v);
    }
    irMeans[key] = mean(xs);
  }

  // Per-intent breakdown.
  const perIntent: PerIntentBreakdown[] = [];
  for (const intent of QUERY_INTENTS) {
    const subset = raw.filter((r) => intentOf(r) === intent);
    if (subset.length === 0) continue;
    perIntent.push({
      intent,
      n: subset.length,
      mrr: mean(subset.map((r) => pickScore(r, "mrr") ?? 0)),
      recall_at_5: mean(subset.map((r) => pickScore(r, "recall_at_5") ?? 0)),
      ndcg_at_5: mean(subset.map((r) => pickScore(r, "ndcg_at_5") ?? 0)),
      hit_at_3: mean(subset.map((r) => pickScore(r, "hit_at_3") ?? 0)),
    });
  }

  // Structural pass rates.
  const structuralPassRate: Record<string, number> = {};
  for (const key of STRUCTURAL_KEYS) {
    const xs: number[] = [];
    for (const r of raw) {
      const v = pickScore(r, key);
      if (typeof v === "number") xs.push(v);
    }
    structuralPassRate[key.replace(/^structural_/, "")] = mean(xs);
  }

  // LLM-judged means.
  const llmJudged = LLM_KEYS.map((key) => {
    const xs: number[] = [];
    for (const r of raw) {
      const v = pickScore(r, key);
      if (typeof v === "number") xs.push(v);
    }
    return { metric: key, mean: mean(xs), n: xs.length };
  });

  // Cross-judge agreement (optional).
  const crossJudge: CrossJudgeAgreement[] = opts.crossJudgePath && existsSync(opts.crossJudgePath)
    ? (JSON.parse(readFileSync(opts.crossJudgePath, "utf8")) as CrossJudgeAgreement[])
    : [];

  const summary: RunSummary = {
    config: opts.config,
    ir: {
      mrr: irMeans.mrr,
      recall_at_3: irMeans.recall_at_3,
      recall_at_5: irMeans.recall_at_5,
      recall_at_10: irMeans.recall_at_10,
      ndcg_at_5: irMeans.ndcg_at_5,
      ndcg_at_10: irMeans.ndcg_at_10,
      hit_at_1: irMeans.hit_at_1,
      hit_at_3: irMeans.hit_at_3,
      hit_at_5: irMeans.hit_at_5,
    },
    perIntent,
    structuralPassRate: {
      code_block_balance: structuralPassRate.code_block_balance ?? 0,
      non_empty_content: structuralPassRate.non_empty_content ?? 0,
      url_presence: structuralPassRate.url_presence ?? 0,
    },
    llmJudged,
    crossJudge,
  };

  mkdirSync(dirname(opts.outputPath), { recursive: true });
  writeFileSync(opts.outputPath, JSON.stringify(summary, null, 2));
  return summary;
}

/** CLI entry point used by tests/search-eval/cli/aggregate.ts. */
export async function aggregateCli(): Promise<void> {
  const { loadConfig } = await import("../../src/utils/config");
  const datasetPath = process.env.DOCS_EVAL_DATASET ?? "tests/search-eval/dataset.yaml";
  const rawPath = resolve("tests/search-eval/results/promptfoo-raw.json");
  const crossJudgePath = resolve("tests/search-eval/results/cross-judge.json");
  const outputPath = resolve("tests/search-eval/results/summary.json");
  const dataset = loadDataset(datasetPath);
  const appConfig = loadConfig();

  const config: RunConfigSnapshot = {
    // Mirror run.ts's normalisation: trim whitespace and treat empty as
    // "local", so an explicitly-blank `DOCS_EVAL_PROVIDER=""` env var doesn't
    // produce a snapshot that fails config-compatibility against a normal
    // local baseline.
    provider: normalizeProviderName(process.env.DOCS_EVAL_PROVIDER),
    embeddingModel:
      process.env.DOCS_EVAL_EMBEDDING_MODEL ??
      appConfig.app.embeddingModel ??
      "unknown",
    topK: Number(process.env.DOCS_EVAL_TOP_K ?? 5),
    judge: process.env.DOCS_EVAL_JUDGE_RESOLVED ?? "unknown",
    crossJudge: process.env.DOCS_EVAL_CROSS_JUDGE,
    crossJudgeSampleSize: process.env.DOCS_EVAL_CROSS_JUDGE_N
      ? Number(process.env.DOCS_EVAL_CROSS_JUDGE_N)
      : undefined,
    datasetFile: datasetPath,
    datasetStatus: dataset.status ?? "reviewed",
    datasetEntryCount: dataset.entries.length,
    assembly: {
      childLimit: appConfig.assembly.childLimit,
      precedingSiblingsLimit: appConfig.assembly.precedingSiblingsLimit,
      subsequentSiblingsLimit: appConfig.assembly.subsequentSiblingsLimit,
      maxChunkDistance: appConfig.assembly.maxChunkDistance,
    },
    timestamp: new Date().toISOString(),
  };

  const summary = aggregate({ rawPath, datasetPath, config, crossJudgePath, outputPath });
  console.log(`📊 Wrote summary → ${outputPath}`);
  console.log(
    `   nDCG@5=${summary.ir.ndcg_at_5.toFixed(3)}  MRR=${summary.ir.mrr.toFixed(3)}  Recall@5=${summary.ir.recall_at_5.toFixed(3)}`,
  );
}
