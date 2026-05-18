## Context

The benchmark exists so we can measure retrieval quality and detect drift. Once the local baseline existed, the natural next question was "compared to what?" Context7 is the obvious peer — same product category, different design philosophy (raw page chunks vs curated snippets + summaries). The benchmark spec was deliberately written framework- and dataset-pinned so this comparison was possible without rebuilding anything; this change supplies the missing plumbing.

## Goals / Non-Goals

**Goals:**

- Make adding a new retrieval provider one entry in a registry + one exec-provider script.
- Keep the default behaviour (local provider, canonical baseline) bit-for-bit unchanged.
- Have a single, in-repo, reproducible record of "how we compare to Context7 right now" that updates the same way every other baseline does.
- Tell two-summary stories cleanly: one CLI that diffs A vs B and prints the result, no dashboard, no service.

**Non-Goals:**

- Run multiple providers in a single promptfoo invocation. Per-provider runs are cheap to schedule and easier to reason about than per-provider columns in one giant report.
- Force every provider to a single transport (HTTP, MCP, stdio, etc.). The exec-provider contract is "a script that prints a JSON line"; how it gets the data is its problem.
- Build a generic plugin API. Two implementations is too few to abstract from. The registry is a `Record<string, ProviderSpec>` — three fields per entry. We'll grow shape from the third or fourth provider.

## Decisions

### Decision 1: Provider selection via env var + checked-in registry

**Choice:** `DOCS_EVAL_PROVIDER` env var picks a name from a `PROVIDERS` registry in `tests/search-eval/run.ts`. Default is `local`.

**Why:**

- Matches the existing pattern for `DOCS_EVAL_JUDGE`, `DOCS_EVAL_DATASET`, `DOCS_EVAL_TOP_K`, etc. — single mental model.
- The registry is the obvious place to look when adding a provider; no convention-over-configuration magic.
- Keeps the promptfoo config single-file: provider id is `{{env.DOCS_EVAL_PROMPTFOO_PROVIDER}}`, set by the orchestrator after the registry lookup.

**Alternatives considered:** parallel `promptfoo.<provider>.yaml` files (duplicative); CLI flag instead of env (inconsistent with the rest of the env-var-driven contract); auto-discovering providers via filename pattern (too cute).

### Decision 2: Per-(dataset, provider) baseline files

**Choice:** Baseline path is derived deterministically from `(datasetPath, providerName)`:

- canonical dataset + `local` → `tests/search-eval/baseline.json` (unchanged)
- canonical dataset + non-local → `tests/search-eval/baseline.<provider>.json`
- non-canonical dataset → sibling `<stem>[.provider].baseline.json`

**Why:** A baseline must self-identify; otherwise the comparator can't tell whether numbers are comparable. Encoding the provider into the filename also prevents the "ran smoke against Context7 and accidentally overwrote the canonical local baseline" footgun.

**Alternatives considered:** put provider into the JSON only (file collisions remain); put provider into the JSON AND prompt to confirm overwrite (slow, modal); always require an explicit `--baseline-out` flag (chore for the common case).

### Decision 3: Context7 provider is pure Node, not TypeScript

**Choice:** `tests/search-eval/context7-provider.cjs` runs under plain `node` via a thin bash shim, with no `vite-node`, no docs-mcp-server imports, and no `better-sqlite3` linkage.

**Why:** Provider cold-start dominates per-query wall time for the local provider (~5s of vite-node + docs store init). Context7 has none of that overhead and shouldn't inherit it. Pure-Node start is ~100ms. The script's logic — argv parsing, HTTPS GET, URL normalisation, JSON shape — is small enough that not pulling in the full TS toolchain costs nothing in maintainability.

### Decision 4: URL normalisation lives in the provider, not in the comparator or qrels

**Choice:** The Context7 provider normalises returned URLs to the form used in our qrels (strip trailing `/`, strip `?…`, transform Tailwind GitHub source paths to live docs URLs). The qrels stay in their canonical form; the comparator does string equality.

**Why:** The IR metric assertions are shared between providers and must remain dataset-only-aware. Pushing the per-provider URL knowledge to the provider keeps the contract surface small (`url` matches `qrel.url`, exactly). It also keeps each provider's normalisation reviewable in one file, where the maintainer can grep for the live URL form.

**Alternative considered:** make the comparator URL-fuzzy (substring match, slash-tolerant). Rejected because that loosens the semantics for *all* providers and obscures regressions where the local provider returns an unexpectedly slightly-different URL.

### Decision 5: Cross-provider numeric comparison is opt-in via the comparison CLI, not run.ts

**Choice:** The orchestrator never compares a provider-A run against a provider-B baseline — that's a config incompatibility that the comparator skips. The `compare-providers.ts` CLI is the supported way to see A vs B; it loads two baselines and prints the side-by-side report.

**Why:** Regression gating only makes sense within a single (dataset, provider) lineage. Mixing them produces false regressions/improvements that mislead a "did our last change help?" question. A dedicated CLI makes the cross-comparison explicit, with proper labelling.

## Risks / Trade-offs

- **Risk:** Context7 silently changes its `codeId`/`pageId` URL form. → *Mitigation:* The URL-normalisation step is one function with library-specific branches; structural test queries (e.g. periodic CI run) would catch any drift. The IR metrics dropping for one library is a loud signal that this normalisation broke.
- **Risk:** Anonymous public endpoints get rate-limited mid-run, producing inconsistent baselines. → *Mitigation:* Provider already supports `CONTEXT7_API_KEY` for authenticated calls. The 60-query benchmark fits in Context7's free tier; for CI use, a key is recommended.
- **Risk:** Context7's `infoSnippets` use `<lib>/llms.txt` as a placeholder pageId; if these dominate a response, URL-matching becomes meaningless. → *Mitigation:* The provider currently drops `llms.txt` URLs rather than poisoning IR metrics. Document this as a known asymmetry in the comparison report; if it skews any future Context7-vs-X comparison, revisit.
- **Risk:** The faithfulness rubric is unfair to summarised content. → *Mitigation:* The rubric was already rewritten (in this PR's parent commits) to score "plausibility and internal consistency" rather than literal source fidelity; Context7 currently scores 4.24 on it, suggesting the rewrite is fair. Worth re-validating with a sample inspection.
- **Trade-off:** Per-provider baselines mean N×M baseline files for N datasets × M providers. For our current scale (1 canonical dataset, 1 smoke dataset, ≤2 providers) this is 4 files maximum — trivial. The pattern scales linearly; if we ever hit ≥4 providers we'd want a baseline directory rather than flat files.

## Migration Plan

1. Land this proposal + spec (no behaviour change).
2. Land the Context7 provider script + orchestrator changes. Existing local users see no difference unless they set `DOCS_EVAL_PROVIDER`.
3. Record the first Context7 baseline against the canonical dataset. Check in.
4. Document the comparison flow in `docs/guides/benchmarking.md`.
5. Optionally: wire a scheduled CI job that re-records both baselines weekly and posts the comparison report as a workflow summary. (Not in this change.)

Rollback: deleting `tests/search-eval/context7-provider.cjs`, `run-context7-provider.sh`, and the orchestrator's `DOCS_EVAL_PROVIDER` plumbing returns the benchmark to single-provider behaviour without affecting recorded local baselines.

## Open Questions

- Should the comparator CLI also emit a machine-readable JSON diff for downstream automation (e.g. a future "post comparison results to a PR" step)? Defer until we have a consumer asking for it.
- Once we have ≥3 providers, do we want a `providers/<name>/` directory layout instead of flat `*-provider.cjs` + `run-*-provider.sh` pairs? Defer.
- Faithfulness is materially asymmetric between providers (curated snippets score higher than raw page chunks even under the rewritten rubric). Is that *fair*, or does the rubric need another pass? Flagged as a follow-up investigation — see the comparison report; not blocking this change.
