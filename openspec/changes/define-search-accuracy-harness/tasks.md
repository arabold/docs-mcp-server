# Tasks

## 1. Corpus

- [ ] 1.1 Write `tests/search-accuracy/corpus.yaml` with react.dev, FastAPI, Vite and Pydantic pinned to commit SHAs, their indexed roots, include globs and licenses; verify each SHA resolves with `gh api repos/<repo>/commits/<sha>`
- [ ] 1.2 Implement `corpus.ts` (`ensureCorpus`: sparse, shallow, blobless checkout per source into `.cache/search-accuracy/corpus/<library>@<revision>/`, reuse when present, `CorpusFetchError` naming library and revision); verify a first call downloads the four sources and a second call makes no `git` network call
- [ ] 1.3 Add `.cache/search-accuracy/` and `tests/search-accuracy/results/` to `.gitignore` and verify `git status` stays clean after a run

## 2. Embedding cache

- [ ] 2.1 Implement `embedding-cache.ts` (`CachingEmbeddings` over a SQLite file keyed by model spec, dimension and text hash; misses batched to the inner client) with `embedding-cache.test.ts` covering hit, miss, partial batch and model isolation; verify with `npx vitest run tests/search-accuracy/embedding-cache.test.ts`

## 3. Golden set format and passage matching

- [ ] 3.1 Implement `golden.ts` (`loadGoldenSet` with the styles, intents, grade range and coverage rules from the spec; `GoldenSetError` lists every problem) and cover the rejection cases in `golden.test.ts`; verify the tests pass
- [ ] 3.2 Implement `passages.ts` (normalization, `matchPassage` returning whole, split or null) with `passages.test.ts` covering links, emphasis, inline code, whitespace and a passage cut across two chunks; verify the tests pass

## 4. Indexing and evaluation

- [ ] 4.1 Add `vite.config.accuracy.ts` (only `tests/search-accuracy/accuracy.eval.ts`, no MSW setup, `.env` loaded, long timeout) and the `evaluate:accuracy` / `evaluate:accuracy:baseline` scripts; verify `npm test` does not run or fetch the benchmark
- [ ] 4.2 Implement indexing in `accuracy.eval.ts`: mock `createEmbeddingModel` to wrap the real client, index every library from its checkout into `index.sqlite` through `PipelineManager`, honour `DOCS_ACCURACY_REUSE_INDEX`; verify the store lists four libraries and a second run sends no embedding request
- [ ] 4.3 Implement `evaluate.ts` (`validatePassages`, `evaluateMode` for `fts`, `vector`, `hybrid` at store and final level, scoring through `tests/search-eval/lib/metrics.cjs` with chunk and page identifiers, breakdowns by library, intent and style) with `evaluate.test.ts` scoring hand-made ranked lists; verify the tests pass and that the vector and hybrid modes report skipped without credentials

## 5. Golden set

- [ ] 5.1 Write about 30 queries per library in `golden.yaml` from the indexed chunks, covering all four styles and the five intents, with graded passages and the attribution header; verify `loadGoldenSet` accepts it and `validatePassages` finds every passage
- [ ] 5.2 Review the set for queries that copy their passage word for word in the question and agent-request styles, and for passages that are split; verify the report lists no split passage that could be replaced by a shorter one

## 6. Baseline and report

- [ ] 6.1 Implement `baseline.ts` (snapshot, comparison with the 0.02 tolerance on MRR, Hit@5 and nDCG@10 at chunk and page level, per-query rank changes, configuration mismatch, report rendering) with `baseline.test.ts`; verify the tests pass
- [ ] 6.2 Record `baseline.json` with `npm run evaluate:accuracy:baseline` and verify `npm run evaluate:accuracy` passes against it with no network access

## 7. Documentation

- [ ] 7.1 Write `tests/search-accuracy/README.md` (run, read the report, add queries, move a pin, provider limitations), add the benchmark to the AGENTS.md test inventory and link it from `docs/guides/benchmarking.md`; verify the documented commands run as written

## 8. Integration

- [ ] 8.1 Run the benchmark on `main` and on the stop-word branch of #556 and post the per-mode comparison on that PR; verify both runs use the same snapshot
- [ ] 8.2 Run `npm run lint`, a cold `npm run typecheck` and `npm test`; verify all pass

## Workflow follow-up

- Archive the change after review, which creates `openspec/specs/search-accuracy/spec.md`.
