# Spec delta: Search Evaluation — multi-provider support

This delta extends the `search-evaluation` capability introduced by
`define-search-benchmark`. It adds the provider-selection contract, the
per-(dataset, provider) baseline naming rule, and the cross-baseline
comparison-report contract. Existing requirements (dataset shape, IR
metrics, LLM judges, regression tolerances, framework-agnosticism) are
unchanged.

## ADDED Requirements

### Requirement: Provider Selection Contract

The benchmark MUST support running against multiple retrieval providers under
the same dataset, judge, and metric definitions, so cross-system comparisons
are apples-to-apples. The selected provider MUST be controlled by a single
environment variable; the default MUST be the in-repo `SearchTool`-backed
provider.

A provider implementation is a script the benchmark invokes once per query.
Its stdout MUST be a single JSON line matching the contract documented in
the spec's IR-metrics requirement: `{ output, metadata: { library, query,
results: [{ url, score, position, content }] } }`. Beyond that, the
provider is free to source results from anywhere (local store, remote API,
etc.).

#### Scenario: Default provider is `local`
- **GIVEN** no `DOCS_EVAL_PROVIDER` environment variable is set
- **WHEN** the benchmark runs
- **THEN** it uses the in-repo `SearchTool` provider (the existing default)
- **AND** writes to the canonical baseline file `tests/search-eval/baseline.json`

#### Scenario: A non-default provider is selectable
- **GIVEN** `DOCS_EVAL_PROVIDER` is set to a registered provider name (e.g. `context7`)
- **WHEN** the benchmark runs
- **THEN** it invokes that provider's exec script for every query
- **AND** writes to a suffixed baseline file (see baseline-naming requirement below)
- **AND** the run config snapshot in `summary.json` records the provider name

#### Scenario: Unknown provider fails fast
- **GIVEN** `DOCS_EVAL_PROVIDER` is set to a name not in the provider registry
- **WHEN** the benchmark starts
- **THEN** it exits non-zero before invoking any provider, naming the unknown
  provider and listing the registered ones

### Requirement: Preflight Gated on Provider Need

Library indexing preflight (verifying the local store contains every library
referenced in the dataset) MUST run only when the selected provider depends on
the local store. Non-local providers MUST skip preflight; a missing local index
is irrelevant to them.

#### Scenario: Local provider runs preflight
- **GIVEN** the local provider is selected
- **WHEN** the benchmark starts
- **THEN** preflight runs and the eval refuses to proceed if a library is missing

#### Scenario: Non-local provider skips preflight
- **GIVEN** `DOCS_EVAL_PROVIDER=context7` (or any other non-local provider)
- **WHEN** the benchmark starts
- **THEN** preflight is skipped and the eval proceeds regardless of local store state

### Requirement: Per-(Dataset, Provider) Baseline Naming

Every (dataset, provider) pair MUST resolve to its own baseline file so that
no run silently overwrites another's reference. Naming is deterministic so
the path can be derived from the dataset path and provider name without
configuration.

#### Scenario: Canonical dataset + local provider keeps canonical name
- **GIVEN** dataset = `tests/search-eval/dataset.yaml`, provider = `local`
- **WHEN** a baseline is recorded
- **THEN** it is written to `tests/search-eval/baseline.json`

#### Scenario: Canonical dataset + non-local provider
- **GIVEN** dataset = `tests/search-eval/dataset.yaml`, provider = `context7`
- **WHEN** a baseline is recorded
- **THEN** it is written to `tests/search-eval/baseline.context7.json`

#### Scenario: Non-canonical dataset (e.g. smoke)
- **GIVEN** dataset = `tests/search-eval/dataset.smoke.yaml`, provider = `<P>`
- **WHEN** a baseline is recorded
- **THEN** it is written to a sibling file of the dataset:
  `tests/search-eval/dataset.smoke.baseline.json` (when P=local) or
  `tests/search-eval/dataset.smoke.<P>.baseline.json` (otherwise)

### Requirement: Cross-Provider Baseline Compatibility Check

The regression comparator MUST treat the selected provider as a config-
compatibility field: a measurement run against provider A MUST NOT be
compared numerically to a baseline recorded under provider B. Doing so
produces meaningless regression signals.

#### Scenario: Mismatched provider is reported as incompatible
- **GIVEN** baseline recorded under provider `context7`
- **AND** a measurement run under provider `local`
- **WHEN** `compare()` runs
- **THEN** it reports an incompatibility (`provider: baseline="context7" current="local"`)
- **AND** skips numeric regression classification
- **AND** the orchestrator exits zero (no false regression)

### Requirement: Cross-Baseline Comparison Report

The benchmark MUST provide a CLI that compares two recorded baselines and
prints a side-by-side report covering IR metrics, per-intent breakdown,
LLM-judged metrics, and structural pass-rates. The report MUST surface
config incompatibilities (different dataset, judge, embedding model, or
top-k) loudly rather than silently comparing across them.

#### Scenario: Side-by-side comparison
- **GIVEN** two baseline files recorded against the same dataset and judge
- **WHEN** the comparison CLI is invoked with both paths
- **THEN** stdout shows a table for each metric category with values for A, values for B, and the relative delta (B vs A)
- **AND** a coarse tally of "wins per side" across all numeric metrics

#### Scenario: Cross-config baselines are flagged
- **GIVEN** two baselines recorded under materially different config (e.g. different judge or different dataset)
- **WHEN** the comparison CLI runs
- **THEN** the incompatibility is listed in the report header
- **AND** the per-metric table is still produced (best-effort) but readers are warned the comparison is not apples-to-apples

### Requirement: Context7 Provider Implementation

The Context7 provider, as the first non-local implementation, MUST be a
pure-Node exec-provider script (no `vite-node`, no docs-mcp-server
imports). It MUST read library identifiers from a maintained map, call
Context7's public `/v2/context` endpoint, normalise returned URLs to the
form used in `dataset.yaml`'s qrels, and emit the same provider-output
JSON contract as the local provider.

The provider MUST honour `DOCS_EVAL_TOP_K` and MUST accept an optional
`CONTEXT7_API_KEY` env var (for authenticated calls) while functioning
against anonymous public endpoints when no key is set.

#### Scenario: URL normalisation per library
- **GIVEN** Context7 returns chunks with attribution URLs that differ from the
  canonical doc-site form (e.g. GitHub source paths for TailwindCSS, no-
  trailing-slash variants for FastAPI)
- **WHEN** the provider emits results
- **THEN** every URL is transformed to the canonical doc-site form used in
  `dataset.yaml` qrels, so IR metrics can match by string equality

#### Scenario: Provider-output contract
- **WHEN** the Context7 provider runs for a query
- **THEN** its stdout is a single line of JSON of shape
  `{ output, metadata: { library, query, provider: "context7", results: [{ url, score, position, content }] } }`

#### Scenario: Anonymous endpoint usage is supported but discouraged for sustained use
- **GIVEN** `CONTEXT7_API_KEY` is not set
- **WHEN** the provider runs
- **THEN** it makes the request anonymously and succeeds against Context7's
  public endpoints
- **AND** for sustained or CI use, an API key SHOULD be provided to avoid
  rate-limit surprises
