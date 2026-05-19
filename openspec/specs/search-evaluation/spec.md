# search-evaluation Specification

## Purpose
Defines the retrieval-quality benchmark contract, dataset expectations, metrics, baseline handling, and invocation behavior for search evaluation.

## Requirements
### Requirement: Benchmark Scope and Subject Under Test

The benchmark MUST evaluate the retrieval behaviour of the `SearchTool` in this repository — that is, the ranked list of document chunks returned for a given (library, query) pair — and MUST NOT evaluate end-to-end RAG generation. The subject under test is a single configuration of the MCP server (embedding model, chunking, ranking, store). When configuration changes, results from previous configurations remain comparable only if dataset and metric definitions are unchanged.

#### Scenario: Retrieval-only scope is enforced
- **WHEN** the benchmark is executed against the `SearchTool`
- **THEN** every metric is computed from the returned chunks (URL, content, score, position) and the labelled qrels
- **AND** no metric depends on a downstream LLM-generated answer

#### Scenario: Configuration is captured per run
- **WHEN** the benchmark run starts
- **THEN** the run record MUST include the embedding model identifier, chunking parameters, top-k, and judge model identifier
- **AND** these are persisted alongside metric outputs so that two runs can be compared meaningfully

### Requirement: Labelled Dataset with Graded Qrels

The benchmark MUST be driven by a checked-in dataset of `(library, query, qrels)` tuples, where `qrels` is a list of one or more document URLs each annotated with a graded relevance label (integer ≥ 1; higher = more relevant). The dataset MUST cover at least five distinct libraries and at least fifty queries in total, with a documented mix of query intents (API lookup, conceptual, comparison, troubleshooting).

#### Scenario: Multi-library coverage
- **GIVEN** the dataset file
- **WHEN** queries are grouped by `library`
- **THEN** at least five distinct libraries are present
- **AND** no single library accounts for more than 50% of queries

#### Scenario: Graded relevance, not binary
- **GIVEN** a query in the dataset
- **WHEN** its `qrels` are read
- **THEN** each entry has a `url` and an integer `grade ≥ 1`
- **AND** at least one query in the dataset uses more than one distinct grade value (to confirm graded labels are exercised)

#### Scenario: Query-intent diversity is declared
- **GIVEN** the dataset
- **WHEN** the benchmark loads it
- **THEN** every query carries an `intent` tag drawn from a defined enum (e.g. `api-lookup`, `conceptual`, `comparison`, `troubleshooting`)
- **AND** the benchmark report breaks down headline metrics by intent

#### Scenario: Required libraries are indexed before the run
- **GIVEN** the dataset references library `L`
- **WHEN** the benchmark starts and `L` is not present in the store
- **THEN** the benchmark fails fast with a message naming `L` and the scrape command needed to index it

### Requirement: Deterministic IR Metrics Are Primary

For each query the benchmark MUST compute the following IR metrics against the qrels and report both per-query values and dataset-level aggregates:

- `MRR` (Mean Reciprocal Rank of the first relevant hit),
- `Recall@k` for `k ∈ {3, 5, 10}`,
- `nDCG@k` for `k ∈ {5, 10}` using the graded qrel labels,
- `Hit@k` for `k ∈ {1, 3, 5}`.

These metrics MUST be computed deterministically from the ranked URL list returned by `SearchTool` — no LLM calls — and MUST be the headline numbers reported by the benchmark.

#### Scenario: IR metrics require no LLM call
- **WHEN** IR metrics are computed for a run
- **THEN** the process does not invoke any external LLM API for those metrics
- **AND** rerunning the same `(dataset, search output)` pair yields identical metric values

#### Scenario: nDCG uses graded labels
- **GIVEN** a query whose qrels assign different grades to different URLs
- **WHEN** `nDCG@k` is computed
- **THEN** higher-graded URLs ranked above lower-graded URLs produce a higher score than the reverse ordering

#### Scenario: Headline output
- **WHEN** the benchmark completes
- **THEN** stdout (or the report artifact) shows dataset-level `MRR`, `Recall@5`, `nDCG@5`, `Hit@3` clearly labelled
- **AND** per-intent breakdowns of the same metrics are included

### Requirement: LLM-Judged Metrics Cover What IR Cannot

The benchmark MUST also compute LLM-judged metrics for dimensions that cannot be derived from qrels alone:

- **Chunk coherence** (1–5): is each returned chunk a self-contained unit, or does it begin/end mid-thought or mid-code-block?
- **Content faithfulness** (1–5): does the chunk content faithfully reflect the source document, with no hallucinated text introduced by chunking?
- **Answerability** (1–5): could a downstream LLM plausibly answer the query using only the returned chunks?

Each rubric MUST define concrete anchor examples for scores 1, 3, and 5. LLM-judged scores MUST NOT be aggregated into the headline IR numbers; they are reported as a separate section.

#### Scenario: Rubrics have anchored scales
- **GIVEN** any LLM-judged metric configured in the benchmark
- **WHEN** its rubric is inspected
- **THEN** it defines distinguishing language for scores 1, 3, and 5 and references the dimension by name

#### Scenario: LLM scores are reported separately
- **WHEN** the benchmark report is produced
- **THEN** IR metrics and LLM-judged metrics appear in separate clearly labelled sections
- **AND** no composite "overall score" mixes the two

### Requirement: Deterministic Structural Checks

The benchmark MUST run deterministic structural checks on returned chunks, independent of any LLM, and report pass-rate per check. At minimum:

- **Code-block balance**: the count of triple-backtick fences in each chunk MUST be even.
- **Non-empty content**: every returned chunk MUST have non-whitespace content.
- **URL presence**: every returned result MUST carry a non-empty `url`.

#### Scenario: Unbalanced code block fails the check
- **GIVEN** a returned chunk containing an odd number of triple-backtick fences
- **WHEN** the code-block-balance check runs
- **THEN** that chunk is reported as failing the check
- **AND** the per-query and dataset-level pass-rate decrease accordingly

#### Scenario: Structural checks do not call an LLM
- **WHEN** structural checks run
- **THEN** no external LLM API call is made for them

### Requirement: Modern, Pinned LLM Judge with Variance Control

When LLM-judged metrics are computed the benchmark MUST use a judge model that is:

- explicitly pinned to a model identifier in configuration (no implicit defaults),
- a currently supported, non-deprecated model from a major provider (OpenAI, Anthropic, or Google),
- invoked with `temperature: 0` (or the provider equivalent).

The configuration MUST support running an optional **cross-judge sample** in which a randomly drawn subset of queries is also scored by a second judge model from a different provider, and the report MUST include the per-metric agreement (e.g. mean absolute score delta) between primary and secondary judges on that sample.

#### Scenario: Outdated judge is rejected
- **GIVEN** the judge is configured as a model marked deprecated in the benchmark's allowlist
- **WHEN** the benchmark starts
- **THEN** it exits with a non-zero status and names the deprecated model

#### Scenario: Cross-judge agreement is reported
- **GIVEN** cross-judge sampling is enabled with sample size `n`
- **WHEN** the benchmark completes
- **THEN** the report includes, for each LLM-judged metric, the primary judge's mean score on the sample, the secondary judge's mean score on the same sample, and the mean absolute delta

#### Scenario: Determinism on judge side
- **WHEN** an LLM judge is invoked
- **THEN** the invocation specifies `temperature: 0` (or provider equivalent)

### Requirement: Checked-In Baseline and Regression Behaviour

The repository MUST contain a checked-in baseline artifact (e.g. `tests/search-eval/baseline.json`) capturing the dataset-level aggregate of every headline metric plus the configuration captured at the time the baseline was recorded. The benchmark MUST support two invocations:

- a **measurement** run that computes metrics and compares them against the checked-in baseline, exiting non-zero when any headline metric regresses beyond a configured tolerance;
- a **baseline-refresh** run that overwrites the baseline artifact with the current results and exits zero.

Tolerances MUST be defined per metric in configuration (default: regression flagged when a headline metric drops by more than 5% relative, or when any per-intent breakdown drops by more than 10% relative).

#### Scenario: Regression fails the measurement run
- **GIVEN** the checked-in baseline `MRR` is `0.62`
- **AND** the configured tolerance for `MRR` is 5% relative
- **WHEN** a measurement run produces `MRR = 0.55`
- **THEN** the benchmark exits non-zero
- **AND** the report names `MRR` as regressed with both values and the relative delta

#### Scenario: Improvement does not fail the run
- **GIVEN** the checked-in baseline `MRR` is `0.62`
- **WHEN** a measurement run produces `MRR = 0.70`
- **THEN** the benchmark exits zero
- **AND** the report flags `MRR` as an improvement

#### Scenario: Baseline refresh overwrites
- **GIVEN** a baseline artifact exists
- **WHEN** the operator invokes the baseline-refresh run
- **THEN** the artifact is replaced with the current run's metrics and configuration
- **AND** the previous baseline values are recorded in version control history rather than the artifact itself

#### Scenario: Missing baseline is a soft state
- **GIVEN** no baseline artifact exists in the repository
- **WHEN** a measurement run completes
- **THEN** it exits zero
- **AND** the report includes an explicit notice that no baseline was found and how to create one

### Requirement: Reproducible Invocation Contract

The benchmark MUST expose a stable, documented invocation contract:

- a measurement command (currently `npm run evaluate:search`),
- a baseline-refresh command (e.g. `npm run evaluate:search:baseline`),
- both MUST accept configuration via environment variables or CLI flags for judge model, dataset path, top-k, and cross-judge sampling.

Output of a measurement run MUST include a machine-readable summary (JSON) suitable for CI consumption and a human-readable summary on stdout.

#### Scenario: Stable command names
- **WHEN** a developer runs `npm run evaluate:search` with no arguments
- **THEN** the benchmark executes a measurement run against the checked-in dataset and baseline

#### Scenario: Machine-readable summary is produced
- **WHEN** a measurement run completes
- **THEN** a JSON summary is written to a known path (or stdout) containing every headline metric, every LLM-judged metric, configuration snapshot, and regression status per metric

#### Scenario: Judge model overridable per run
- **WHEN** the operator passes a supported judge-model identifier via CLI/env
- **THEN** the benchmark uses that judge for all LLM-judged metrics in the run
- **AND** the configuration snapshot in the output records the identifier actually used

### Requirement: Framework-Agnostic Specification

This specification MUST remain agnostic to the underlying evaluation framework (e.g. promptfoo, DeepEval, custom harness). Implementation choices belong in design and may change without changing this spec, provided every requirement above continues to hold and the invocation contract is preserved.

#### Scenario: Framework swap does not break the spec
- **GIVEN** the implementation is migrated from one evaluation framework to another
- **WHEN** the benchmark is rerun
- **THEN** all requirements in this spec continue to hold
- **AND** the invocation contract (command names, environment variables, output JSON shape) remains unchanged
