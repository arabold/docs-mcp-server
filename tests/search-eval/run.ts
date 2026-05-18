/**
 * Orchestrator for the search-quality benchmark.
 *
 * Modes:
 *   --measure          Run benchmark, compare against baseline. Exit 1 on regression.
 *   --baseline         Run benchmark, overwrite baseline.json with current values.
 *                      Exit 0 even when metrics differ from prior baseline.
 *
 * Environment:
 *   DOCS_EVAL_JUDGE                Override default judge model (validated against allowlist).
 *   DOCS_EVAL_CROSS_JUDGE          Optional secondary judge (different provider).
 *   DOCS_EVAL_CROSS_JUDGE_N        Sample size for cross-judge (default 10).
 *   DOCS_EVAL_DATASET              Override dataset path.
 *   DOCS_EVAL_TOP_K                Override top-k passed to the search provider (default 5).
 *   DOCS_EVAL_EMBEDDING_MODEL      Annotation for the config snapshot (not enforced).
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { loadConfig } from "../../src/utils/config";
import { judgeFromEnv } from "./judges";
import { runPreflight, scrapeCommandFor } from "./preflight";
import { aggregate } from "./aggregate";
import { compare, loadBaseline, renderSummary, writeBaseline } from "./compare";
import { loadDataset } from "./loader";
import type { RunConfigSnapshot } from "./types";

interface Mode {
  measure: boolean;
  baseline: boolean;
}

function parseMode(argv: string[]): Mode {
  return {
    measure: argv.includes("--measure"),
    baseline: argv.includes("--baseline"),
  };
}

const PATHS = {
  evalDir: resolve("tests/search-eval"),
  promptfooConfig: resolve("tests/search-eval/promptfoo.yaml"),
  resultsDir: resolve("tests/search-eval/results"),
  flatDataset: resolve("tests/search-eval/results/dataset.flat.yaml"),
  rawOutput: resolve("tests/search-eval/results/promptfoo-raw.json"),
  summary: resolve("tests/search-eval/results/summary.json"),
  crossJudge: resolve("tests/search-eval/results/cross-judge.json"),
};

/**
 * Each dataset gets its own baseline file, so running smoke in `--baseline`
 * mode doesn't silently overwrite the checked-in main baseline.
 *   dataset.yaml         -> baseline.json
 *   dataset.smoke.yaml   -> baseline.smoke.json
 *   custom/foo.yaml      -> custom/foo.baseline.json   (sits next to dataset)
 */
function baselinePathFor(datasetPath: string): string {
  const ext = datasetPath.endsWith(".yaml")
    ? ".yaml"
    : datasetPath.endsWith(".yml")
      ? ".yml"
      : "";
  const stem = ext ? datasetPath.slice(0, -ext.length) : datasetPath;
  // The canonical main dataset gets the canonical baseline name.
  if (stem.endsWith("/tests/search-eval/dataset") || stem === "tests/search-eval/dataset") {
    return resolve("tests/search-eval/baseline.json");
  }
  // Anything else gets a sibling .baseline.json so multiple datasets coexist.
  return resolve(`${stem}.baseline.json`);
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  if (!mode.measure && !mode.baseline) {
    console.error("Usage: vite-node tests/search-eval/run.ts (--measure | --baseline)");
    process.exit(2);
  }
  if (mode.measure && mode.baseline) {
    console.error("--measure and --baseline are mutually exclusive.");
    process.exit(2);
  }

  // 1. Validate judge (fails fast on deprecated/unknown).
  const judge = judgeFromEnv();
  console.log(`🔧 judge=${judge.id}`);

  // 2. Resolve dataset path.
  const datasetPath = process.env.DOCS_EVAL_DATASET ?? resolve("tests/search-eval/dataset.yaml");
  const dataset = loadDataset(datasetPath);
  if (dataset.status === "draft") {
    console.warn(
      `⚠  dataset status is "draft" — review entries before treating results as a baseline.`,
    );
  }

  // 3. Preflight: every library must be indexed.
  const pf = await runPreflight(datasetPath);
  if (!pf.ok) {
    console.error(`❌ Preflight failed: missing libraries in store:`);
    for (const lib of pf.missing) {
      console.error(`   - ${lib}    →    ${scrapeCommandFor(lib)}`);
    }
    process.exit(1);
  }

  // 4. Emit flat dataset for promptfoo (its `tests:` expects a plain array).
  mkdirSync(PATHS.resultsDir, { recursive: true });
  writeFileSync(
    PATHS.flatDataset,
    stringifyYaml(dataset.entries.map((e) => ({ vars: e }))),
  );

  // 5. Run promptfoo.
  //
  // We pin the Node binary explicitly via DOCS_EVAL_NODE because when promptfoo
  // spawns the bash exec-provider, the child shell re-initialises PATH from
  // /etc/profile and ~/.bashrc — which on machines using nvm typically points
  // at a different Node version than the one running this orchestrator. That
  // caused a 100%-error baseline run with better-sqlite3 ABI mismatches. The
  // exec-provider shim consumes these vars and invokes Node directly.
  const viteNodeCli = resolve("node_modules/vite-node/dist/cli.mjs");
  const env = {
    ...process.env,
    DOCS_EVAL_JUDGE_RESOLVED: judge.id,
    DOCS_EVAL_NODE: process.execPath,
    DOCS_EVAL_VITE_NODE: viteNodeCli,
  };
  // Default concurrency 1: each provider invocation cold-starts vite-node AND
  // re-initialises docService (which runs a schema-migration write through
  // better-sqlite3). Running 4 of those in parallel deadlocks on the write lock.
  // Override with DOCS_EVAL_CONCURRENCY once we move to a long-running provider.
  const concurrency = process.env.DOCS_EVAL_CONCURRENCY ?? "1";
  // Promptfoo caches by (provider id, prompt, vars). When the underlying store
  // changes (re-index, re-scrape, config change), cached provider output is
  // stale even though promptfoo cannot tell. Set DOCS_EVAL_NO_CACHE=1 after a
  // re-index to force fresh provider invocations + fresh judge calls.
  const cacheFlag = process.env.DOCS_EVAL_NO_CACHE === "1" ? ["--no-cache"] : [];
  console.log(
    `▶  Running promptfoo (n=${dataset.entries.length} queries, concurrency=${concurrency}${cacheFlag.length ? ", no-cache" : ""})`,
  );
  const child = spawnSync(
    "npx",
    [
      "-y",
      "promptfoo@0.121.11",
      "eval",
      "-c",
      PATHS.promptfooConfig,
      "-o",
      PATHS.rawOutput,
      "--max-concurrency",
      concurrency,
      ...cacheFlag,
    ],
    { stdio: "inherit", env, cwd: PATHS.evalDir },
  );
  // Promptfoo exit codes:
  //   0   = all assertions passed
  //   100 = eval completed but some assertions failed (expected during a real
  //         benchmark run — that's information, not a crash)
  //   any other non-zero = real failure (crash, config error, etc.)
  // Continue to aggregation on 0 or 100; only bail on real failures.
  if (child.status !== 0 && child.status !== 100) {
    console.error(`promptfoo exited with status ${child.status}`);
    process.exit(child.status ?? 1);
  }

  // 6. Cross-judge sampling (optional, no-op if env unset). Same Node-pinning
  // applies — invoke vite-node CLI through the pinned Node binary rather than
  // through `npx`, which would round-trip PATH and risk picking up the wrong
  // Node version.
  if (process.env.DOCS_EVAL_CROSS_JUDGE) {
    console.log(`▶  Cross-judge sampling (judge=${process.env.DOCS_EVAL_CROSS_JUDGE})`);
    const cj = spawnSync(
      process.execPath,
      [viteNodeCli, resolve("tests/search-eval/cli/cross-judge.ts")],
      { stdio: "inherit", env },
    );
    if (cj.status !== 0) {
      console.error(`cross-judge exited with status ${cj.status} — continuing without it.`);
    }
  }

  // 7. Aggregate.
  // Resolve the embedding model the same way docs-mcp-server itself does, so
  // the recorded baseline captures the configuration actually in use. The env
  // override stays as an escape hatch for cross-config A/Bs.
  const appConfig = loadConfig();
  const resolvedEmbeddingModel =
    process.env.DOCS_EVAL_EMBEDDING_MODEL ??
    appConfig.app.embeddingModel ??
    "unknown";

  const config: RunConfigSnapshot = {
    embeddingModel: resolvedEmbeddingModel,
    topK: Number(process.env.DOCS_EVAL_TOP_K ?? 5),
    judge: judge.id,
    crossJudge: process.env.DOCS_EVAL_CROSS_JUDGE,
    crossJudgeSampleSize: process.env.DOCS_EVAL_CROSS_JUDGE_N
      ? Number(process.env.DOCS_EVAL_CROSS_JUDGE_N)
      : undefined,
    // Record a path relative to cwd so the checked-in baseline doesn't embed
    // the recorder's home directory and stays portable across machines.
    datasetFile: relative(process.cwd(), datasetPath) || datasetPath,
    datasetStatus: dataset.status ?? "reviewed",
    datasetEntryCount: dataset.entries.length,
    // Capture chunking config so baselines recorded under different assembly
    // settings can be told apart (small changes here move recall noticeably).
    assembly: {
      childLimit: appConfig.assembly.childLimit,
      precedingSiblingsLimit: appConfig.assembly.precedingSiblingsLimit,
      subsequentSiblingsLimit: appConfig.assembly.subsequentSiblingsLimit,
      maxChunkDistance: appConfig.assembly.maxChunkDistance,
    },
    timestamp: new Date().toISOString(),
  };
  const summary = aggregate({
    rawPath: PATHS.rawOutput,
    datasetPath,
    config,
    crossJudgePath: PATHS.crossJudge,
    outputPath: PATHS.summary,
  });

  // 8. Compare against baseline.
  const baselinePath = baselinePathFor(datasetPath);
  const baseline = loadBaseline(baselinePath);
  const cmp = compare(summary, baseline);

  // Persist regression report into summary.json so CI/downstream consumers
  // can read it directly without re-running compare().
  summary.regression = {
    hasBaseline: cmp.hasBaseline,
    incompatibilities: cmp.incompatibilities,
    regressions: cmp.regressions,
    improvements: cmp.improvements,
    stable: cmp.stable,
  };
  writeFileSync(PATHS.summary, JSON.stringify(summary, null, 2));

  console.log(renderSummary(summary, cmp));

  // 9. Baseline mode: write and exit. Measure mode: exit on real regression.
  if (mode.baseline) {
    writeBaseline(baselinePath, summary);
    console.log(`💾 Baseline written → ${baselinePath}`);
    return;
  }

  // Only fail on real regressions. Config-incompatible baselines produce no
  // meaningful regression signal; the renderer already surfaced them.
  if (cmp.hasBaseline && cmp.incompatibilities.length === 0 && cmp.regressions.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
