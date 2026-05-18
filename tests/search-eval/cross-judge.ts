/**
 * Cross-judge sampling: re-score a deterministic sample of queries with a
 * second-provider judge and report per-metric agreement against the primary
 * judge from the main run.
 *
 * No-op when DOCS_EVAL_CROSS_JUDGE is unset. When set, this script:
 *   1. Picks N entries from the dataset (deterministic, hash-based — same N
 *      sampled across runs so cross-judge results are comparable over time).
 *   2. Writes a temp dataset and a temp promptfoo config that uses the
 *      secondary judge and runs ONLY the LLM-judged rubrics.
 *   3. Execs promptfoo against that config.
 *   4. Loads primary scores for the same N queries from the main raw output.
 *   5. Computes per-metric mean and mean-absolute-delta, writes
 *      `results/cross-judge.json` for the aggregator to fold in.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { stringify as stringifyYaml } from "yaml";
import { createHash } from "node:crypto";
import { loadDataset } from "./loader";
import { resolveJudge } from "./judges";
import type { CrossJudgeAgreement, DatasetEntry } from "./types";

const LLM_METRICS = ["chunk_coherence", "content_faithfulness", "answerability"] as const;
type LlmMetric = (typeof LLM_METRICS)[number];

function stableHash(s: string): number {
  return parseInt(createHash("sha256").update(s).digest("hex").slice(0, 12), 16);
}

/** Deterministic sample: rank entries by hash(library + query), take top N. */
function sample(entries: DatasetEntry[], n: number): DatasetEntry[] {
  return [...entries]
    .map((e) => ({ e, h: stableHash(`${e.library}::${e.query}`) }))
    .sort((a, b) => a.h - b.h)
    .slice(0, n)
    .map((x) => x.e);
}

function scoresByMetric(rawPath: string, metric: string): Map<string, number> {
  const parsed = JSON.parse(readFileSync(rawPath, "utf8"));
  const results =
    parsed?.results?.results ?? parsed?.results ?? parsed?.evalResults ?? [];
  const out = new Map<string, number>();
  for (const r of results) {
    const vars = r.vars ?? {};
    const key = `${vars.library}::${vars.query}`;
    const direct = r.namedScores?.[metric] ?? r.gradingResult?.namedScores?.[metric];
    if (typeof direct === "number") {
      out.set(key, direct);
      continue;
    }
    const components = r.gradingResult?.componentResults ?? [];
    for (const c of components) {
      if (c.assertion?.metric === metric && typeof c.score === "number") {
        out.set(key, c.score);
        break;
      }
    }
  }
  return out;
}

export interface CrossJudgeOptions {
  datasetPath: string;
  mainRawPath: string;
  outputPath: string;
  primaryJudgeId: string;
  secondaryJudgeId: string;
  sampleSize: number;
}

export function runCrossJudge(opts: CrossJudgeOptions): CrossJudgeAgreement[] {
  const primary = resolveJudge(opts.primaryJudgeId);
  const secondary = resolveJudge(opts.secondaryJudgeId);
  // Cross-judging with the same provider yields ~0 deltas and is just
  // expensive — the spec and docs require a second-provider judge for
  // meaningful variance estimation. Fail fast.
  if (primary.provider === secondary.provider) {
    throw new Error(
      `Cross-judge secondary "${secondary.id}" is from the same provider as the primary "${primary.id}" (${primary.provider}). Pick a different provider — e.g. ${primary.provider === "openai" ? "anthropic:claude-sonnet-4-6 or google:gemini-3-flash-preview" : "openai:gpt-5.4-mini"}.`,
    );
  }

  const dataset = loadDataset(opts.datasetPath);
  if (dataset.entries.length === 0) return [];

  const n = Math.min(opts.sampleSize, dataset.entries.length);
  const sampled = sample(dataset.entries, n);

  const resultsDir = resolve(dirname(opts.outputPath));
  mkdirSync(resultsDir, { recursive: true });

  const tempDatasetPath = resolve(resultsDir, "cross-judge-dataset.yaml");
  const tempConfigPath = resolve(resultsDir, "cross-judge.promptfoo.yaml");
  const crossRawPath = resolve(resultsDir, "cross-judge-raw.json");

  writeFileSync(
    tempDatasetPath,
    stringifyYaml(sampled.map((e) => ({ vars: e }))),
  );

  // Minimal config: only LLM-judged rubrics, judge = secondary, same provider.
  const evalDir = resolve("tests/search-eval");
  const config = {
    description: "docs-mcp-server search benchmark (cross-judge sample)",
    prompts: ["{{query}}"],
    providers: [{ id: `exec:${evalDir}/run-provider.sh`, label: "SearchTool" }],
    defaultTest: {
      options: {
        provider: { id: opts.secondaryJudgeId, config: { temperature: 0 } },
      },
      assert: [
        { type: "llm-rubric", value: `file://${evalDir}/rubrics/chunk-coherence.txt`, metric: "chunk_coherence" },
        { type: "llm-rubric", value: `file://${evalDir}/rubrics/content-faithfulness.txt`, metric: "content_faithfulness" },
        { type: "llm-rubric", value: `file://${evalDir}/rubrics/answerability.txt`, metric: "answerability" },
      ],
    },
    tests: tempDatasetPath,
    outputPath: crossRawPath,
  };
  writeFileSync(tempConfigPath, stringifyYaml(config));

  const env = { ...process.env, DOCS_EVAL_JUDGE_RESOLVED: opts.secondaryJudgeId };
  const child = spawnSync(
    "npx",
    ["-y", "promptfoo@0.121.11", "eval", "-c", tempConfigPath],
    { stdio: "inherit", env },
  );
  // Mirror the main runner's treatment of promptfoo exit codes:
  //   0   = all passed
  //   100 = eval completed but some assertions failed (still produces a raw
  //         output we can aggregate — discarding it would throw away signal)
  //   other = real failure (config error, crash, etc.)
  if (child.status !== 0 && child.status !== 100) {
    throw new Error(`cross-judge promptfoo run exited ${child.status}`);
  }

  const agreements: CrossJudgeAgreement[] = [];
  for (const metric of LLM_METRICS) {
    const primary = scoresByMetric(opts.mainRawPath, metric);
    const secondary = scoresByMetric(crossRawPath, metric);
    const deltas: number[] = [];
    const primaries: number[] = [];
    const secondaries: number[] = [];
    for (const e of sampled) {
      const key = `${e.library}::${e.query}`;
      const p = primary.get(key);
      const s = secondary.get(key);
      if (typeof p === "number" && typeof s === "number") {
        primaries.push(p);
        secondaries.push(s);
        deltas.push(Math.abs(p - s));
      }
    }
    agreements.push({
      metric,
      sampleSize: deltas.length,
      primaryMean: mean(primaries),
      secondaryMean: mean(secondaries),
      meanAbsoluteDelta: mean(deltas),
    });
  }

  writeFileSync(opts.outputPath, JSON.stringify(agreements, null, 2));
  return agreements;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** CLI entry point used by tests/search-eval/cli/cross-judge.ts. */
export async function crossJudgeCli(): Promise<void> {
  const secondary = process.env.DOCS_EVAL_CROSS_JUDGE;
  if (!secondary) {
    console.log("[cross-judge] DOCS_EVAL_CROSS_JUDGE unset — skipping.");
    return;
  }
  const n = Number(process.env.DOCS_EVAL_CROSS_JUDGE_N ?? "10");
  if (!Number.isFinite(n) || n <= 0) {
    console.log("[cross-judge] DOCS_EVAL_CROSS_JUDGE_N is non-positive — skipping.");
    return;
  }
  // The primary judge is the one the main run used; run.ts forwards it via
  // DOCS_EVAL_JUDGE_RESOLVED. Fall back to DOCS_EVAL_JUDGE if the resolved
  // form isn't set (e.g. cross-judge invoked standalone for debugging).
  const primary =
    process.env.DOCS_EVAL_JUDGE_RESOLVED ?? process.env.DOCS_EVAL_JUDGE;
  if (!primary) {
    console.error(
      "[cross-judge] DOCS_EVAL_JUDGE_RESOLVED unset — cannot verify the secondary judge uses a different provider.",
    );
    process.exit(1);
  }
  const datasetPath = process.env.DOCS_EVAL_DATASET ?? "tests/search-eval/dataset.yaml";
  const mainRawPath = resolve("tests/search-eval/results/promptfoo-raw.json");
  const outputPath = resolve("tests/search-eval/results/cross-judge.json");
  const agreements = runCrossJudge({
    datasetPath,
    mainRawPath,
    outputPath,
    primaryJudgeId: primary,
    secondaryJudgeId: secondary,
    sampleSize: n,
  });
  for (const a of agreements) {
    console.log(
      `[cross-judge] ${a.metric}: n=${a.sampleSize}  primary=${a.primaryMean.toFixed(2)}  secondary=${a.secondaryMean.toFixed(2)}  |Δ|=${a.meanAbsoluteDelta.toFixed(2)}`,
    );
  }
}
