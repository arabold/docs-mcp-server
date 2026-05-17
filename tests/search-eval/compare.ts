/**
 * Compare a run summary against the checked-in baseline.
 *
 * The measurement run fails (exit code 1) when:
 *   - any headline IR metric drops by more than the headline tolerance, OR
 *   - any per-intent breakdown of an IR metric drops by more than the
 *     per-intent tolerance.
 *
 * LLM-judged metrics, structural pass-rates, and cross-judge agreements
 * are reported but do not gate the run (per design.md Decision 5 +
 * open question: keep LLM scores observational for now).
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import {
  DEFAULT_TOLERANCES,
  type BaselineFile,
  type RegressionEntry,
  type RunSummary,
  type ToleranceConfig,
} from "./types";

const HEADLINE_IR_KEYS = [
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

const PER_INTENT_KEYS = ["mrr", "recall_at_5", "ndcg_at_5", "hit_at_3"] as const;

export interface CompareResult {
  hasBaseline: boolean;
  regressions: RegressionEntry[];
  improvements: RegressionEntry[];
  stable: RegressionEntry[];
}

function relativeDelta(baseline: number, current: number): number {
  if (baseline === 0) {
    if (current === 0) return 0;
    return current > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }
  return (current - baseline) / Math.abs(baseline);
}

function classify(
  baseline: number,
  current: number,
  tolerance: number,
): "improved" | "stable" | "regressed" {
  const d = relativeDelta(baseline, current);
  if (d < -tolerance) return "regressed";
  if (d > tolerance) return "improved";
  return "stable";
}

export function compare(
  summary: RunSummary,
  baseline: BaselineFile,
  tolerances: ToleranceConfig = DEFAULT_TOLERANCES,
): CompareResult {
  const regressions: RegressionEntry[] = [];
  const improvements: RegressionEntry[] = [];
  const stable: RegressionEntry[] = [];

  if (!baseline.summary) {
    return { hasBaseline: false, regressions, improvements, stable };
  }

  // Headline IR metrics.
  for (const key of HEADLINE_IR_KEYS) {
    const b = (baseline.summary.ir as Record<string, number>)[key];
    const c = (summary.ir as Record<string, number>)[key];
    const entry: RegressionEntry = {
      metric: key,
      baseline: b,
      current: c,
      relativeDelta: relativeDelta(b, c),
      status: classify(b, c, tolerances.headlineRelative),
      scope: "headline",
    };
    bucket(entry, regressions, improvements, stable);
  }

  // Per-intent breakdowns: align on intent name.
  const baselineByIntent = new Map(baseline.summary.perIntent.map((p) => [p.intent, p]));
  for (const p of summary.perIntent) {
    const b = baselineByIntent.get(p.intent);
    if (!b) continue; // New intent — nothing to compare.
    for (const key of PER_INTENT_KEYS) {
      const bv = (b as unknown as Record<string, number>)[key];
      const cv = (p as unknown as Record<string, number>)[key];
      const entry: RegressionEntry = {
        metric: key,
        baseline: bv,
        current: cv,
        relativeDelta: relativeDelta(bv, cv),
        status: classify(bv, cv, tolerances.perIntentRelative),
        scope: "per-intent",
        scopeKey: p.intent,
      };
      bucket(entry, regressions, improvements, stable);
    }
  }

  return { hasBaseline: true, regressions, improvements, stable };
}

function bucket(
  entry: RegressionEntry,
  regressions: RegressionEntry[],
  improvements: RegressionEntry[],
  stable: RegressionEntry[],
) {
  if (entry.status === "regressed") regressions.push(entry);
  else if (entry.status === "improved") improvements.push(entry);
  else stable.push(entry);
}

export function loadBaseline(path: string): BaselineFile {
  if (!existsSync(path)) {
    return { recordedAt: null, config: null, summary: null };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<BaselineFile>;
  return {
    recordedAt: parsed.recordedAt ?? null,
    config: parsed.config ?? null,
    summary: parsed.summary ?? null,
  };
}

export function writeBaseline(path: string, summary: RunSummary): void {
  const file: BaselineFile = {
    recordedAt: new Date().toISOString(),
    config: summary.config,
    summary,
  };
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
}

// ── Human-readable rendering ────────────────────────────────────────────────

export function renderSummary(summary: RunSummary, cmp: CompareResult): string {
  const lines: string[] = [];
  const c = summary.config;

  lines.push("=== docs-mcp-server search benchmark ===");
  lines.push(
    `judge=${c.judge}  embedding=${c.embeddingModel}  top_k=${c.topK}  dataset=${c.datasetFile} (${c.datasetStatus}, n=${c.datasetEntryCount})  ts=${c.timestamp}`,
  );
  lines.push("");

  lines.push("─ Headline IR metrics (deterministic) ─");
  lines.push(fmtRow("MRR        ", summary.ir.mrr, baseValue(cmp, "mrr"), "headline"));
  lines.push(fmtRow("Recall@5   ", summary.ir.recall_at_5, baseValue(cmp, "recall_at_5"), "headline"));
  lines.push(fmtRow("nDCG@5     ", summary.ir.ndcg_at_5, baseValue(cmp, "ndcg_at_5"), "headline"));
  lines.push(fmtRow("Hit@3      ", summary.ir.hit_at_3, baseValue(cmp, "hit_at_3"), "headline"));
  lines.push(
    `(also tracked: Recall@3=${summary.ir.recall_at_3.toFixed(3)} Recall@10=${summary.ir.recall_at_10.toFixed(3)} nDCG@10=${summary.ir.ndcg_at_10.toFixed(3)} Hit@1=${summary.ir.hit_at_1.toFixed(3)} Hit@5=${summary.ir.hit_at_5.toFixed(3)})`,
  );
  lines.push("");

  lines.push("─ Per-intent breakdown ─");
  for (const p of summary.perIntent) {
    lines.push(
      `${p.intent.padEnd(16)} n=${String(p.n).padEnd(3)} MRR=${p.mrr.toFixed(3)} R@5=${p.recall_at_5.toFixed(3)} nDCG@5=${p.ndcg_at_5.toFixed(3)} Hit@3=${p.hit_at_3.toFixed(3)}`,
    );
  }
  lines.push("");

  lines.push("─ Structural checks (deterministic, pass rate) ─");
  lines.push(`code_block_balance: ${(summary.structuralPassRate.code_block_balance * 100).toFixed(1)}%`);
  lines.push(`non_empty_content:  ${(summary.structuralPassRate.non_empty_content * 100).toFixed(1)}%`);
  lines.push(`url_presence:       ${(summary.structuralPassRate.url_presence * 100).toFixed(1)}%`);
  lines.push("");

  lines.push("─ LLM-judged (observational, not gating) ─");
  for (const l of summary.llmJudged) {
    lines.push(`${l.metric.padEnd(22)} mean=${l.mean.toFixed(2)}  n=${l.n}`);
  }
  if (summary.crossJudge.length > 0) {
    lines.push("");
    lines.push("─ Cross-judge agreement ─");
    for (const cj of summary.crossJudge) {
      lines.push(
        `${cj.metric.padEnd(22)} n=${cj.sampleSize}  primary=${cj.primaryMean.toFixed(2)}  secondary=${cj.secondaryMean.toFixed(2)}  |Δ|=${cj.meanAbsoluteDelta.toFixed(2)}`,
      );
    }
  }
  lines.push("");

  if (!cmp.hasBaseline) {
    lines.push("⚠  No baseline found. Run `npm run evaluate:search:baseline` to record one.");
  } else if (cmp.regressions.length > 0) {
    lines.push("❌ Regressions:");
    for (const r of cmp.regressions) {
      const scope = r.scope === "per-intent" ? ` (${r.scopeKey})` : "";
      lines.push(
        `   ${r.metric}${scope}: ${r.baseline.toFixed(3)} → ${r.current.toFixed(3)}  (${(r.relativeDelta * 100).toFixed(1)}%)`,
      );
    }
  } else {
    lines.push(`✅ No regressions. ${cmp.improvements.length} improved, ${cmp.stable.length} stable.`);
  }

  return lines.join("\n");
}

function baseValue(cmp: CompareResult, metric: string): number | undefined {
  if (!cmp.hasBaseline) return undefined;
  const all = [...cmp.regressions, ...cmp.improvements, ...cmp.stable];
  return all.find((e) => e.scope === "headline" && e.metric === metric)?.baseline;
}

function fmtRow(label: string, current: number, baseline: number | undefined, _scope: string): string {
  if (baseline === undefined) return `${label} ${current.toFixed(3)}`;
  const d = baseline === 0 ? 0 : (current - baseline) / Math.abs(baseline);
  const arrow = d > 0.001 ? "▲" : d < -0.001 ? "▼" : "·";
  return `${label} ${current.toFixed(3)}  (baseline ${baseline.toFixed(3)}, ${(d * 100).toFixed(1)}% ${arrow})`;
}
