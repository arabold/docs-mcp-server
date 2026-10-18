# Design

## Context

See proposal.md for why. Relevant facts about the current code:

- `DocumentStore.findByContent()` returns ranked chunks. With embeddings it runs one SQL statement that unions vector and full-text candidates and ranks them with weighted RRF (`search.weightVec`, `search.weightFts`); without an embedding config it runs the full-text-only statement. The weights are read once, in the constructor.
- `DocumentRetrieverService.search()` takes those chunks, groups them by page, clusters nearby chunks, assembles context around them and sorts the results by score. This is what the `search_docs` tool returns.
- `DocumentStore` creates its embedding client through `createEmbeddingModel()` in `src/store/embeddings/EmbeddingFactory.ts` and uses it for both documents and queries.
- Local directories are indexed through `file://` URLs by `LocalFileStrategy`, with the same splitter and storage as web pages. `test/pipeline-harness.ts` shows how to drive `PipelineManager` and `DocumentManagementService` to completion in-process.
- `tests/search-eval/lib/metrics.cjs` already computes MRR, Hit@k, Recall@k and graded nDCG@k from a ranked list of identifiers and a list of graded relevant identifiers.
- Vitest runs `tests/**/*.test.ts` in the default suite. `vite.config.live.ts` shows how a separate config replaces the exclude list and drops the MSW setup for a suite that needs the real network.

## Goals / Non-Goals

**Goals:**
- One command that scores full-text, vector and hybrid search on the same index and says, per query, whether the right chunk moved up or down.
- Identical numbers for everyone with the same commit, and no network after the first run.
- No production code changes to make the benchmark possible.

**Non-Goals:**
- HTML extraction quality. The corpus is Markdown source, so the benchmark covers splitting, storage and ranking, not HTML-to-Markdown conversion.
- Running in CI or as part of `npm test`.
- Replacing or changing `npm run evaluate:search` and its LLM judges.
- Comparing against external retrieval services.

## Decisions

### 1. Corpus: Markdown docs of four projects at pinned commits

| Library | Repository | Indexed root | Files | License |
|---|---|---|---:|---|
| react | reactjs/react.dev | `src/content` (`learn/`, `reference/`) | 180 | CC BY 4.0 |
| fastapi | fastapi/fastapi | `docs/en/docs` | 156 | MIT |
| vite | vitejs/vite | `docs` | 57 | MIT |
| pydantic | pydantic/pydantic | `docs` | 91 | MIT |

About 5.9 MB of Markdown. Four libraries in one store keep cross-library effects (bm25 counts rows across the whole store) while staying small enough to index in a couple of minutes. Each source is fetched with a shallow, blobless, sparse `git` checkout of its pinned commit, so only the doc paths are downloaded.

*Alternatives:* the developer's own store (rejected by the user: results drift with re-scrapes); committing the corpus (adds 6 MB of third-party text to the repo); downloading GitHub tarballs (react.dev's tarball is about 200 MB because of images).

### 2. Re-index every run, cache embeddings by text

Every run indexes the corpus into a fresh store, so splitter and pipeline changes are always measured. Indexing stays cheap because every vector comes from a disk cache keyed by `sha256(model spec, vector dimension, text)`. Only texts the cache has not seen go to the provider, so a splitter change re-embeds only the chunks it changed. `DOCS_ACCURACY_REUSE_INDEX=1` skips re-indexing when iterating on ranking alone.

*Alternatives:* keep the indexed store between runs keyed by a code hash (hard to define which code matters); record and replay at the HTTP layer (works only for OpenAI-compatible APIs).

### 3. Run under Vitest and wrap the embedding factory with `vi.mock`

The benchmark is a Vitest file run by its own config. It replaces `createEmbeddingModel` with a version that wraps the real client in a caching `Embeddings`, the same `vi.mock(..., importActual)` pattern `DocumentStore.test.ts` uses. That gives the cache to every `DocumentStore` the pipeline creates without a production seam. The config drops `test/setup-e2e.ts` (MSW would block the embedding API), loads `.env`, and sets a long test timeout.

*Alternative:* a `vite-node` script plus an injection point in `DocumentStore` or `DocumentManagementService`. Rejected because it changes production code for a test tool.

### 4. Modes are configurations of the real store

All modes open the same index file with their own `DocumentStore`:

| Mode | Configuration | Ranking used |
|---|---|---|
| `fts` | `app.embeddingModel = ""` | the full-text-only statement, as for users without embeddings |
| `vector` | `search.weightFts = 0` | hybrid statement; RRF from vector ranks only |
| `hybrid` | defaults | hybrid statement with the configured weights |

An FTS-only store skips the embedding-model change check, so opening it on an index that has vectors leaves them untouched. With `weightFts = 0`, full-text-only candidates score 0 and sort last, and the vector candidate pool (`limit × overfetchFactor × vectorMultiplier`) is far larger than the 10 results scored, so the top 10 are the vector ranking.

### 5. Two levels, both with limit 10

- `store`: `findByContent(library, "", query, 10)`. A result is a chunk-level hit when its content contains a golden passage.
- `final`: `DocumentRetrieverService.search(library, "", query, 10)`. A result is a hit when its assembled content contains a golden passage.

Both levels use the same limit, so the store pool the final results are built from is the one scored at store level. Ranks past 10 count as misses.

### 6. Golden passages are matched by normalized containment

Passages and chunk contents are normalized the same way before comparing: Markdown links reduced to their text, emphasis and inline-code markers removed, whitespace collapsed, lower-cased. A chunk contains a passage when the normalized chunk includes the normalized passage. When it does not, the longest run of consecutive passage words found in the chunk decides: half the passage or more counts as a hit (and the passage is reported as split). Passages are one or two sentences of prose, which keeps splits rare and the check cheap.

### 7. Scoring reuses `metrics.cjs` with identifiers

For each query, every result is turned into an identifier and passed with graded relevant identifiers to `computeIrMetrics()`:

- chunk level: a result containing passage *i* of query *q* becomes `q-p<i>`; any other result gets a unique `miss-<rank>`. The relevant list is `q-p<i>` with each passage's grade.
- page level: a result becomes its page path; relevant pages carry the highest grade among their passages.

Identifiers contain no `#`, `?`, trailing `/` or `.md`, which `normalizeUrl()` would strip. The first-hit rank is read from the same ranked list.

### 8. Golden set authoring

About 120 queries, 30 per library, written from the indexed chunks rather than the raw files, so passages match what the pipeline stores. Each library gets every style (keywords, identifier, question, agent request) and a spread of intents. Question and agent-request queries paraphrase the docs rather than copying their words, so the set does not favour full-text search. The first version is model-authored and marked `status: draft` until a person reviews it, like `tests/search-eval/dataset.yaml`.

### 9. Baseline comparison

`baseline.json` holds a configuration snapshot (`sha256` of `corpus.yaml` and `golden.yaml`, the embedding model spec and dimension, the `search` config section, limit) and, per mode and level, aggregate metrics and each query's chunk-level first rank. A measurement run compares only when the snapshot matches. It lists changed first ranks per mode and level and fails when chunk-level or page-level MRR, Hit@5 or nDCG@10 drops by more than 0.02 (about two to three of 120 queries). `vitest --mode baseline` rewrites the file. Modes skipped for lack of embeddings are left as they are in the baseline and not compared.

## Program Design

### Files

```
tests/search-accuracy/
+ corpus.yaml              # sources: library, repo, revision, root, include globs, license
+ golden.yaml              # status, attribution, queries with graded passages
+ baseline.json            # snapshot + per mode/level aggregates and first ranks
+ README.md                # how to run, read and extend; how to add queries
+ accuracy.eval.ts         # the benchmark: fetch, index, validate, score, compare
+ corpus.ts                # manifest loading, sparse git checkout into the cache
+ golden.ts                # golden set loading and schema checks
+ golden.test.ts           # runs in npm test
+ passages.ts              # normalization and passage matching
+ passages.test.ts         # runs in npm test
+ embedding-cache.ts       # CachingEmbeddings and the SQLite-backed cache
+ embedding-cache.test.ts  # runs in npm test
+ evaluate.ts              # per-mode stores, ranking, scoring, aggregation
+ evaluate.test.ts         # scoring against hand-made ranked lists; runs in npm test
+ baseline.ts              # snapshot, comparison, report rendering
+ baseline.test.ts         # runs in npm test
+ vite.config.accuracy.ts  # includes only accuracy.eval.ts; no MSW; long timeout
~ package.json             # evaluate:accuracy and evaluate:accuracy:baseline scripts
~ .gitignore               # .cache/search-accuracy/ and tests/search-accuracy/results/
~ AGENTS.md                # test inventory row for the benchmark
~ docs/guides/benchmarking.md  # points to the accuracy benchmark
```

The cache lives in `.cache/search-accuracy/` at the repository root (override: `DOCS_ACCURACY_CACHE_DIR`):

```
corpus/<library>@<revision>/   # sparse checkouts
embeddings/<model-key>.sqlite  # key TEXT PRIMARY KEY, vector BLOB
index.sqlite                   # rebuilt each run unless DOCS_ACCURACY_REUSE_INDEX=1
```

### Types and signatures

```ts
type QueryStyle = "keywords" | "identifier" | "question" | "agent-request";
type QueryIntent = "api-lookup" | "how-to" | "conceptual" | "comparison" | "troubleshooting";
type Mode = "fts" | "vector" | "hybrid";
type Level = "store" | "final";

interface GoldenPassage { page: string; text: string; grade: 1 | 2 | 3 }
interface GoldenQuery {
  id: string; library: string; query: string;
  intent: QueryIntent; style: QueryStyle; passages: GoldenPassage[];
}

// corpus.ts — throws CorpusFetchError(library, revision, cause) when git fails.
function ensureCorpus(manifestPath: string, cacheDir: string): Promise<CorpusCheckout[]>;

// golden.ts — throws GoldenSetError listing every malformed entry and coverage rule broken.
function loadGoldenSet(path: string): GoldenQuery[];

// passages.ts
type PassageMatch = "whole" | "split" | null;
function matchPassage(content: string, passage: string): PassageMatch;

// embedding-cache.ts — a cache miss calls the inner client once per batch of misses;
// provider errors propagate unchanged.
class CachingEmbeddings extends Embeddings {
  constructor(inner: Embeddings, cache: EmbeddingCache);
}

// evaluate.ts — throws when a golden passage is not found in any chunk of its page.
function validatePassages(storePath: string, golden: GoldenQuery[]): PassageReport;
function evaluateMode(mode: Mode, storePath: string, golden: GoldenQuery[],
  config: AppConfig): Promise<ModeResult>;   // ModeResult: per level, per query ranks + metrics

// baseline.ts
function compareWithBaseline(run: RunResult, baseline: Baseline | null): Comparison;
function renderReport(run: RunResult, comparison: Comparison): string;
```

### Call tree

```
accuracy.eval.ts
  vi.mock(EmbeddingFactory)              # createEmbeddingModel → CachingEmbeddings(real client)
  loadGoldenSet()                         # fails fast before any download
  ensureCorpus()                          # git sparse checkout per missing revision
  indexCorpus()                           # unless DOCS_ACCURACY_REUSE_INDEX=1
    DocumentManagementService(config with storePath = index.sqlite)
    PipelineManager.enqueueScrapeJob(file://<checkout>/<root>)  # one job per library
    waitForJobCompletion()                # a failed job fails the run
  validatePassages()                      # reads chunks of each golden page
  for mode in selected modes:
    evaluateMode()                        # skipped when embeddings are unavailable
      new DocumentStore(index.sqlite, modeConfig) + DocumentRetrieverService
      findByContent() / search()  per query
      computeIrMetrics()                  # tests/search-eval/lib/metrics.cjs
  compareWithBaseline() | write baseline  # --mode baseline
  write results/report.md and results/run.json; print summary
  expect(comparison.regressions).toEqual([])
```

Options are environment variables, so the npm scripts stay cross-platform: `DOCS_ACCURACY_MODES` (comma list), `DOCS_ACCURACY_LIBRARIES`, `DOCS_ACCURACY_REUSE_INDEX`, `DOCS_ACCURACY_CACHE_DIR`.

### Constraints

- Embeddings come from `DOCS_MCP_EMBEDDING_MODEL` and the provider credentials in the environment or `.env`, as for the server. The embedding cache key includes the model spec and the vector dimension.
- `CachingEmbeddings` is not an instance of `FixedDimensionEmbeddings`, so `DocumentStore` does not see `allowTruncate` on a wrapped Gemini client. The first version supports providers that do not rely on truncation; the README says so.
- Indexing uses `scrapeMode: fetch`-equivalent local file reading only; no browser is launched.

## Risks / Trade-offs

- [A model-written golden set can mirror one model's phrasing and favour vector search] → mixed styles with keyword and identifier queries, paraphrase rules for the rest, and human review before the set loses `draft`.
- [120 queries is a small sample; one query moves MRR by about 0.008] → the 0.02 gate means two or three queries; the per-query rank list shows whether a change is a pattern or noise.
- [Upstream docs change and old revisions disappear] → pins are commit SHAs, which GitHub keeps fetchable; moving a pin is a deliberate dataset change that revalidates every passage and refreshes the baseline.
- [Markdown source is not what users index from the web] → stated as a non-goal; HTML extraction keeps its own tests.
- [Re-indexing takes time on every run] → cached embeddings make it local work; `DOCS_ACCURACY_REUSE_INDEX=1` for ranking-only iterations.
- [react.dev pages contain MDX components such as `<Sandpack>`] → they are indexed as the pipeline sees them; golden passages are taken from indexed chunks, so this does not break matching.
