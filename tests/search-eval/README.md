# Search Benchmark Internals

This directory holds the search-quality benchmark: the dataset, the baselines,
and the code that runs and scores it. This file explains how the pieces fit
together and how to extend them. To run the benchmark and read its results,
see [docs/guides/benchmarking.md](../../docs/guides/benchmarking.md). The
requirements are in
[openspec/specs/search-evaluation/spec.md](../../openspec/specs/search-evaluation/spec.md).

## How a Run Works

[promptfoo](https://www.promptfoo.dev/) runs the queries and the assertions;
the code here prepares its input and turns its output into the report.
`run.ts` drives the whole run, and every step below starts from it:

1. Check the judge named by `DOCS_EVAL_JUDGE` against the allowlist in
   `judges.ts`, and pick the provider named by `DOCS_EVAL_PROVIDER` from the
   `PROVIDERS` registry in `run.ts`.
2. Load the dataset through `loader.ts`, which validates every entry and the
   library balance.
3. For a provider that reads the local store, run the preflight in
   `preflight.ts`: every library in the dataset must be indexed. A missing
   library stops the run with a `scrape` command template for it.
4. Write the dataset to `results/dataset.flat.yaml`. promptfoo's `tests:`
   field reads only a flat array, while `dataset.yaml` wraps its entries with
   `status` and `notes`.
5. Run `promptfoo eval` on `promptfoo.yaml` at a pinned version through `npx`.
   promptfoo calls the provider's exec script once per query, then applies the
   assertions: `assertions/ir-metrics.cjs`, `assertions/structural.cjs`, and
   three `llm-rubric` assertions that read `rubrics/*.txt`. The judge comes from
   `DOCS_EVAL_JUDGE_RESOLVED`, at temperature 0. promptfoo writes
   `results/promptfoo-raw.json`.
6. When `DOCS_EVAL_CROSS_JUDGE` is set, `cross-judge.ts` picks a fixed sample
   of queries (ranked by a hash of library and query, so the sample is the same
   on every run), re-scores only the LLM rubrics with the second judge, and
   writes `results/cross-judge.json`.
7. `aggregate.ts` reads the raw output and the cross-judge file and writes
   `results/summary.json`: dataset-wide and per-intent means plus a snapshot
   of the run's configuration.
8. `compare.ts` compares the summary with the baseline for this dataset and
   provider, prints the report, and decides the exit code. In baseline mode,
   `run.ts` then writes the summary as the new baseline.

The pieces that do not appear above:

- `lib/metrics.cjs` and `lib/structural.cjs` hold the metric functions. They
  are CommonJS so both promptfoo's JavaScript assertions and the TypeScript
  aggregator can load them.
- `types.ts` holds the shared types and `DEFAULT_TOLERANCES`. `providers.ts`
  holds the list of known provider names and their normalization.
- `rubrics/*.txt` are the rubric texts promptfoo and `cross-judge.ts` read
  (`.txt` because promptfoo rejects `.md` file references). `rubrics.ts` keeps
  TypeScript copies of the same texts; no code imports it.
- `cli/` holds entry points that run one step on its own: `preflight.ts` (the
  `evaluate:search:preflight` script), `aggregate.ts`, `cross-judge.ts`, and
  `compare-providers.ts`, the side-by-side report of two baselines.
- `compare.test.ts` and `context7-provider.test.ts` cover the comparator and
  the Context7 provider. They run in `npm test`.

## Baseline Files

Each dataset and provider pair has its own baseline file, so a smoke run or a
Context7 run never overwrites the main baseline. `baselinePathFor()` in
`run.ts` names them:

| Dataset | Provider | Baseline |
|---|---|---|
| `dataset.yaml` | `local` | `baseline.json` |
| `dataset.yaml` | `context7` | `baseline.context7.json` |
| `dataset.smoke.yaml` | `local` | `dataset.smoke.baseline.json` |
| any other `<name>.yaml` | `<provider>` | `<name>.baseline.json` for `local`, `<name>.<provider>.baseline.json` otherwise |

Only `baseline.json` and `baseline.context7.json` are checked in. A baseline
file holds a full summary, including the configuration snapshot that
`compare.ts` checks before it compares any numbers.

## Providers

A provider is an executable that promptfoo calls once per query, with the
query as arguments followed by two JSON objects of promptfoo bookkeeping. It
prints one JSON line: `output` is the text the LLM judges read, and
`metadata.results` lists each result's `url` and `content` for the IR and
structural assertions. `src/tools/search-provider.ts` defines the contract for
the local provider.

- `local` runs `run-provider.sh`, which starts
  [`src/tools/search-provider.ts`](../../src/tools/search-provider.ts) under
  vite-node. That script opens the store, runs `SearchTool`, and prints the
  JSON line.
- `context7` runs `run-context7-provider.sh`, which starts
  `context7-provider.cjs`. It is plain Node with no store, so it starts fast.
  Its `LIBRARY_MAP` maps each benchmark library to a Context7 library ID, and
  its `normalizeUrl()` rewrites the URLs Context7 returns into the form the
  qrels use (Tailwind's GitHub source paths become `tailwindcss.com/docs`
  pages, and Python's version segment becomes `/3/`). It drops results whose
  URL is only a library's `llms.txt` placeholder.

Both shell scripts run Node from `DOCS_EVAL_NODE`, which `run.ts` sets to the
Node binary it runs on. A shell that promptfoo starts can load a different Node
from the user's profile, and `better-sqlite3` then fails to load. The scripts
also write the provider's output to temporary files rather than capturing it
with `$(...)`, because macOS's bash 3.2 truncates command substitution at
64 KB.

To add a provider:

1. Write an exec script next to the others that prints the same JSON line.
2. Add an entry to `PROVIDERS` in `run.ts`, with `needsPreflight` set when it
   reads the local store.
3. Add its name to `KNOWN_PROVIDER_NAMES` in `providers.ts`.

## Adding a Metric

Every metric name appears in several files: the computation, the assertion
that reports it, the types, the aggregator, and the reports. To find each place,
search for an existing metric of the same kind, for example
`grep -rn recall_at_10 tests/search-eval` for an IR metric,
`grep -rn url_presence tests/search-eval` for a structural check, or
`grep -rn answerability tests/search-eval` for an LLM-judged metric.

An IR metric:

1. Implement it in `lib/metrics.cjs` and add it to the bundle
   `computeIrMetrics()` returns.
2. Add it to the component lists in `assertions/ir-metrics.cjs`.
3. Add it to the metric types in `types.ts` and to `IR_METRIC_KEYS` and the
   summary in `aggregate.ts`.
4. To gate on it, add it to `HEADLINE_IR_KEYS` in `compare.ts`. To gate it per
   intent as well, add it to `PerIntentBreakdown` in `types.ts`, to the
   per-intent breakdown in `aggregate.ts`, and to `PER_INTENT_KEYS` in
   `compare.ts`.
5. Record a new baseline.

A structural check:

1. Add the predicate to `lib/structural.cjs` and call it from
   `runStructuralChecks()`.
2. Report it in `namedScores` and `componentResults` in
   `assertions/structural.cjs`, with the `structural_` prefix.
3. Add it to `STRUCTURAL_KEYS` and the summary in `aggregate.ts`, to the types
   in `types.ts`, and to the structural section of the report in `compare.ts`
   and `cli/compare-providers.ts`.

An LLM-judged metric:

1. Write the rubric in `rubrics/<metric>.txt`, with anchors for scores 1, 3
   and 5, ending with the instruction to return an integer from 1 to 5.
2. Add an `llm-rubric` assertion for it to `promptfoo.yaml`, with its name as
   `metric`.
3. Add it to `LLM_KEYS` in `aggregate.ts`, and to `LLM_METRICS` and the
   assertion list of the promptfoo config `cross-judge.ts` writes.
4. Copy the rubric text into `rubrics.ts`.

## Changing the Dataset

`dataset.yaml` lists queries under `entries`, each with `library`, `query`,
`intent` (`api-lookup`, `conceptual`, `comparison` or `troubleshooting`) and
`qrels`: the relevant page URLs, each with a grade from 1 (supporting) to 3
(the canonical page). The loader rejects an entry with a missing field, an
unknown intent, no qrels, or a grade below 1, and rejects a dataset in which
one library has more than half the queries.

- To add a query, append an entry and record a new baseline. The query count
  is part of the configuration the comparator checks, so the old baseline no
  longer gates.
- To add a library, add its queries (the other libraries have 11 or 12 each),
  index it locally, and add its `scrape` command to
  `.github/workflows/eval.yml` and to the prerequisites in the
  [benchmarking guide](../../docs/guides/benchmarking.md#the-five-benchmark-libraries).
  The workflow's store cache key includes a hash of `dataset.yaml`, so the
  next CI run scrapes again. For a comparison against Context7, add the
  library to `LIBRARY_MAP` in `context7-provider.cjs`.
- A rubric change makes earlier LLM-judged scores incomparable; say so in the
  commit message. IR metrics do not depend on the rubrics.

The dataset's `status` is `draft`, and every run prints a warning about it. The
`notes` block at the top of `dataset.yaml` holds a review checklist; once it is
worked through, set `status: reviewed` and record a new baseline.
`dataset.smoke.yaml` copies five entries from `dataset.yaml` and changes with
it.

## Gotchas

- The `yaml` parser treats `@`, `` ` ``, `&`, `*`, `!` and similar characters
  as reserved at the start of a plain scalar. Quote a query that starts with
  one (`"@apply"`).
- promptfoo's raw output shape differs between versions: the results are under
  `results.results`, `results` or `evalResults`. `loadRaw()` in
  `aggregate.ts` accepts all three; extend it if a new shape appears.
- promptfoo caches provider output by provider, prompt and variables. A
  re-index changes what the provider would return, but promptfoo cannot tell,
  so set `DOCS_EVAL_NO_CACHE=1` for the first run after one.
- The provider returns chunks, and several chunks can come from the same page.
  `lib/metrics.cjs` counts each relevant URL once in Recall and nDCG, so
  repeats of one page cannot push a score above 1. A new graded metric needs
  the same treatment. Before matching, `normalizeUrl()` there drops fragments,
  query strings, trailing slashes, and `.md` or `.html` suffixes on both sides.
- `search-provider.ts` removes every trailing argument that parses as a JSON
  object before it reads the query, not only those with `vars`. Otherwise
  promptfoo's provider config ends up in the query text.
- `cross-judge.ts` stops when the second judge is from the same provider as
  the first, because two judges from one provider agree too closely to measure
  variance. `run.ts` then continues without cross-judge results.
