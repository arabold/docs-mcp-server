## 1. Provider registry + selection plumbing

- [x] 1.1 Add `provider` field (string) to `RunConfigSnapshot` in `tests/search-eval/types.ts`
- [x] 1.2 Add `PROVIDERS` registry + `resolveProvider()` to `tests/search-eval/run.ts` with `local` and `context7` entries
- [x] 1.3 Read `DOCS_EVAL_PROVIDER` env (default `local`); fail fast on unknown values
- [x] 1.4 Gate preflight on `providerSpec.needsPreflight` so non-local providers skip the local-store check
- [x] 1.5 Pass `DOCS_EVAL_PROMPTFOO_PROVIDER` and `DOCS_EVAL_PROMPTFOO_LABEL` to promptfoo so the provider line is templated
- [x] 1.6 Template the provider id/label in `tests/search-eval/promptfoo.yaml`
- [x] 1.7 Record the resolved provider in the run config snapshot

## 2. Baseline file naming

- [x] 2.1 Extend `baselinePathFor(datasetPath, provider)` to derive `(dataset, provider)`-keyed paths
- [x] 2.2 Preserve `tests/search-eval/baseline.json` for canonical dataset + local provider (no breaking rename)
- [x] 2.3 Add `provider` to `CONFIG_KEYS_REQUIRING_MATCH` in `tests/search-eval/compare.ts` so cross-provider numeric comparison is flagged as incompatible
- [x] 2.4 Update `aggregate.ts`'s standalone CLI to populate the new field

## 3. Context7 provider

- [x] 3.1 Add `tests/search-eval/context7-provider.cjs` — pure-Node script that hits `/v2/context`, normalises URLs, emits the provider JSON contract
- [x] 3.2 Per-library URL normalisation: Tailwind GitHub source paths → live docs URLs; trim trailing `/` and `?…` everywhere; drop `<lib>/llms.txt` placeholder URLs
- [x] 3.3 Maintain a `LIBRARY_MAP` of our library names to Context7 library IDs (chosen via `/v2/libs/search` for highest benchmarkScore against the doc-site we benchmark)
- [x] 3.4 Honour `DOCS_EVAL_TOP_K` and accept optional `CONTEXT7_API_KEY`
- [x] 3.5 Add `tests/search-eval/run-context7-provider.sh` shim using the same Node-pinning pattern as the local shim

## 4. Comparison report

- [x] 4.1 Add `tests/search-eval/cli/compare-providers.ts` — loads two baselines, prints a side-by-side report with IR / per-intent / LLM / structural sections and a coarse winner tally
- [x] 4.2 Surface config incompatibilities (different dataset/judge/embedding/topK) loudly in the report header
- [x] 4.3 Infer the provider label from the baseline filename when the legacy baseline doesn't have a `provider` field

## 5. Record canonical baselines

- [x] 5.1 Record `tests/search-eval/baseline.context7.json` against the full dataset with `DOCS_EVAL_PROVIDER=context7 DOCS_EVAL_NO_CACHE=1`
- [ ] 5.2 Re-record `tests/search-eval/baseline.json` so its config snapshot carries the new `provider: "local"` field (the existing baseline pre-dates the schema bump). Recording is mechanical; metrics should match within judge variance.

## 6. Documentation

- [ ] 6.1 Add a "Compare against another retrieval service" section to `docs/guides/benchmarking.md` covering the env var, the per-provider baseline path, the comparison CLI, and an example invocation
- [ ] 6.2 Update file layout in `tests/search-eval/README.md` to list the new files (provider script, shim, baseline)
- [ ] 6.3 Capture the first cross-system finding (local wins IR, Context7 wins LLM-judged) in the operator guide so the comparison is reproducible from docs alone

## 7. Follow-up flagged, not implemented in this change

- [ ] 7.1 Investigate the faithfulness gap (local 3.27 vs Context7 4.24): are our chunks actually less faithful, or is the rubric leaking chunking quality into a faithfulness score? Separate investigation; the rubric may need another revision pass.
- [ ] 7.2 Investigate per-intent deficits, especially troubleshooting (the only intent where Context7 beats us). Independent agents to red-team why we under-rank, with concrete improvement suggestions.
