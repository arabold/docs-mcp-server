## Why

The search-quality benchmark exists so we can answer "is our retrieval competitive with the alternatives?" The spec was deliberately designed to support that comparison (framework-agnostic, dataset-pinned, judge-pinned). What the spec doesn't yet specify is the *contract* by which a non-local retrieval service can be plugged in and measured under the same conditions.

We want to compare against Context7 today. We want to compare against whatever-comes-next without rewriting plumbing. And we want both comparisons to live in the repo as data, not in a doc as anecdote.

## What Changes

- Add a **provider-selection contract** to the benchmark: a single env var (`DOCS_EVAL_PROVIDER`) chooses which retrieval service the eval drives. Existing local behaviour is the default; adding a new provider is one entry in a registry + one exec-provider shim.
- Add a **Context7 provider** (the first non-local one) — a pure-Node exec shim that calls Context7's public `/v2/context` HTTP endpoint, normalises returned URLs to the form our qrels use, and emits the same JSON contract as the local provider.
- Specify **per-(dataset, provider) baseline file naming** so running the eval against Context7 doesn't overwrite the local baseline, and vice versa. The canonical `tests/search-eval/baseline.json` remains the local-against-the-canonical-dataset baseline; everything else gets a suffixed sibling file.
- Add a **side-by-side comparison report** that diffs two recorded baselines (e.g. local vs Context7) and prints IR/LLM-judged/structural deltas with a "winner per metric" tally.
- Check in the **first cross-system baseline**: `tests/search-eval/baseline.context7.json`, recorded against the same dataset under the same judge, so the comparison is reproducible from a `git pull`.
- Capture the headline finding in docs: local wins IR (URL-grounded retrieval), Context7 wins LLM-judged content quality, with a non-trivial per-intent split.

No breaking changes. The default (no env var) behaviour is unchanged; `npm run evaluate:search` still drives the local SearchTool against `baseline.json`.

## Capabilities

### New Capabilities
<!-- No new capabilities. -->

### Modified Capabilities
- `search-evaluation`: extends the existing spec with multi-provider support, per-(dataset, provider) baseline naming, and a comparison-report contract. The previous single-provider behaviour is preserved as the default.

## Impact

- **Code**: small additions under `tests/search-eval/` (one provider script, one bash shim, one comparison report CLI, ~70 lines of orchestrator changes). Type additions in `tests/search-eval/types.ts` (`provider` field on `RunConfigSnapshot`).
- **Config**: `tests/search-eval/promptfoo.yaml` provider line templated via env vars so we can switch without parallel configs.
- **Baselines**: new file `tests/search-eval/baseline.context7.json` checked in alongside the existing local baseline.
- **Docs**: new "Compare against another retrieval service" section in `docs/guides/benchmarking.md`; updated file-layout in `tests/search-eval/README.md`.
- **Operational**: Context7's public endpoints currently respond to anonymous requests within reasonable use; long-running CI would want a `CONTEXT7_API_KEY` env var (already supported by the provider script).
- **Spec deltas**: documented in `specs/search-evaluation/spec.md` of this change.
