# Search Quality Benchmark

`docs-mcp-server` ships with a retrieval-quality benchmark. It measures how well
`SearchTool` returns relevant chunks for natural-language queries, so you can
detect regressions after changing the embedding model, the chunking, the
scraper, or the ranking, and compare this server against other retrieval
services.

This guide covers running the benchmark and reading its results. For how the
benchmark is built and how to extend it (providers, metrics, dataset), see
[tests/search-eval/README.md](../../tests/search-eval/README.md). The
requirements it implements are in
[openspec/specs/search-evaluation/spec.md](../../openspec/specs/search-evaluation/spec.md).

## What It Measures

The benchmark measures retrieval only: it scores the chunks a query returns,
not an answer generated from them.

Headline metrics are deterministic and gate regressions:

| Metric | Question it answers |
|---|---|
| MRR | How high in the result list is the first relevant page? |
| Recall@{3,5,10} | What fraction of the relevant pages appear in the top k? |
| nDCG@{5,10} | Are the most relevant pages ranked above the less relevant ones? |
| Hit@{1,3,5} | Does any relevant page appear in the top k? |

Each query asks for 5 results by default, so the @10 metrics equal the @5 ones
unless you raise `DOCS_EVAL_TOP_K`.

Observational metrics are reported but never fail a run:

| Metric | Question it answers |
|---|---|
| Structural pass rates | Are code fences balanced? Does every chunk have content and a URL? |
| Chunk coherence (LLM-judged) | Is each chunk a self-contained, readable unit? |
| Content faithfulness (LLM-judged) | Do the chunks reflect their source page faithfully? |
| Answerability (LLM-judged) | Could an LLM answer the query from these chunks alone? |

## Prerequisites

### Node 22

The store uses `better-sqlite3`, whose native binary matches the Node version
that installed it. Run the benchmark on Node 22, like the rest of the project.

### API Keys

An LLM judge scores the three observational rubrics. The default judge is
`openai:gpt-5.4-mini`, so `OPENAI_API_KEY` in the repository's `.env` file is
all a default run needs. The local search provider also embeds each query with
the store's embedding model; with the default model (`text-embedding-3-small`)
the same key covers that.

To use another judge, set `DOCS_EVAL_JUDGE` to an identifier from the allowlist
in [tests/search-eval/judges.ts](../../tests/search-eval/judges.ts) and provide
that provider's key (`ANTHROPIC_API_KEY` or `GOOGLE_API_KEY`). The run stops at
startup when the judge is unknown or marked deprecated.

### The Five Benchmark Libraries

The dataset ([tests/search-eval/dataset.yaml](../../tests/search-eval/dataset.yaml))
has 59 queries across five libraries: `react`, `python`, `fastapi`, `vite` and
`tailwindcss`. All five must be indexed in your local store before a run. The
preflight check lists any that are missing.

These are the commands the CI workflow uses. Run them once on the machine that
runs the benchmark:

```bash
npx @arabold/docs-mcp-server@latest scrape react https://react.dev \
  --exclude-pattern '/^https:\/\/react\.dev\/[a-z]{2}(-[a-z]+)?\//' \
  --max-pages 300

npx @arabold/docs-mcp-server@latest scrape python https://docs.python.org/3/ \
  --exclude-pattern '/^https:\/\/docs\.python\.org\/3\/[a-z]{2}(-[a-z]+)?\//' \
  --max-pages 500

npx @arabold/docs-mcp-server@latest scrape fastapi https://fastapi.tiangolo.com/ \
  --exclude-pattern '/^https:\/\/fastapi\.tiangolo\.com\/[a-z]{2}(-[a-z]+)?\//' \
  --max-pages 200

npx @arabold/docs-mcp-server@latest scrape vite https://vitejs.dev/guide/ \
  --max-pages 200

npx @arabold/docs-mcp-server@latest scrape tailwindcss https://tailwindcss.com/docs \
  --max-pages 300
```

The exclude patterns skip URLs whose first path segment is a language code
(`/es/`, `/zh-hant/`), because the dataset's relevant pages are all English
and translated copies would multiply the index. `--max-pages` is a safety
limit; each library's English pages fit within it.

These commands index with the published release. The benchmark always searches
with the code in your checkout, so ranking changes need no re-index. To measure
a change to scraping or splitting, index with your checkout instead: run
`npm run build`, then the same commands as `npm run cli -- scrape ...` with
`--replace` added, which rebuilds a library that is already indexed.

## Running

```bash
# Check that every library in the dataset is indexed.
npm run evaluate:search:preflight

# Measure: compare against the checked-in baseline, exit 1 on a regression.
npm run evaluate:search

# Record: same run, then write the result as the new baseline and exit 0.
npm run evaluate:search:baseline
```

A first run on a new machine usually goes like this:

1. `npm run evaluate:search:preflight` to confirm the libraries are indexed.
2. A smoke run over five queries (about a minute) to check keys, provider,
   judge and report end to end:

   ```bash
   DOCS_EVAL_DATASET=tests/search-eval/dataset.smoke.yaml \
     npm run evaluate:search:baseline
   ```

   It writes its own baseline file, `tests/search-eval/dataset.smoke.baseline.json`
   (untracked), so the checked-in baseline stays as it is.
3. `npm run evaluate:search` to measure against the checked-in baseline.

With the local provider, each query takes about 10 to 15 seconds, so the full
dataset takes 10 to 15 minutes. Every query starts a new provider process that
opens the store, and parallel processes block each other on the SQLite write
lock, so queries run one at a time by default.

Each run writes these files to `tests/search-eval/results/` (ignored by git):

| File | Contents |
|---|---|
| `summary.json` | Aggregated metrics, the run's configuration, and the regression verdict |
| `promptfoo-raw.json` | Raw per-query output from promptfoo |
| `cross-judge.json` | Cross-judge agreement, when `DOCS_EVAL_CROSS_JUDGE` is set |
| `dataset.flat.yaml` | The dataset in the flat form promptfoo reads; regenerated on every run |

## Reading the Output

The report printed at the end of a run has these sections:

- A header with the judge, embedding model, top k, and dataset (with its review
  status and query count).
- Headline IR metrics: MRR, Recall@5, nDCG@5 and Hit@3, each with the baseline
  value and the relative change, followed by the other five IR metrics on one
  line.
- A per-intent breakdown (`api-lookup`, `conceptual`, `comparison`,
  `troubleshooting`) of MRR, Recall@5, nDCG@5 and Hit@3.
- Structural pass rates and the mean of each LLM-judged score.
- Cross-judge agreement, when a cross-judge is set.
- A verdict.

The verdict is one of four:

| Verdict | Meaning | Exit code of `evaluate:search` |
|---|---|---|
| `No regressions. N improved, M stable.` | Every gated metric is within tolerance of the baseline | 0 |
| `Regressions:` followed by a list | At least one gated metric dropped past its tolerance | 1 |
| `Baseline config differs from current run` | The baseline was recorded under a different configuration (see below), so the run is not compared | 0 |
| `No baseline found` | No baseline file exists for this dataset and provider yet | 0 |

All nine IR metrics are gated against the baseline with a tolerance of 5%
relative change. The per-intent MRR, Recall@5, nDCG@5 and Hit@3 are gated with
10%. The tolerances are `DEFAULT_TOLERANCES` in
[tests/search-eval/types.ts](../../tests/search-eval/types.ts).

The run also prints a warning while the dataset's `status` is `draft`; the
dataset section of the [developer README](../../tests/search-eval/README.md#changing-the-dataset)
explains the review that changes it.

## Refreshing the Baseline

`npm run evaluate:search:baseline` overwrites `tests/search-eval/baseline.json`,
which is checked in; its git history is the record of how retrieval quality
moved over time. Refresh it when:

- you changed something that should move retrieval (embedding model, chunking,
  scraper, ranking) and want the new numbers as the reference;
- you changed the dataset;
- a re-index moved the scores and you want to keep the new state.

The comparator only gates against a baseline recorded with the same provider,
dataset file, query count, embedding model, judge, and top k. When any of
these differ, it prints the differences and exits 0; record a new baseline if
the new configuration is the reference.

Promptfoo caches provider output and judge scores by provider, prompt and
query. After a re-scrape or re-index, set `DOCS_EVAL_NO_CACHE=1` for one run,
or promptfoo returns the results it cached before the re-index:

```bash
DOCS_EVAL_NO_CACHE=1 npm run evaluate:search:baseline
```

## Settings

The benchmark reads these environment variables:

| Variable | Effect |
|---|---|
| `DOCS_EVAL_JUDGE` | Judge model, from the allowlist in `judges.ts`. Default `openai:gpt-5.4-mini`. |
| `DOCS_EVAL_CROSS_JUDGE` | A second judge from a different provider, which re-scores a fixed sample of queries to estimate judge variance. A judge from the same provider stops the cross-judge step, and the run continues without it. |
| `DOCS_EVAL_CROSS_JUDGE_N` | Cross-judge sample size. Default 10. |
| `DOCS_EVAL_DATASET` | Path to another dataset file. No library may account for more than half its queries, so a subset needs at least two libraries. |
| `DOCS_EVAL_PROVIDER` | `local` (default) or `context7`. See below. |
| `DOCS_EVAL_TOP_K` | Results per query, 1 to 100. Default 5. |
| `DOCS_EVAL_NO_CACHE` | `1` bypasses promptfoo's cache for this run. |
| `DOCS_EVAL_CONCURRENCY` | How many queries promptfoo runs at once. Default 1; keep it at 1 for the local provider. |
| `DOCS_EVAL_EMBEDDING_MODEL` | The embedding model recorded in the run's configuration, in place of the configured one. It does not change the model the search uses. |

For example, a run with a different judge and a cross-judge sample:

```bash
DOCS_EVAL_JUDGE=anthropic:claude-sonnet-4-6 \
DOCS_EVAL_CROSS_JUDGE=google:gemini-3.1-flash-lite \
DOCS_EVAL_CROSS_JUDGE_N=10 \
  npm run evaluate:search
```

`npm run evaluate:search:preflight` checks `dataset.yaml` unless you pass
another dataset path after `--`. A full run checks the dataset it runs.

To add queries or a library to the dataset, follow
[Changing the dataset](../../tests/search-eval/README.md#changing-the-dataset)
in the developer README.

## Compare Against Another Retrieval Service

The benchmark can run the same dataset, judge and metrics against another
retrieval service. Two providers exist: `local` (this server's `SearchTool`)
and `context7` ([Context7](https://context7.com/)). Each provider records its
own baseline file.

```bash
# Record a Context7 baseline. Writes tests/search-eval/baseline.context7.json.
DOCS_EVAL_PROVIDER=context7 DOCS_EVAL_NO_CACHE=1 \
  npm run evaluate:search:baseline

# Side-by-side report of two baselines: IR, per-intent, LLM-judged, structural.
npx vite-node tests/search-eval/cli/compare-providers.ts \
  tests/search-eval/baseline.json \
  tests/search-eval/baseline.context7.json
```

The Context7 provider calls Context7's public `/v2/context` endpoint and needs
no local store, so the run skips preflight. It works without a key for short
runs; set `CONTEXT7_API_KEY` for sustained or CI use. The provider rewrites the
URLs Context7 returns into the form the dataset uses, so both sides are matched
the same way.

Use the comparison CLI for cross-provider results. It prints both sides and a
count of metrics each side wins, without treating the differences as
regressions.

## Comparing HTML Extractors

The HTML pipeline has two content extractors:

- `cheerio` (default): `HtmlSanitizerMiddleware` with a hand-curated selector
  blocklist. This is the extractor the `html-content-extraction` spec
  describes, and the behavior the benchmark measures against.
- `defuddle`: [Defuddle](https://github.com/kepano/defuddle), which scores DOM
  nodes and keeps the main article content. It exists as an evaluation arm for
  this comparison and is not held to the extraction guarantees of the default.

`DOCS_MCP_SCRAPER_HTML_EXTRACTOR` (or `scraper.htmlExtractor` in `config.yaml`)
selects the extractor. Both hand the same kind of DOM to the rest of the
pipeline, so only the boilerplate removal differs.

The extractor runs while scraping, so each arm needs its own index:

```bash
npm run build

# 1. Index all five libraries with Cheerio and record a baseline.
DOCS_MCP_SCRAPER_HTML_EXTRACTOR=cheerio npm run cli -- scrape react https://react.dev \
  --exclude-pattern '/^https:\/\/react\.dev\/[a-z]{2}(-[a-z]+)?\//' \
  --max-pages 300 --replace
# ...the other four libraries the same way (see Prerequisites)...
DOCS_EVAL_NO_CACHE=1 npm run evaluate:search:baseline

# 2. Index all five again with Defuddle and measure against that baseline.
DOCS_MCP_SCRAPER_HTML_EXTRACTOR=defuddle npm run cli -- scrape react https://react.dev \
  --exclude-pattern '/^https:\/\/react\.dev\/[a-z]{2}(-[a-z]+)?\//' \
  --max-pages 300 --replace
# ...the other four libraries the same way...
DOCS_EVAL_NO_CACHE=1 npm run evaluate:search
```

Step 1 overwrites the checked-in `baseline.json`. Restore it with
`git restore tests/search-eval/baseline.json` unless the new baseline is meant
to be committed. The measurement run reports Defuddle's deltas against the
Cheerio baseline; `tests/search-eval/results/summary.json` holds the absolute
numbers.

## CI

[`.github/workflows/eval.yml`](../../.github/workflows/eval.yml) runs
`npm run evaluate:search` on manual dispatch and every Monday at 07:00 UTC. It
never runs on pull requests, because judge cost and variance make per-PR
gating premature.

- Manual runs take a judge, an optional cross-judge, and a cross-judge sample
  size as inputs. The workflow reads `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` and
  `GOOGLE_API_KEY` from repository secrets.
- The workflow caches the store. On a cache miss it scrapes the five libraries
  with the published release, using the commands in
  [Prerequisites](#the-five-benchmark-libraries). The cache key includes a hash
  of `dataset.yaml`, so a dataset change triggers a fresh scrape; bump the `v1`
  in the key to force one otherwise.
- A regression fails the job. The job summary shows the metrics from
  `summary.json`, and the result files are uploaded as an artifact either way.

## Reference Benchmark Runs

Headline numbers for each configuration benchmarked so far, against the
59-query dataset. All runs use `openai:gpt-5.4-mini` as judge and
`text-embedding-3-small` for embeddings. Bold marks the best value in each row.

| Metric | Cheerio (default) ¹ | Defuddle ² | Context7 (external) ³ |
|---|---|---|---|
| **Structural** (deterministic) | | | |
| code_block_balance | **1.000** | 0.983 | **1.000** |
| non_empty_content | 1.000 | 1.000 | 1.000 |
| url_presence | 1.000 | 1.000 | 1.000 |
| **Headline IR** (deterministic) | | | |
| MRR | **0.747** | 0.718 | 0.695 |
| Recall@3 | 0.647 | 0.621 | **0.695** |
| Recall@5 | **0.732** | 0.689 | 0.729 |
| nDCG@5 | **0.699** | 0.665 | 0.673 |
| Hit@3 | **0.831** | 0.780 | **0.831** |
| Hit@5 | **0.881** | 0.814 | 0.864 |
| **Per-intent MRR** | | | |
| api-lookup (n=18) | **0.861** | 0.806 | 0.708 |
| conceptual (n=15) | 0.794 | **0.806** | 0.789 |
| comparison (n=12) | 0.646 | **0.736** | 0.694 |
| troubleshooting (n=14) | **0.637** | 0.494 | 0.577 |
| **LLM-judged** (observational) | | | |
| chunk_coherence | 3.53 | 3.39 | **4.83** |
| content_faithfulness | 3.20 | 3.19 | **4.07** |
| answerability | 4.49 | 4.49 | **4.53** |

¹ The default Cheerio extractor: the checked-in
[`tests/search-eval/baseline.json`](../../tests/search-eval/baseline.json),
recorded on 2026-05-19, which the comparator gates against.

² The Defuddle extractor (`DOCS_MCP_SCRAPER_HTML_EXTRACTOR=defuddle`), with all
five libraries scraped through Defuddle on 2026-05-18 (1,155 pages). On this
dataset Defuddle is a regression against Cheerio: headline IR metrics drop 4 to
6% relative, and troubleshooting queries drop most (MRR -22%, nDCG@5 -22%,
Hit@3 -20%). Comparison queries improve (MRR +14%), where the relevant content
is the article body that Defuddle keeps. Code fence balance slips to 98.3%.
Cheerio stays the default; Defuddle may be worth revisiting for sites whose
content is mostly articles with noisy side content.

³ [Context7](https://context7.com), measured through the `context7` provider:
the checked-in
[`tests/search-eval/baseline.context7.json`](../../tests/search-eval/baseline.context7.json),
recorded on 2026-09-20. Its chunking, embedding and ranking are outside this
project's control. Context7 ranks lower (MRR -7.0%, Hit@1 0.559 against
0.678) but finds more relevant pages in the top three (Recall@3 +7.4%), and its
chunks score much higher on coherence (4.83 against 3.53) and faithfulness
(4.07 against 3.20). That points at chunk boundaries as the next thing worth
improving locally.

### Updating This Table

After a change that moves retrieval (chunking, embedding model, ranking,
scraper), refresh the baseline with `DOCS_EVAL_NO_CACHE=1 npm run
evaluate:search:baseline`. Then update the matching column with the new
headline, structural and LLM-judged values, and add or revise its footnote to
say what changed and when.

## Related

- [tests/search-eval/README.md](../../tests/search-eval/README.md): how the
  benchmark is built, and how to add providers, metrics and queries.
- [openspec/specs/search-evaluation/spec.md](../../openspec/specs/search-evaluation/spec.md):
  the benchmark's requirements.
- [openspec/changes/archive/2026-05-19-define-search-benchmark/](../../openspec/changes/archive/2026-05-19-define-search-benchmark/):
  the original proposal and design.
