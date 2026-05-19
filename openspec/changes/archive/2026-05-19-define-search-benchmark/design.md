## Context

The current evaluation pipeline (`tests/search-eval/` + `npm run evaluate:search`) uses promptfoo with a `gpt-4o-mini` judge, a 5-query React-only dataset, and four assertions of which only one (top-3 ranking) speaks to retrieval quality and only as a binary signal. There is no baseline persistence, no CI integration, and no IR-standard metrics.

This change tightens the *specification* of what the benchmark must do. The implementation question — framework choice, exact judge model, dataset construction process — is a separate set of decisions captured here so the spec can stay framework-agnostic.

Constraints worth naming up front:
- Node 22 + TypeScript repo. The runtime under test is TypeScript; bolting on a Python harness adds cross-language friction unless it earns its keep.
- `SearchTool` returns chunks (URL, content, score), not generated answers. The "RAG generation quality" metrics that some frameworks lead with do not apply.
- LLM-judge calls cost money and have variance. Anything we can make deterministic, we should.

## Goals / Non-Goals

**Goals:**
- A spec the team can defend: "this is what our benchmark measures and why."
- Headline metrics that are standard, deterministic, and comparable across configurations and against external techniques.
- A baseline that lives in the repo and a regression-aware measurement run.
- A clean framework-swap path: if we later migrate harnesses, the spec does not change.

**Non-Goals:**
- Evaluating end-to-end RAG generation (retrieval + LLM answer). Out of scope for this change; may be a follow-up capability.
- PR-blocking CI gating on benchmark results. Variance and cost make this premature; we run on `workflow_dispatch` and a weekly schedule instead.
- Building a benchmark UI/dashboard. JSON output + checked-in baseline + git diff is enough for now.
- Comparing against external systems in this change. The spec must *enable* such comparisons later; doing them is separate work.

## Decisions

### Decision 1: Keep promptfoo as the framework; do not migrate to DeepEval

**Choice:** Continue using promptfoo (invoked via `npx -y promptfoo@<pinned>`), extended with custom JavaScript assertions for IR metrics and baseline comparison.

**Why:**
- `SearchTool` outputs chunks, not generated answers. DeepEval's flagship metrics (Faithfulness, Answer Relevancy) presuppose a generated answer; we'd be using only its `Contextual*` metrics, each of which is itself an LLM-judge call. We get the same signal more cheaply with deterministic IR metrics over qrels.
- DeepEval is Python. Migrating means dual-language tooling, a second package manager in CI, and friction for contributors already comfortable in the TS stack. Earned only if we plan an end-to-end RAG eval; we don't, yet.
- Promptfoo's JS assertions are flexible enough to implement MRR/Recall@k/nDCG/Hit@k directly against `providerOutput.metadata`. No framework limitation forces a migration.

**Alternatives considered:**
- *Migrate to DeepEval (Python).* Rejected for the reasons above. Re-evaluate if/when a "generation" eval stage is added.
- *Custom TypeScript harness, drop promptfoo.* Would work — IR metrics need no framework — but loses promptfoo's LLM-judge plumbing (cross-provider, retries, caching) and report formatting. Net not worth the lift right now.

### Decision 2: IR metrics (MRR, Recall@k, nDCG@k, Hit@k) as headline; LLM-judged metrics secondary

**Choice:** Compute IR metrics deterministically from `providerOutput.metadata.results` against labelled qrels. Report them as the primary numbers. LLM-judged metrics (chunk coherence, faithfulness, answerability) go in a separate section and are *never* aggregated into headline numbers.

**Why:**
- IR metrics are reproducible, cheap, and the field standard. They are what external comparisons will use.
- LLM-judged scores are useful for dimensions IR metrics cannot capture (is a chunk a coherent unit?) but carry variance and cost; conflating them with IR numbers makes regressions ambiguous.

**Alternatives considered:**
- *Single composite quality score.* Rejected — hides where regressions come from and is not comparable across systems.

### Decision 3: Graded qrels, not single `expectedUrl`

**Choice:** Each dataset entry carries `qrels: [{url, grade}]` where `grade` is an integer ≥ 1.

**Why:** A single "right answer" URL is what made the current setup feel arbitrary — multiple documents are typically relevant to a real query, and "how relevant" matters for nDCG. Graded labels also let us write better queries (comparison/troubleshooting often have multiple useful destinations).

**Alternatives considered:**
- *Binary relevance set.* Simpler but loses nDCG's main value. We pay a small annotation cost for graded labels; we keep it because that cost is one-time.

### Decision 4: Judge model — pin to a current model from a major provider with `temperature: 0`

**Choice:** Default judge is `openai:gpt-5.4-mini`. The OpenAI key is already present in `.env`, which removes a setup step and keeps the default-experience friction-free. `gemini-3-flash-preview` and `gemini-3.1-flash-lite` are listed as supported alternatives — both are cheap, fast, and adequate for the rubric-scoring workload. The full judge identifier is configurable via env (`DOCS_EVAL_JUDGE`) or CLI. `temperature: 0`. Deprecated models (e.g. `gpt-4o-mini`, `gpt-3.5-*`) are rejected at startup via an allowlist.

**Why:** A "mini" / "flash-lite" tier judge with anchored rubrics and `temperature: 0` is the sweet spot for this workload — orders of magnitude cheaper than frontier judges, while the calibration gap on a well-anchored rubric is small. Pinning is mandatory because judge drift is otherwise invisible. Starting on OpenAI avoids adding a new API key; Gemini is the natural cost-optimised alternative.

**Cross-judge sampling:** A configurable random subset (e.g. 10 queries) is also scored by a second-provider judge each run (e.g. one of the Gemini flash variants when the primary is OpenAI). The mean absolute delta between judges is reported. This gives us a continuous read on judge variance without paying for every query × two providers.

### Decision 5: Baseline as a checked-in JSON file with relative-tolerance regression checks

**Choice:** `tests/search-eval/baseline.json` contains dataset-level aggregates for every headline metric plus a configuration snapshot. The measurement run loads it, compares, and exits non-zero on relative regression beyond per-metric tolerance (default 5% headline, 10% per-intent). Refreshed only by explicit `npm run evaluate:search:baseline`.

**Why:**
- Git history is the audit trail — when a baseline shifts, the diff and PR explain why.
- JSON keeps the format trivially parseable for CI annotations and future dashboards.
- Per-metric tolerance avoids both flapping (too tight) and silent rot (too loose).

**Alternatives considered:**
- *External tracking service (Confident AI etc.).* Vendor lock-in and another moving part. Defer.
- *Absolute thresholds.* Too brittle as the dataset grows.

### Decision 6: Dataset construction is a separate, explicitly-scoped piece of work

The spec mandates ≥50 queries / ≥5 libraries / multiple intents. *Producing* that dataset is non-trivial and largely manual (or LLM-assisted with human review). It is the largest single task in the rollout and the area most exposed to bias if rushed. The tasks file calls it out as its own milestone.

## Risks / Trade-offs

- **Risk:** Dataset bias — if we generate queries from the same docs we then retrieve, we'll measure surface overlap, not real-world quality. → *Mitigation:* Seed queries from real user-style prompts (GitHub Discussions, Stack Overflow, the project's own issue tracker) before any LLM augmentation, and require human review of every entry.
- **Risk:** Judge drift — a hosted judge model can be silently updated by the provider, shifting scores. → *Mitigation:* Pin to a specific model identifier; cross-judge sampling gives an ongoing variance signal; baseline refresh is explicit and PR-reviewed.
- **Risk:** Eval cost growth — moving from 5 queries to 50+ with a frontier judge increases per-run cost meaningfully. → *Mitigation:* IR metrics make up the bulk of "what we care about" and cost nothing; judge calls can be sampled per CI run and run fully only on baseline refresh and on `workflow_dispatch`.
- **Risk:** False sense of rigour — a 50-query dataset is still small. Statistical confidence on per-intent slices is weak. → *Mitigation:* Report n per slice in every output; do not draw conclusions from differences smaller than the cross-judge variance.
- **Risk:** Library indexing in CI — eval requires `react`, `python`, etc. to be indexed in the store. → *Mitigation:* CI workflow scrapes the required libraries at workflow start (cached by version where possible); local runs fail fast with a clear scrape command if a library is missing.
- **Risk:** Spec/implementation drift — keeping the spec framework-agnostic could let the implementation diverge silently. → *Mitigation:* Each spec requirement maps to an implementation task; the tasks file calls out the mapping.

## Migration Plan

1. Land this proposal + spec (no code changes yet). Use it to align on goals.
2. Build the new dataset incrementally — start with React (5 → 15 queries, graded qrels) to validate the format; expand to four more libraries.
3. Implement IR-metric assertions in `promptfoo.yaml` and a thin TypeScript helper for aggregation.
4. Swap the judge model + rewrite rubrics.
5. Add baseline persistence and the comparison command. Initial baseline is recorded immediately after rollout from a clean measurement run.
6. Add the (non-blocking) CI workflow.
7. Archive the old `evaluate-search-quality` change as superseded.

Rollback: each step is independently revertable. The dataset, baseline, and assertion config are all in `tests/search-eval/`; reverting that directory restores the prior behaviour.

## Open Questions

- Confirm `openai:gpt-5.4-mini` as default once implementation runs the first A/B on the React subset against `gemini-3-flash-preview` / `gemini-3.1-flash-lite`. If a Gemini variant materially outperforms on calibration *and* cost at that scale, switch the default and reuse OpenAI as the cross-judge.
- Exact list of five libraries for the initial dataset. Candidates: React, Python stdlib, FastAPI, Vite, TailwindCSS. Final list deferred to dataset task.
- Should LLM-judged metrics participate in regression checking at all, or only IR metrics? Current proposal: IR metrics gate; LLM scores are observational. Revisit after first month of data.
- Should we also record per-query *latency* of `SearchTool`? Useful for tracking performance regressions but expands scope; flagged for a follow-up.
