## Why

The existing search evaluation (`npm run evaluate:search`, shipped via the unarchived `evaluate-search-quality` change) is too weak to defend the claims we make about retrieval quality: 5 React-only queries, a single binary "top-3" ranking check, two LLM-rubric scores from an outdated `gpt-4o-mini` judge, no information-retrieval (IR) metrics, no baseline persistence, no CI integration. We cannot meaningfully say "this change improved search" or "we are competitive with technique X" because the harness produces noisy, low-coverage, non-comparable numbers.

We want a benchmark that (a) yields a defensible baseline for the MCP server's search behaviour, (b) is sensitive enough to detect real regressions and improvements, and (c) can be re-run unchanged when we later compare against alternative retrieval techniques (different embeddings, rerankers, chunking strategies, or external services).

## What Changes

- **BREAKING** Replace the 5-query React-only dataset with a labelled, multi-library qrel dataset (target: ≥50 queries, ≥5 libraries, mixed query intents). Each query carries a *set* of relevant document URLs with graded relevance, not a single `expectedUrl`.
- Add deterministic IR metrics computed against the qrels: `MRR`, `Recall@k`, `nDCG@k`, `Hit@k`. These become the headline numbers; LLM-judged scores are secondary signal.
- Modernize the LLM judge: pin to a current model (e.g. `gpt-5` or `claude-sonnet-4-6`), set `temperature: 0`, rewrite rubrics with concrete anchor examples per score, and add a periodic cross-judge sanity sample to estimate judge variance.
- Refocus LLM-judged dimensions on what IR metrics cannot capture: **chunk coherence** (is each returned chunk a self-contained unit?), **content faithfulness to the source**, and **answerability** (could a downstream LLM answer the query from these chunks alone?). Retain the deterministic code-block integrity check.
- Persist a checked-in baseline (`baseline.json`) plus a regression-comparison command that fails the run when headline metrics drop beyond a defined tolerance.
- Define the benchmark as **framework-agnostic at the spec level**: requirements describe inputs, metrics, outputs, and regression behaviour, not whether the harness is promptfoo, DeepEval, or custom TypeScript. Implementation choice is deferred to `design.md`.
- Document the benchmark's scope explicitly: it measures *retrieval* quality of `SearchTool` output, not end-to-end RAG generation. A future change may extend it to generation.

## Capabilities

### New Capabilities
- `search-evaluation`: Defines the search-quality benchmark — its dataset format, required metrics (IR + LLM-judged), judge configuration, baseline persistence, regression behaviour, and invocation contract. Supersedes the informal spec embedded in the unarchived `evaluate-search-quality` change.

### Modified Capabilities
<!-- None. No live spec exists for search evaluation yet (the prior change never archived). -->

## Impact

- **Code**: `tests/search-eval/` is restructured — `dataset.yaml` schema changes (breaking for anyone consuming it directly), assertion configuration changes, new metrics/baseline helpers added. `src/tools/search-provider.ts` may need to expose additional fields (e.g. chunk boundaries) for new judges.
- **Scripts**: `npm run evaluate:search` keeps its name but its output and exit-code semantics change (regression-aware). New `npm run evaluate:search:baseline` to refresh the checked-in baseline.
- **Dependencies**: No new runtime deps. Eval-time dependencies (judge model, possibly a new harness package via `npx -y`) are picked in `design.md`.
- **Cost**: Each full eval run will make more LLM-judge calls (larger dataset × modern model). Mitigated by IR metrics being deterministic and free, and by running judges only on a sampled subset per CI run unless explicitly requested.
- **CI**: Benchmark is *not* gated on every PR. It runs on `workflow_dispatch` and a weekly schedule; results are posted as a comment/artifact. PR-blocking is out of scope for this change.
- **Prior art**: The unarchived `evaluate-search-quality` change should be archived (or explicitly superseded) as a follow-up; its `search-evaluation` spec definition is replaced by the one introduced here.
