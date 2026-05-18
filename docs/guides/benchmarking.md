# Search Quality Benchmark

`docs-mcp-server` ships with a retrieval-quality benchmark that measures how well
`SearchTool` returns relevant chunks for natural-language queries. It is the
authoritative way to detect regressions when changing the embedding model,
chunking strategy, or ranking logic, and to compare this server against alternative
retrieval techniques.

This guide is the operator-facing entry point. For the detailed spec see
[openspec/changes/define-search-benchmark/specs/search-evaluation/spec.md](../../openspec/changes/define-search-benchmark/specs/search-evaluation/spec.md);
for developer internals (file layout, how to add a metric) see
[tests/search-eval/README.md](../../tests/search-eval/README.md).

## What it measures

**Headline (deterministic, gate regressions):**

| Metric | Question it answers |
|---|---|
| MRR | How high in the result list is the *first* relevant doc? |
| Recall@{3,5,10} | What fraction of the relevant docs did we find in the top-k? |
| nDCG@{5,10} | Did we rank the most relevant docs above the less-relevant ones? |
| Hit@{1,3,5} | Did we return *any* relevant doc in the top-k? |

**Observational (reported, do not gate):**

| Metric | Question it answers |
|---|---|
| Structural pass-rates | Are code blocks balanced? Is every chunk non-empty and URL'd? |
| Chunk coherence (LLM-judged) | Is each chunk a self-contained readable unit? |
| Content faithfulness (LLM-judged) | Do chunks faithfully reflect their source page? |
| Answerability (LLM-judged) | Could a downstream LLM answer the query from these chunks alone? |

Scope is **retrieval-only**. End-to-end RAG generation (running an LLM over the
retrieved chunks and judging the answer) is intentionally out of scope.

## Prerequisites

### 1. An LLM judge API key

The benchmark uses an LLM to score the three observational rubrics. The default
judge is `openai:gpt-5.4-mini`, so an `OPENAI_API_KEY` in `.env` is the
zero-configuration path. To use a different provider, set `DOCS_EVAL_JUDGE` to
one of the allowed identifiers in [tests/search-eval/judges.ts](../../tests/search-eval/judges.ts):

- OpenAI: `openai:gpt-5.4-mini` (default), `openai:gpt-5`
- Anthropic: `anthropic:claude-sonnet-4-6`, `anthropic:claude-opus-4-7`
- Google: `google:gemini-3-flash-preview`, `google:gemini-3.1-flash-lite`

Deprecated models (e.g. `gpt-4o-mini`) are rejected at startup.

### 2. The five benchmark libraries must be indexed locally

The shipped dataset ([tests/search-eval/dataset.yaml](../../tests/search-eval/dataset.yaml))
references 60 queries across five libraries. **Every one of those libraries must be
present in your local store before the benchmark runs**, or preflight will fail
with the exact missing list.

Run all five scrape commands once on the machine where you'll run the benchmark.
Every command excludes 2-letter language-prefix paths so translation mirrors
don't balloon the index — the dataset's qrels only reference English pages.

```bash
# React (react.dev has /es/, /zh-hans/, /ja/, etc.)
npx @arabold/docs-mcp-server@latest scrape react https://react.dev \
  --exclude-pattern '/^https:\/\/react\.dev\/[a-z]{2}(-[a-z]+)?\//' \
  --max-pages 300

# Python stdlib (docs.python.org has /zh-cn/, /ja/, /fr/, /es/, /ko/, etc.)
npx @arabold/docs-mcp-server@latest scrape python https://docs.python.org/3/ \
  --exclude-pattern '/^https:\/\/docs\.python\.org\/3\/[a-z]{2}(-[a-z]+)?\//' \
  --max-pages 500

# FastAPI (heavy i18n — /es/, /zh/, /zh-hant/, /em/, ~15 languages)
npx @arabold/docs-mcp-server@latest scrape fastapi https://fastapi.tiangolo.com/ \
  --exclude-pattern '/^https:\/\/fastapi\.tiangolo\.com\/[a-z]{2}(-[a-z]+)?\//' \
  --max-pages 200

# Vite (English-only, but cap pages to be safe)
npx @arabold/docs-mcp-server@latest scrape vite https://vitejs.dev/guide/ \
  --max-pages 200

# TailwindCSS
npx @arabold/docs-mcp-server@latest scrape tailwindcss https://tailwindcss.com/docs \
  --max-pages 300
```

> **Why exclude language prefixes?** FastAPI's docs site, for example, hosts the
> full doc tree in ~15 languages under `/es/`, `/zh/`, `/zh-hant/`, etc. A naive
> scrape pulls ~1300 pages where only ~100 are actually relevant to the
> benchmark. The regex excludes any URL whose first path segment is a 2-letter
> code (optionally with a suffix like `-hant`). English content lives at the
> root and is preserved.

`--max-pages` is a safety belt; the English doc tree for each library fits well
within these caps. You can drop or raise it if you want maximal coverage.

> **Subset run.** If you only want a quick sanity check, point `DOCS_EVAL_DATASET`
> at a custom dataset file that uses fewer libraries — the schema is identical.

### 3. Node 22

The store uses `better-sqlite3` with a pinned native binary. Always run the
benchmark on Node 22 even if the rest of your toolchain is newer.

## Running

```bash
# Measurement run: compute metrics, compare against baseline.json, exit non-zero on regression.
npm run evaluate:search

# Baseline-refresh: same run, but write the result to baseline.json and exit zero.
# Use this after intentional improvements, or for the very first run.
npm run evaluate:search:baseline

# Preflight only: confirm all required libraries are indexed.
npm run evaluate:search:preflight
```

Both modes produce, under `tests/search-eval/results/` (gitignored):

| File | Purpose |
|---|---|
| `summary.json` | Machine-readable summary for CI consumption |
| `promptfoo-raw.json` | Raw per-query promptfoo output |
| `cross-judge.json` | Cross-judge agreement, when `DOCS_EVAL_CROSS_JUDGE` is set |
| `dataset.flat.yaml` | Generated flat view of the dataset (don't edit) |

`baseline.json` lives in `tests/search-eval/baseline.json` and **is checked in**.
Its history is the audit trail for benchmark drift over time.

## First run

The repository ships with a populated `tests/search-eval/baseline.json` (recorded
against the default dataset / judge / embedding model). Your first run should be:

```bash
# 1. Confirm libraries are indexed.
npm run evaluate:search:preflight

# 2. Smoke-test the pipeline with 5 queries (~1 minute) — sanity check the
#    provider, assertions, judge, aggregator, and comparator. This writes to
#    `dataset.smoke.baseline.json`, NOT to the main baseline, so you can run it
#    safely without disturbing the checked-in reference numbers.
DOCS_EVAL_DATASET=tests/search-eval/dataset.smoke.yaml \
  npm run evaluate:search:baseline

# 3. Measure against the checked-in baseline. Exits non-zero on regression.
npm run evaluate:search
```

### When to refresh the baseline

`npm run evaluate:search:baseline` overwrites `tests/search-eval/baseline.json`.
Refresh it when:

- you've intentionally changed something that should shift retrieval (new
  embedding model, chunking config, scraper logic);
- you've reviewed the dataset and want the new numbers to be the new reference;
- a re-scrape or re-index moved scores in a direction you want to keep.

The comparator refuses to gate against a baseline recorded under materially
different config (different `datasetFile`, `embeddingModel`, `judge`, `topK`,
or `provider`). It prints the incompatibility list and exits zero — re-record
the baseline if this run is the new reference.

## Compare against another retrieval service

The benchmark supports running the same dataset, same judge, same metrics
against alternative retrieval providers — see how `docs-mcp-server` stacks
up against the alternatives. Out of the box, `local` (the in-repo
`SearchTool`) and `context7` ([Context7](https://context7.com/)) are
supported. Adding another provider is one entry in `tests/search-eval/run.ts`
plus a small exec-provider script.

```bash
# Record a baseline for the local provider (default — same as the canonical
# `npm run evaluate:search:baseline`).
npm run evaluate:search:baseline

# Record a baseline against Context7. Writes to a separate file so the
# canonical local baseline is untouched.
DOCS_EVAL_PROVIDER=context7 DOCS_EVAL_NO_CACHE=1 \
  npm run evaluate:search:baseline
# → tests/search-eval/baseline.context7.json

# Side-by-side report (IR / per-intent / LLM-judged / structural).
npx vite-node tests/search-eval/cli/compare-providers.ts \
  tests/search-eval/baseline.json \
  tests/search-eval/baseline.context7.json
```

The Context7 provider hits Context7's public `/v2/context` endpoint. It works
anonymously for short runs; set `CONTEXT7_API_KEY` in your environment for
sustained or CI use.

The comparator refuses to gate one provider's run against another's baseline
(it'd produce false regressions/improvements). For cross-provider comparison
always use the dedicated CLI above — it prints both sides and a coarse
"wins per metric" tally without pretending the deltas are regressions.

> **Asymmetry to know about.** Our IR metrics (MRR, Recall@k, nDCG@k, Hit@k)
> match by URL string against the dataset's qrels. For most libraries Context7
> returns per-page source URLs that match our qrels directly. TailwindCSS is
> the exception — Context7 attributes Tailwind chunks to GitHub source paths;
> the provider normalises these back to `tailwindcss.com/docs/...` URLs so the
> comparison is fair. Some Context7 info-snippets carry only a library-level
> `llms.txt` placeholder URL; the provider drops those rather than letting
> them poison IR metrics with always-wrong URLs.

### Performance note

Each query cold-starts a fresh `vite-node` process and re-initialises the
docService (which writes through `better-sqlite3` for schema migrations).
Running multiple provider processes in parallel deadlocks on the SQLite write
lock, so the default concurrency is **1**. Expect roughly 10–15 seconds per
query — the full 60-query baseline takes 10–15 minutes.

You can raise concurrency once we move to a long-running provider that
initialises the store once per run:

```bash
DOCS_EVAL_CONCURRENCY=4 npm run evaluate:search:baseline   # don't do this yet
```

## Reading the output

A run prints to stdout in roughly this shape:

```
=== docs-mcp-server search benchmark ===
judge=openai:gpt-5.4-mini  embedding=...  top_k=5  dataset=...  ts=...

─ Headline IR metrics (deterministic) ─
MRR         0.612  (baseline 0.605, +1.2% ▲)
Recall@5    0.844  (baseline 0.851, -0.8% ·)
nDCG@5      0.701  (baseline 0.704, -0.4% ·)
Hit@3       0.917  (baseline 0.900, +1.9% ▲)

─ Per-intent breakdown ─
api-lookup       n=19  MRR=0.78 R@5=0.91 nDCG@5=0.82 Hit@3=0.95
conceptual       n=15  MRR=0.55 R@5=0.78 nDCG@5=0.62 Hit@3=0.87
comparison       n=12  MRR=0.41 R@5=0.71 nDCG@5=0.55 Hit@3=0.83
troubleshooting  n=14  MRR=0.59 R@5=0.85 nDCG@5=0.70 Hit@3=0.93

─ Structural checks (deterministic, pass rate) ─
code_block_balance: 96.7%
non_empty_content:  100.0%
url_presence:       100.0%

─ LLM-judged (observational, not gating) ─
chunk_coherence        mean=3.85  n=60
content_faithfulness   mean=4.12  n=60
answerability          mean=3.40  n=60

✅ No regressions. 2 improved, 7 stable.
```

A regression run exits with code 1 and prints the offending metrics with relative
deltas. Tolerances default to 5% relative on headline metrics, 10% relative on
per-intent breakdowns; adjust via `tolerances` in the comparator if you need
something different.

## Customizing

| What | How |
|---|---|
| Use a different judge | `DOCS_EVAL_JUDGE=anthropic:claude-sonnet-4-6 npm run evaluate:search` |
| Enable cross-judge sampling | `DOCS_EVAL_CROSS_JUDGE=google:gemini-3.1-flash-lite DOCS_EVAL_CROSS_JUDGE_N=10 npm run evaluate:search` |
| Run a subset dataset | `DOCS_EVAL_DATASET=path/to/your.yaml npm run evaluate:search` |
| Bust promptfoo's cache after a re-index | `DOCS_EVAL_NO_CACHE=1 npm run evaluate:search:baseline` |
| Add a query | Append an entry to `tests/search-eval/dataset.yaml`, then refresh the baseline |
| Add a library | Append entries, scrape the library, also update `.github/workflows/eval.yml` |

> **About `DOCS_EVAL_NO_CACHE`.** Promptfoo caches by `(provider id, prompt, vars)`. If you re-scrape or re-index a library, the provider returns different chunks but promptfoo doesn't know — it serves stale cached output. Set `DOCS_EVAL_NO_CACHE=1` once after a re-index to force fresh provider calls + fresh judge calls. Default stays cached so subsequent measurement runs are fast and cheap.

The dataset currently ships with `status: draft` because the entries were
authored without per-entry community review. The `notes:` block at the top of
`dataset.yaml` contains a review checklist; once you've worked through it, change
`status: draft` → `status: reviewed`.

## CI

`.github/workflows/eval.yml` runs the benchmark on `workflow_dispatch` (manual)
and a weekly schedule (Mondays 07:00 UTC). The workflow scrapes the five
libraries into a cached store on the first run, then re-uses the cache on
subsequent runs. The benchmark is **deliberately not gated on PRs** — variance
and judge cost make per-PR gating premature. Regressions caught by the scheduled
run are visible in the workflow summary and uploaded as an artifact.

## Related

- [tests/search-eval/README.md](../../tests/search-eval/README.md) — file layout
  and how to add metrics
- [openspec/changes/define-search-benchmark/](../../openspec/changes/define-search-benchmark/)
  — proposal, design, full spec
