## Why

We cannot tell whether a change to search makes it find the right content more often. The existing benchmark (`npm run evaluate:search`) labels whole pages, not the passage that answers a query, runs against whatever each developer happens to have indexed, and needs an LLM judge and a live embedding API. So two runs on two machines, or a week apart, are not comparable, and a change such as dropping stop words from full-text queries (#556), retuning fusion weights, or changing the splitter can only be judged by speed or by eye.

We want one command that answers "does this change rank the right chunk higher or lower, and for which queries?" with the same corpus and labels for everyone, and that can separate the contributions of full-text search, vector search and their fusion.

## What Changes

- Add a search accuracy benchmark that indexes a fixed corpus: Markdown documentation of a few open-licensed projects, fetched at pinned commits and cached locally, then indexed through the real scraping, splitting, embedding and storage pipeline.
- Add a checked-in golden set of about 120 queries. Each query names the passage(s) that answer it, with a relevance grade, so a result counts as correct only when the returned chunk contains that passage. Queries mix styles (keywords, exact identifiers, plain questions, long agent-style requests) and intents.
- Evaluate each query in three modes against the same index: full-text only, vector only, and hybrid (the default fusion). Score both the ranked chunks the store returns and the final results search returns after grouping and assembly.
- Report chunk-level and page-level MRR, Hit@k, Recall@k, nDCG@k and the rank of the first correct chunk, broken down by mode, library, intent and query style.
- Check in a baseline per mode. A measurement run lists every query whose first correct rank moved and fails when a headline metric drops beyond a tolerance; a refresh run rewrites the baseline.
- Cache embeddings on disk by model and text, so after the first run the benchmark runs offline. Without embedding credentials or cached vectors, the full-text mode still runs and the other modes are reported as skipped.
- The existing LLM-judged benchmark stays as it is; this benchmark complements it.

## Capabilities

### New Capabilities
- `search-accuracy`: A reproducible benchmark of retrieval accuracy against a pinned corpus and passage-level golden labels: corpus pinning, golden-set format and validation, evaluation modes and levels, metrics and breakdowns, embedding caching and offline behaviour, baseline comparison and the invocation contract.

### Modified Capabilities
<!-- None. `search-evaluation` keeps its contract; this benchmark is a separate capability. -->

## Impact

- **Code**: New `tests/search-accuracy/` (corpus manifest, golden set, runner, metrics, baseline) and a Vitest config for it. No production code changes.
- **Scripts**: `npm run evaluate:accuracy` (measure against the baseline) and `npm run evaluate:accuracy:baseline` (refresh it).
- **Dependencies**: None added. The corpus is fetched with `git`; embeddings use the configured provider.
- **Disk and network**: The first run downloads about 6 MB of Markdown and embeds about 1.5M tokens (a few cents with `text-embedding-3-small`). Later runs reuse the cache under a gitignored directory.
- **Licensing**: The corpus is downloaded, not committed. The golden set quotes short passages from the corpus (CC BY 4.0 for react.dev, MIT for the others), with attribution in the dataset header.
- **CI**: Not part of `npm test`. Wiring it into CI is a follow-up.
