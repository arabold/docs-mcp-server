# Search-quality benchmark — developer internals

This is the dev-facing reference for the code in this directory. For the
operator-facing guide (prerequisites, how to run, how to read results) see
**[docs/guides/benchmarking.md](../../docs/guides/benchmarking.md)**. For the
authoritative spec see
[openspec/changes/define-search-benchmark/specs/search-evaluation/spec.md](../../openspec/changes/define-search-benchmark/specs/search-evaluation/spec.md).

## File layout

```
tests/search-eval/
  dataset.yaml             # Source-of-truth dataset (wrapped form with status/notes).
  baseline.json            # Checked-in baseline for the main dataset.
                           # Each dataset writes its own baseline (e.g.
                           # dataset.smoke.yaml -> dataset.smoke.baseline.json).
  promptfoo.yaml           # Promptfoo config. Run via run.ts, never directly.
  run-provider.sh          # Promptfoo exec-provider wrapper around search-provider.ts.

  types.ts                 # Shared TypeScript types.
  loader.ts                # Dataset loader + spec-constraint validator.
  preflight.ts             # `npm run evaluate:search:preflight` — libraries indexed?
  judges.ts                # Judge allowlist; rejects deprecated models at startup.
  rubrics.ts               # TS copies of the rubric strings (rubrics/*.txt is canonical).
  aggregate.ts             # promptfoo raw → summary.json.
  compare.ts               # summary vs baseline; renders human-readable report.
  cross-judge.ts           # Optional secondary-judge sampling for variance estimation.
  run.ts                   # Orchestrator: preflight → promptfoo → cross-judge → aggregate → compare.

  lib/
    metrics.cjs            # IR metrics (MRR, Recall@k, nDCG@k, Hit@k). CJS so both
                           # promptfoo JS assertions AND TS aggregator can require it.
    structural.cjs         # Deterministic structural checks.
  assertions/
    ir-metrics.cjs         # Promptfoo assertion: emits IR metric bundle per query.
    structural.cjs         # Promptfoo assertion: structural pass-rate.
  rubrics/
    chunk-coherence.txt    # The three LLM rubrics. Canonical copies live here;
    content-faithfulness.txt # rubrics.ts mirrors them for in-process use.
    answerability.txt      # (.txt because promptfoo rejects .md file refs.)
  results/                 # Gitignored. Per-run output: promptfoo-raw.json,
                           # summary.json, cross-judge.json, dataset.flat.yaml.
```

## How the pieces fit together

1. `run.ts` validates `DOCS_EVAL_JUDGE` against `judges.ts` (fails fast on
   deprecated/unknown).
2. `preflight.ts` checks every library named in `dataset.yaml` is indexed in the
   local store; on failure, prints the exact scrape command needed.
3. `run.ts` emits a flat-array copy of the dataset to
   `results/dataset.flat.yaml` (promptfoo's `tests:` field can only consume a
   flat array; the wrapped source-of-truth form supports `status`/`notes`).
4. `run.ts` execs `promptfoo eval -c promptfoo.yaml -o results/promptfoo-raw.json`.
   Promptfoo runs each query through `run-provider.sh` → `search-provider.ts`,
   then evaluates the assertion stack: `assertions/ir-metrics.cjs`,
   `assertions/structural.cjs`, three `llm-rubric` assertions reading the
   `rubrics/*.txt` prompts. All judge calls use the env-templated
   `{{env.DOCS_EVAL_JUDGE_RESOLVED}}` provider at `temperature: 0`.
5. If `DOCS_EVAL_CROSS_JUDGE` is set, `cross-judge.ts` deterministically samples
   N queries (hash-based, stable across runs), re-runs promptfoo with the
   secondary judge on just those queries, and writes
   `results/cross-judge.json` with per-metric mean-absolute-delta.
6. `aggregate.ts` reads the raw promptfoo output + cross-judge file and writes
   `results/summary.json` containing dataset-level + per-intent aggregates plus
   the config snapshot.
7. `compare.ts` loads `baseline.json`, diffs against the new summary, prints
   the human-readable report, and exits 1 if any headline IR metric regressed
   beyond tolerance (5% relative headline / 10% relative per-intent).

## Adding a new metric

### A new IR metric

1. Add the implementation to [lib/metrics.cjs](lib/metrics.cjs) and the
   `computeIrMetrics` bundle.
2. Add it to `IR_METRIC_KEYS` in [aggregate.ts](aggregate.ts) so it's averaged
   into the summary.
3. Add it to the headline keys / per-intent keys in [compare.ts](compare.ts) if
   it should gate regressions.
4. Refresh the baseline.

### A new structural check

1. Add the predicate to [lib/structural.cjs](lib/structural.cjs) and to the
   `runStructuralChecks` aggregator.
2. Add it to the `namedScores` and `componentResults` in
   [assertions/structural.cjs](assertions/structural.cjs).
3. Surface the pass-rate in the structural section of
   [aggregate.ts](aggregate.ts) and [compare.ts](compare.ts).

### A new LLM-judged metric

1. Write the rubric in `rubrics/<metric>.txt` with anchors for scores 1, 3, and 5.
2. Add a sibling `llm-rubric` assertion in [promptfoo.yaml](promptfoo.yaml)
   pointing at the new rubric.
3. Add the metric name to `LLM_KEYS` in [aggregate.ts](aggregate.ts) and to
   `LLM_METRICS` in [cross-judge.ts](cross-judge.ts).
4. Mirror the rubric string in [rubrics.ts](rubrics.ts) for in-process use.

## When to update the dataset

- **Adding a query.** Append an entry to `dataset.yaml`. The loader enforces the
  ≤50% per-library cap and intent-tag enum on every run, so a bad addition
  fails preflight rather than silently skewing results.
- **Adding a library.** Append ≥5 queries; add a scrape command to
  `.github/workflows/eval.yml`; bump the cache key in that workflow.
- **Changing rubrics.** Note this in the commit message — prior baselines'
  LLM-judged scores become non-comparable. IR metrics survive rubric changes
  unchanged.

## Common gotchas

- **`yaml` library and reserved characters.** YAML treats `@`, `` ` ``, `&`,
  `*`, `!`, etc. as reserved at the start of a plain scalar. Query strings
  beginning with one of those (`@apply`, etc.) must be quoted in `dataset.yaml`.
- **Promptfoo output shape drift.** Across promptfoo versions, the raw output
  has alternated between `results: [...]`, `results.results: [...]`, and
  `evalResults: [...]`. [aggregate.ts](aggregate.ts) probes all three. If
  promptfoo introduces a fourth shape, extend `loadRaw()` rather than
  assuming the current one.
- **Cross-judge requires a *different* provider for meaningful signal.** Setting
  `DOCS_EVAL_CROSS_JUDGE` to a sibling of the primary judge (e.g. both OpenAI)
  yields near-zero deltas and is just expensive — pick a different provider.
- **Node 22.** `better-sqlite3` is ABI-pinned. Preflight (which opens the
  store) fails on Node 24+.
- **Stale cache after a re-index.** Promptfoo caches provider output by
  `(provider id, prompt, vars)`. After a re-scrape / re-index the underlying
  store changes but promptfoo doesn't know — set `DOCS_EVAL_NO_CACHE=1` once
  after a re-index, then resume normal cached runs.
- **`recall@k` deduplicates returned URLs.** The provider returns chunks, and
  multiple chunks can come from the same canonical page. Standard IR Recall
  counts each relevant URL at most once; counting raw chunk hits would push
  Recall above 1.0 when the top-k is dominated by repeats of the same page.
  [`lib/metrics.cjs`](lib/metrics.cjs) does the dedupe; if you add another
  graded metric, follow the same pattern.
- **Argv parsing strips promptfoo's bookkeeping JSON.** Promptfoo invokes
  the exec-provider with trailing JSON args (provider config + test context).
  [`search-provider.ts`](../../src/tools/search-provider.ts)'s argv parser
  pops *every* trailing JSON object (not only ones with `vars`/`options`) —
  otherwise the provider-config blob ends up tacked onto the query string.
