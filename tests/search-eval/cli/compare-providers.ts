/**
 * Side-by-side comparison report between two recorded baselines.
 *
 * Loads two baseline files (e.g. baseline.json vs baseline.context7.json),
 * prints a comparison table on stdout: IR metrics, per-intent breakdown,
 * LLM-judged scores, structural pass rates.
 *
 * Usage:
 *   vite-node tests/search-eval/cli/compare-providers.ts <baselineA> <baselineB>
 *
 * Both baselines must be recorded against the same dataset for the
 * comparison to be meaningful — otherwise per-query qrels differ. The
 * comparator reports incompatibilities loudly rather than silently mixing.
 */

import { readFileSync, existsSync } from "node:fs";
import { isKnownProvider } from "../providers";
import type { BaselineFile, RunSummary } from "../types";

function loadBaseline(path: string): BaselineFile {
  if (!existsSync(path)) {
    console.error(`baseline not found: ${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8")) as BaselineFile;
}

function fmt(n: number | undefined, w = 6): string {
  if (n === undefined || Number.isNaN(n)) return "  —   ".padStart(w);
  return n.toFixed(3).padStart(w);
}

function deltaTag(a: number, b: number, biggerIsBetter = true): string {
  // Relative delta of B vs A.
  if (a === 0 && b === 0) return "  ·  ";
  if (a === 0) return b > 0 ? " +∞ B" : " -∞ B";
  const d = (b - a) / Math.abs(a);
  const pct = (d * 100).toFixed(0);
  const winner = biggerIsBetter ? (d > 0.01 ? "B" : d < -0.01 ? "A" : "·") : (d < -0.01 ? "B" : d > 0.01 ? "A" : "·");
  const sign = d >= 0 ? "+" : "";
  return `${sign}${pct}% ${winner}`.padStart(8);
}

function row(label: string, a: number | undefined, b: number | undefined): string {
  if (a === undefined || b === undefined) {
    return `  ${label.padEnd(24)} ${fmt(a)}    ${fmt(b)}     n/a`;
  }
  return `  ${label.padEnd(24)} ${fmt(a)}    ${fmt(b)}    ${deltaTag(a, b)}`;
}

function main() {
  const [, , pathA, pathB] = process.argv;
  if (!pathA || !pathB) {
    console.error("Usage: compare-providers.ts <baselineA> <baselineB>");
    process.exit(2);
  }

  const a = loadBaseline(pathA);
  const b = loadBaseline(pathB);
  if (!a.summary || !b.summary) {
    console.error("Both baselines must contain a `summary`. Got:", {
      a: !!a.summary,
      b: !!b.summary,
    });
    process.exit(1);
  }

  // Refuse to compare across dataset/judge/embedding boundaries.
  const incompat: string[] = [];
  for (const k of [
    "datasetFile",
    "datasetEntryCount",
    "embeddingModel",
    "judge",
    "topK",
  ] as const) {
    const av = (a.summary.config as unknown as Record<string, unknown>)[k];
    const bv = (b.summary.config as unknown as Record<string, unknown>)[k];
    if (av !== undefined && bv !== undefined && av !== bv) {
      incompat.push(`${k}: A=${JSON.stringify(av)}  B=${JSON.stringify(bv)}`);
    }
  }

  // Legacy baselines (recorded before the multi-provider work) don't carry a
  // `provider` field. We need a label for the report header, so fall back to
  // the filename — but only when the suffix matches a known provider name,
  // otherwise default to "local". This avoids mislabelling files where the
  // suffix is a dataset variant (e.g. `baseline.smoke.json`) or some other
  // identifier. Both naming forms emitted by `baselinePathFor()` are
  // recognised: `baseline[.<provider>].json` for the canonical dataset and
  // `<stem>[.<provider>].baseline.json` for everything else.
  const inferProvider = (s: RunSummary, path: string): string => {
    if (s.config.provider) return s.config.provider;
    // Form 1: baseline[.<provider>].json
    let m = path.match(/(?:^|\/)baseline(?:\.(\w+))?\.json$/);
    if (m) {
      const candidate = m[1];
      if (candidate && isKnownProvider(candidate)) return candidate;
      return "local";
    }
    // Form 2: <stem>[.<provider>].baseline.json
    m = path.match(/\.(\w+)\.baseline\.json$/);
    if (m && isKnownProvider(m[1])) return m[1];
    return "local";
  };
  const lA = inferProvider(a.summary, pathA);
  const lB = inferProvider(b.summary, pathB);
  console.log("╔══════════════════════════════════════════════════════════════════════════╗");
  console.log(`║  Side-by-side: ${lA.padEnd(20)} vs ${lB.padEnd(20)}                ║`);
  console.log("╚══════════════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log(`A = ${lA}    recorded ${a.summary.config.timestamp}`);
  console.log(`B = ${lB}    recorded ${b.summary.config.timestamp}`);
  console.log(`Dataset: ${a.summary.config.datasetFile} (n=${a.summary.config.datasetEntryCount})`);
  console.log(`Judge:   ${a.summary.config.judge}`);

  if (incompat.length > 0) {
    console.log();
    console.log("⚠  Config differences between A and B — compare with care:");
    for (const m of incompat) console.log(`   ${m}`);
  }

  const printSection = (
    title: string,
    pairs: Array<[string, number | undefined, number | undefined]>,
  ) => {
    console.log();
    console.log(`── ${title} ──`);
    console.log(`  ${"".padEnd(24)} ${"A".padStart(6)}      ${"B".padStart(6)}    Δ (B vs A)`);
    for (const [label, av, bv] of pairs) {
      console.log(row(label, av, bv));
    }
  };

  const irA = a.summary.ir;
  const irB = b.summary.ir;
  printSection("IR metrics (deterministic; higher better)", [
    ["MRR", irA.mrr, irB.mrr],
    ["Recall@3", irA.recall_at_3, irB.recall_at_3],
    ["Recall@5", irA.recall_at_5, irB.recall_at_5],
    ["Recall@10", irA.recall_at_10, irB.recall_at_10],
    ["nDCG@5", irA.ndcg_at_5, irB.ndcg_at_5],
    ["nDCG@10", irA.ndcg_at_10, irB.ndcg_at_10],
    ["Hit@1", irA.hit_at_1, irB.hit_at_1],
    ["Hit@3", irA.hit_at_3, irB.hit_at_3],
    ["Hit@5", irA.hit_at_5, irB.hit_at_5],
  ]);

  const piA = new Map(a.summary.perIntent.map((p) => [p.intent, p]));
  const piB = new Map(b.summary.perIntent.map((p) => [p.intent, p]));
  const intents = Array.from(new Set([...piA.keys(), ...piB.keys()]));
  console.log();
  console.log("── Per-intent MRR ──");
  console.log(`  ${"".padEnd(24)} ${"A".padStart(6)}      ${"B".padStart(6)}    Δ (B vs A)    n`);
  for (const intent of intents) {
    const pa = piA.get(intent);
    const pb = piB.get(intent);
    const n = pa?.n ?? pb?.n ?? "?";
    console.log(`${row(intent, pa?.mrr, pb?.mrr)}    n=${n}`);
  }
  console.log();
  console.log("── Per-intent Recall@5 ──");
  for (const intent of intents) {
    const pa = piA.get(intent);
    const pb = piB.get(intent);
    const n = pa?.n ?? pb?.n ?? "?";
    console.log(`${row(intent, pa?.recall_at_5, pb?.recall_at_5)}    n=${n}`);
  }

  const llmA = new Map(a.summary.llmJudged.map((l) => [l.metric, l]));
  const llmB = new Map(b.summary.llmJudged.map((l) => [l.metric, l]));
  const llmKeys = Array.from(new Set([...llmA.keys(), ...llmB.keys()]));
  printSection(
    "LLM-judged (observational; 1–5; higher better)",
    llmKeys.map((k) => [k, llmA.get(k)?.mean, llmB.get(k)?.mean]),
  );

  const sA = a.summary.structuralPassRate;
  const sB = b.summary.structuralPassRate;
  printSection("Structural pass-rate (deterministic; higher better)", [
    ["code_block_balance", sA.code_block_balance, sB.code_block_balance],
    ["non_empty_content", sA.non_empty_content, sB.non_empty_content],
    ["url_presence", sA.url_presence, sB.url_presence],
  ]);

  // Coarse "winner per metric" summary.
  console.log();
  console.log("── Coarse tally (B is the winner where Δ > 1%) ──");
  let wins: Record<string, number> = { A: 0, B: 0, tied: 0 };
  const allPairs: Array<[string, number, number]> = [
    ...(Object.entries(irA).map(([k, v]) => [`ir.${k}`, v, (irB as Record<string, number>)[k]]) as Array<[string, number, number]>),
    ...llmKeys.map((k): [string, number, number] => [
      `llm.${k}`,
      llmA.get(k)?.mean ?? 0,
      llmB.get(k)?.mean ?? 0,
    ]),
    ...["code_block_balance", "non_empty_content", "url_presence"].map(
      (k): [string, number, number] => [
        `struct.${k}`,
        (sA as Record<string, number>)[k],
        (sB as Record<string, number>)[k],
      ],
    ),
  ];
  for (const [, av, bv] of allPairs) {
    if (av === 0 && bv === 0) wins.tied++;
    else if (av === 0) wins.B++;
    else {
      const d = (bv - av) / Math.abs(av);
      if (d > 0.01) wins.B++;
      else if (d < -0.01) wins.A++;
      else wins.tied++;
    }
  }
  console.log(`  A wins: ${wins.A}    B wins: ${wins.B}    tied: ${wins.tied}    (of ${allPairs.length} metrics)`);
}

main();
