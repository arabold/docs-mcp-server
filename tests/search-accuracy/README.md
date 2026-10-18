# Search accuracy benchmark

Measures how high search ranks the passage that answers a query. It indexes a
fixed corpus, runs about 120 labelled queries in three search modes, and
compares the ranks with a checked-in baseline, so a change to full-text search,
vector search, fusion or chunking shows up as "these queries moved up, these
moved down".

It complements the [search quality benchmark](../../docs/guides/benchmarking.md),
which labels whole pages, scores the store you have indexed and adds LLM-judged
rubrics. This one labels passages, brings its own corpus, needs no LLM judge and
runs offline after the first run. The requirements are in
[openspec/changes/define-search-accuracy-harness/specs/search-accuracy/spec.md](../../openspec/changes/define-search-accuracy-harness/specs/search-accuracy/spec.md).

## Running it

```bash
npm run evaluate:accuracy            # measure and compare with baseline.json
npm run evaluate:accuracy:baseline   # measure and rewrite baseline.json
```

Requirements:

- Node 22 and `git`. The first run downloads the corpus (about 9 MB).
- For the vector and hybrid modes, an embedding model and its credentials, set
  as for the server: `DOCS_MCP_EMBEDDING_MODEL` and, for example,
  `OPENAI_API_KEY`, in the environment or in `.env`. In a worktree,
  `DOTENV_CONFIG_PATH` points at another `.env`. Without them, the full-text
  mode runs and the other modes are reported as skipped.

The first run embeds the corpus (about 3,200 chunks, a few cents with
`text-embedding-3-small`) and takes about two minutes. Every vector is cached,
so later runs make no embedding request unless the chunks or queries change.

Options are environment variables:

| Variable | Effect |
|---|---|
| `DOCS_ACCURACY_MODES` | Comma list of `fts`, `vector`, `hybrid`. Default: all three. |
| `DOCS_ACCURACY_LIBRARIES` | Comma list of libraries to score. Compared with the same queries of the baseline. Not allowed when refreshing the baseline. |
| `DOCS_ACCURACY_REUSE_INDEX` | `1` searches the index from the previous run instead of re-indexing. Use it when only ranking code changed; re-index after splitter or pipeline changes. |
| `DOCS_ACCURACY_CACHE_DIR` | Cache location. Default: `.cache/search-accuracy/` in the repository. Point several worktrees at one directory to share downloads and vectors. |

The run fails when chunk-level or page-level MRR, Hit@5 or nDCG@10 of any mode
drops by more than 0.02 at either level, or when the baseline was recorded with
a different corpus, golden set, search configuration or result limit. It also
fails when it scores the vector or hybrid mode with a different embedding model
than the baseline's; run with `DOCS_ACCURACY_MODES=fts` to compare full-text
search alone, or refresh the baseline.

## Reading the results

The summary is printed at the end of the run. `results/report.md` adds every
query whose first rank changed, a breakdown by library, intent and query style
for each mode and level, and the golden passages the splitter cut across
chunks. `results/run.json` has every query's scores.

Modes:

- `fts`: full-text search only, as for a server without embeddings.
- `vector`: the hybrid search query with the full-text weight set to 0, so
  results are ranked by vector distance alone.
- `hybrid`: the default fusion of both.

Levels:

- `store`: the ranked chunks `DocumentStore.findByContent()` returns.
- `final`: the results `search_docs` returns after grouping chunks by page and
  assembling context around them.

Both levels request 10 results; a passage ranked lower counts as a miss.

Scores:

- **Chunk level** counts a result when it is from the passage's page and
  holds the passage. Holding means every word of the passage in order, ignoring
  case, punctuation and Markdown syntax, or an unbroken run of at least half of
  it when the splitter cut the passage across chunks.
- **Page level** counts a result when it is from the passage's page.
- Each passage counts at the rank of the first result holding it, so one
  result holding two passages (an assembled final result, say) counts for both.
- **MRR** is 1 / rank of the first hit. **Hit@k** is 1 when a hit is in the
  top k. **Recall@10** is the share of a query's passages in the top 10.
  **nDCG@10** rewards ranking grade 3 passages above grade 1 ones, with gain
  2^grade − 1; it is capped at 1, which a result holding every passage at the
  top reaches. All are averaged over the queries. **Misses** counts queries
  with no hit in the top 10.

One query moves an average by about 0.008, so look at the per-query changes
before reading a pattern into a small difference.

## The corpus

Indexed pages are recorded under `file:///corpus/<library>@<revision>/…`
instead of the checkout's real path, in the store, in its full-text index and
in the text sent to the embedding provider, so results and cached vectors do
not depend on where the cache lives. Libraries are indexed one page at a time,
because search breaks score ties by row order and concurrent indexing would let
timing decide it.

[`corpus.yaml`](corpus.yaml) pins the Markdown documentation of react.dev
(CC BY 4.0), FastAPI, Vite and Pydantic (MIT) to commit SHAs. Only the listed
files are downloaded, with a sparse checkout, into the cache. All four are
indexed into one store, as a server with several libraries would hold them.

Moving a pin changes the dataset. Run the benchmark: every golden passage is
looked up in the new index, and a passage that is gone stops the run and names
the query. Fix or replace those passages, then refresh the baseline.

## The golden set

[`golden.yaml`](golden.yaml) holds the queries. Each has an `id`, `library`,
`query`, `intent` (`api-lookup`, `how-to`, `conceptual`, `comparison`,
`troubleshooting`), `style` (`keywords`, `identifier`, `question`,
`agent-request`) and one or more `passages`, each with the `page` (relative to
the library's indexed root), the passage `text` and a `grade`: 3 answers the
query directly, 2 answers part of it, 1 is useful context.

To add or change queries:

1. Run the benchmark once so the index exists, then read the chunks of the page
   from `.cache/search-accuracy/store/documents.db` (`documents` joined to
   `pages`), so the passage matches what the pipeline stores.
2. Copy one or two sentences of prose from inside one chunk (8–40 words) that
   answer the query and appear on no other page.
3. Write questions and agent requests the way a user would, without reusing the
   passage's wording; keywords and identifiers are short, as typed into a
   search box.
4. Keep the coverage the loader enforces: at least 100 queries over at least
   four libraries, no library above 40%, every style at 10% or more.
5. Run with `DOCS_ACCURACY_REUSE_INDEX=1` to check the passages, then refresh
   the baseline in the same commit.

The first version of the set was written by a language model from the indexed
chunks and is marked `status: draft` until a person has reviewed it.

## Limitations

- The corpus is Markdown source, so HTML extraction is not measured.
- The crawler reads directories in the order the file system returns, which
  differs between macOS and Linux. Search breaks some score ties by that order,
  so two operating systems can rank a few queries differently. Runs on one
  machine repeat exactly.
- The embedding cache wraps the provider's client. A Gemini model that relies on
  truncating its vectors to the store's dimension is not supported yet.
