# search-accuracy Specification

## Purpose
Measures how well search ranks the passage that answers a query, on a fixed corpus with passage-level golden labels, so that changes to full-text search, vector search, fusion or chunking can be compared run to run and machine to machine.

## Requirements
### Requirement: Pinned Corpus

The benchmark SHALL index a corpus defined by a checked-in manifest that pins each source to an exact revision and the paths to include. The same manifest SHALL always produce the same documents. The corpus is downloaded on first use and reused from a local cache afterwards; it is never committed to the repository.

#### Scenario: Cached corpus needs no network
- **GIVEN** every source in the manifest is already in the local cache at its pinned revision
- **WHEN** the benchmark runs
- **THEN** it makes no network request to fetch documents

#### Scenario: Moving the cache does not change results
- **GIVEN** the same manifest, golden set and configuration
- **WHEN** the benchmark runs from two different cache directories
- **THEN** it ranks every query the same way in both
- **AND** reuses cached vectors in both

#### Scenario: Changed pin is fetched again
- **GIVEN** the manifest pins a source to a revision that is not in the cache
- **WHEN** the benchmark runs
- **THEN** it fetches that revision before indexing
- **AND** a failure to fetch stops the run with a message naming the source and revision

### Requirement: Indexed Through the Real Pipeline

The benchmark SHALL index the corpus with the same scraping, splitting, embedding and storage the server uses, with the server's default search and splitter configuration unless the run overrides it, and SHALL place every library in one store so that cross-library effects on ranking are present.

#### Scenario: One store for all libraries
- **WHEN** the corpus is indexed
- **THEN** every library in the manifest is a separate library in a single store
- **AND** queries for one library are answered from that library only, as in normal search

### Requirement: Passage-Level Golden Set

The benchmark SHALL be driven by a checked-in golden set. Each query names its library, query text, intent and style, and one or more golden passages, each with its page, the passage text and a grade from 1 to 3 (3 answers the query directly). The set SHALL have at least 100 queries over at least four libraries, no library above 40% of queries, and every style at 10% or more.

#### Scenario: Query styles are declared
- **GIVEN** the golden set
- **WHEN** it is loaded
- **THEN** every query has a style from a fixed list (keywords, identifier, question, agent request)
- **AND** every query has an intent from a fixed list (api lookup, how-to, conceptual, comparison, troubleshooting)

#### Scenario: Malformed entry is rejected
- **GIVEN** a query without a golden passage, or with a grade outside 1 to 3
- **WHEN** the golden set is loaded
- **THEN** the run stops and names the query and the problem

### Requirement: Golden Passages Must Exist in the Index

Before scoring, the benchmark SHALL check that every golden passage is found in an indexed chunk of its page. A passage counts as found in a chunk when the chunk contains it, or contains a contiguous part of it at least half its length when the splitter cut it across chunks. A passage that is not found SHALL stop the run.

#### Scenario: Corpus drift is caught
- **GIVEN** a golden passage that no indexed chunk of its page contains
- **WHEN** the benchmark validates the golden set
- **THEN** the run stops before scoring
- **AND** names the query, the page and the passage

#### Scenario: Split passage is reported
- **GIVEN** a golden passage that the splitter cut across two chunks, each holding part of it
- **WHEN** the benchmark validates the golden set
- **THEN** the chunk holding at least half of the passage counts as containing it
- **AND** the report lists the passage as split

### Requirement: Evaluation Modes and Levels

The benchmark SHALL run every query in three modes against the same index: full-text only, vector only, and hybrid with the configured fusion. In each mode it SHALL score two levels: the ranked chunks the store returns for the query, and the final results search returns after grouping and assembly.

#### Scenario: Vector modes without embeddings
- **GIVEN** no embedding credentials and no cached vectors for the corpus and queries
- **WHEN** the benchmark runs
- **THEN** the full-text mode is scored
- **AND** the vector and hybrid modes are reported as skipped with the reason

#### Scenario: A mode is selected
- **WHEN** the run is limited to the full-text mode
- **THEN** only that mode is scored and compared with its baseline

### Requirement: Accuracy Metrics

For each query, mode and level the benchmark SHALL record the rank of the first result containing a golden passage (or a miss) and compute MRR, Hit@1, Hit@3, Hit@5, Hit@10, Recall@10 and graded nDCG@10, at chunk level (the result contains a golden passage) and page level (the result is from a golden passage's page). It SHALL aggregate them per mode and level, broken down by library, intent and style. The same index, golden set and configuration SHALL give the same numbers.

#### Scenario: Chunk level is stricter than page level
- **GIVEN** a query whose first result is from the golden page but does not contain the golden passage, and whose third result does
- **WHEN** the query is scored
- **THEN** its page-level first rank is 1
- **AND** its chunk-level first rank is 3

#### Scenario: A result holding two passages counts for both
- **GIVEN** a query with two golden passages on one page
- **WHEN** its first result holds both passages
- **THEN** its chunk-level Recall@10 is 1

#### Scenario: Grades order nDCG
- **GIVEN** a query with a grade 3 passage and a grade 1 passage
- **WHEN** the grade 3 passage ranks above the grade 1 passage
- **THEN** nDCG@10 is higher than with the order reversed

### Requirement: Embedding Cache

The benchmark SHALL cache every vector it obtains, keyed by the embedding model's identity and the exact text embedded, and reuse it on later runs. A run whose vectors are all cached SHALL make no embedding request. Vectors from one model SHALL never be used for another.

#### Scenario: Second run is offline
- **GIVEN** a completed run with embeddings
- **WHEN** the benchmark runs again with the same corpus, golden set, splitter and embedding model
- **THEN** it makes no embedding request

#### Scenario: New model does not reuse vectors
- **GIVEN** a cache filled with one embedding model
- **WHEN** the benchmark runs with a different embedding model
- **THEN** every vector is requested from the new model

### Requirement: Baseline and Regression Check

The repository SHALL contain a baseline holding, per mode and level, the aggregate metrics, each query's chunk-level first rank, and the configuration they came from (manifest pins, golden set, embedding model, search settings). A measurement run SHALL list every query whose first rank changed and fail when MRR, Hit@5 or nDCG@10 of a scored mode drops by more than 0.02 at either level. A refresh run SHALL rewrite the baseline and succeed.

#### Scenario: Regression fails the run
- **GIVEN** the baseline hybrid chunk-level MRR is 0.62
- **WHEN** a measurement run computes 0.59
- **THEN** the run fails
- **AND** the report names the mode, level and metric with both values

#### Scenario: Per-query changes are listed
- **WHEN** a measurement run finishes
- **THEN** the report lists each query whose chunk-level first rank changed, with the old and new rank, per mode

#### Scenario: Different configuration is not compared
- **GIVEN** a baseline recorded with a different embedding model or manifest pin
- **WHEN** a measurement run starts
- **THEN** it reports the configuration difference instead of comparing metrics
- **AND** it fails until the baseline is refreshed

### Requirement: Invocation

The benchmark SHALL provide a measurement command and a baseline refresh command, accept options to limit the run to chosen modes and libraries, print a summary table per mode and level, and write the full per-query report to a gitignored results directory. It SHALL NOT run as part of the default test command.

#### Scenario: Summary and report
- **WHEN** a measurement run completes
- **THEN** stdout shows chunk-level and page-level MRR, Hit@1, Hit@5 and nDCG@10 per scored mode and level
- **AND** the results directory holds the per-query ranks for every mode and level

#### Scenario: Default test run is unaffected
- **WHEN** the default test command runs
- **THEN** the benchmark neither fetches the corpus nor runs
