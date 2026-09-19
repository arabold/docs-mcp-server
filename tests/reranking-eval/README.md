# ONEC reranking release gate

This evaluation runs the immutable 40-query `ONEC_ERP_IMPLEMENTATION` dataset
through Baseline Ranking, Voyage reranking with 30 and 50 Search Candidates,
and forced Fail-open Search. The runner exits non-zero until every release check
for the selected production configuration passes.

## Inputs

The runner requires these environment variables:

- `DOCS_RERANK_EVAL_DATASET`: path to the original dataset whose SHA-256 is
  `6e048569089ec05445f73a1d67975290bc7554357a691e7c0c8d053a802161c5`;
- `DOCS_RERANK_EVAL_STORE`: directory containing a transactionally consistent
  live `documents.db` snapshot;
- `DOCS_RERANK_EVAL_OUTPUT_JSON`: safe full-evidence output path;
- `DOCS_RERANK_EVAL_OUTPUT_MARKDOWN`: safe summary output path;
- `OPENAI_API_KEY` and `OPENAI_API_BASE`: credentials and endpoint for the
  production-equivalent BGE-M3 query embedding provider;
- `VOYAGE_API_KEY`: Voyage credential used by the built-in reranker.

Run under Node.js 22:

```bash
npm run evaluate:reranking
```

The report records safe operational aggregates and sanitized failure categories:
dataset and snapshot hashes, all deterministic metrics and intent breakdowns,
per-query ranks, candidate and page counts, token use, tariff cost, latency
distributions, provider failures, fallback counts, wins/ties/losses, the selected
candidate limit, and every gate.

The runner treats an absolute MRR or nDCG@5 gain of at least `0.01` as material.
When 50 candidates do not reach that threshold without losing Recall@30, the
selected production configuration remains 30 candidates.
