## ADDED Requirements

### Requirement: Hybrid Search Mode
When vector search is enabled (embeddings initialized successfully), the system SHALL execute both vector similarity search and full-text search in parallel using a single SQL CTE query:

- **Vector search**: Uses `sqlite-vec` extension with `documents_vec MATCH` for cosine distance similarity.
- **Full-text search**: Uses SQLite FTS5 with `documents_fts MATCH` and BM25 scoring.

Results from both searches SHALL be combined via a `LEFT JOIN`, ensuring that results from either search method are included. A chunk that matches only in vector search or only in FTS SHALL still appear in the results.

**Code reference:** `src/store/DocumentStore.ts:1521-1617`

#### Scenario: Query matches in both vector and FTS
- **WHEN** a search query matches chunks via both vector similarity and full-text search
- **THEN** the system SHALL return results that combine both sources
- **AND** results SHALL be ranked using Reciprocal Rank Fusion

#### Scenario: Query matches only in vector search
- **WHEN** a search query has semantic matches via vector similarity but no exact keyword matches in FTS
- **THEN** the system SHALL still return vector-matched results via the LEFT JOIN

#### Scenario: Query matches only in FTS
- **WHEN** a search query has keyword matches in FTS but low vector similarity
- **THEN** the system SHALL still return FTS-matched results via the LEFT JOIN

### Requirement: Reciprocal Rank Fusion Ranking
The system SHALL combine vector and FTS search results using Reciprocal Rank Fusion (RRF) with the formula:

```
rrf_score = weightVec / (k + vecRank) + weightFts / (k + ftsRank)
```

Where:
- `k` = 60 (fusion constant)
- `weightVec` = configurable weight for vector search (default 1, `search.weightVec`)
- `weightFts` = configurable weight for FTS (default 1, `search.weightFts`)
- `vecRank` and `ftsRank` are 1-based positional ranks from each search method

Results SHALL be sorted by descending RRF score so the most relevant results appear first.

**Code reference:** `src/store/DocumentStore.ts:149-194`

#### Scenario: Equal weight ranking
- **WHEN** `search.weightVec` and `search.weightFts` are both 1
- **AND** a chunk ranks 1st in vector search and 5th in FTS
- **THEN** the RRF score SHALL be `1/(60+1) + 1/(60+5)` = approximately 0.01639 + 0.01538

#### Scenario: Custom weight favoring FTS
- **WHEN** `search.weightVec` is 0.5 and `search.weightFts` is 2.0
- **THEN** FTS results SHALL be weighted more heavily in the combined ranking

#### Scenario: Chunk only in one search
- **WHEN** a chunk appears in vector search (rank 3) but not in FTS
- **THEN** the chunk's RRF score SHALL be computed using only the vector component, with the FTS component contributing 0

### Requirement: FTS-Only Fallback
When vector search is disabled (no embedding model configured, missing credentials, or initialization failure), the system SHALL use only FTS5 BM25 search. Results SHALL be scored directly by the negated BM25 score (converted to a positive value) and ranked in descending order. No vector similarity computation SHALL occur.

**Code reference:** `src/store/DocumentStore.ts:1618-1668`

#### Scenario: Search without embeddings
- **WHEN** embeddings are disabled
- **AND** a user executes a search query
- **THEN** the system SHALL execute only FTS5 BM25 search
- **AND** results SHALL be scored by negated BM25 score (positive values)
- **AND** no embedding API calls SHALL be made for the query

#### Scenario: FTS-only result ordering
- **WHEN** embeddings are disabled
- **AND** FTS returns chunks with BM25 scores of -5.2, -3.1, and -8.7
- **THEN** results SHALL be ordered by score descending: 8.7, 5.2, 3.1

### Requirement: FTS Query Construction
The system SHALL construct FTS5 queries from user input using a quote-aware tokenizer with the following rules:

- **Unquoted terms**: `foo bar` produces `"foo bar" OR "foo" OR "bar"` -- both a phrase match and individual term matches are attempted.
- **Quoted phrases**: `"exact phrase"` preserves the exact phrase match in the FTS query.
- **Mixed input**: `test "exact phrase" word` produces `"test exact phrase word" OR "test" OR "exact phrase" OR "word"`.

This dual approach (phrase + individual terms) ensures both exact and partial matches are returned. The output is an unparenthesized OR chain; all tokens are individually quoted for FTS5 safety.

**Code reference:** `src/store/DocumentStore.ts:606-691`

#### Scenario: Simple multi-word query
- **WHEN** the search query is `react hooks`
- **THEN** the FTS query SHALL include both a phrase match `"react hooks"` and individual term matches `"react" OR "hooks"`

#### Scenario: Exact phrase query
- **WHEN** the search query is `"useEffect cleanup"`
- **THEN** the FTS query SHALL preserve the exact phrase `"useEffect cleanup"`

#### Scenario: Mixed query with quotes
- **WHEN** the search query is `testing "react hooks" guide`
- **THEN** the FTS query SHALL combine full phrase, individual terms, and the preserved quoted phrase

### Requirement: Overfetch Strategy
The system SHALL overfetch results from both search methods beyond the requested `limit` to improve recall before RRF ranking:

- **FTS overfetch**: `limit * overfetchFactor` (default `overfetchFactor` = 2, configurable via `search.overfetchFactor`)
- **Vector overfetch**: `limit * overfetchFactor * vectorMultiplier` (default `vectorMultiplier` = 10, configurable via `search.vectorMultiplier`)

The higher vector overfetch factor compensates for the semantic nature of vector search, where relevant results may appear at lower similarity ranks.

**Code reference:** `src/store/DocumentStore.ts:1527-1530`

#### Scenario: Default overfetch with limit 10
- **WHEN** the search limit is 10
- **AND** default overfetch settings are used (overfetchFactor=2, vectorMultiplier=10)
- **THEN** FTS SHALL fetch up to 20 results
- **AND** vector search SHALL fetch up to 200 results

#### Scenario: Custom overfetch configuration
- **WHEN** `search.overfetchFactor` is set to 3 and `search.vectorMultiplier` is set to 5
- **AND** the search limit is 10
- **THEN** FTS SHALL fetch up to 30 results
- **AND** vector search SHALL fetch up to 150 results

### Requirement: BM25 Field Weights
The FTS5 search SHALL use BM25 field weights assigned positionally to the FTS5 column order (`content, title, url, path`):

| FTS5 Column (positional order) | Weight | Rationale |
|-------------------------------|--------|-----------|
| `content` | 10.0 | Body content matches are the strongest relevance signals |
| `title` | 1.0 | Baseline weight for title matches |
| `url` | 5.0 | URL matches indicate topical relevance (path segments in URLs) |
| `path` | 1.0 | Section path matches provide supplementary context |

The `bm25()` call is `bm25(documents_fts, 10.0, 1.0, 5.0, 1.0)`, where arguments map to FTS5 columns in declaration order.

**Code reference:** `src/store/DocumentStore.ts:1551, 1629`, `db/migrations/009-add-pages-table.sql:89-95`

#### Scenario: Content match is weighted heavily
- **WHEN** the search query is `installation`
- **AND** one chunk has `installation` in its content body and another has it only in its title
- **THEN** the chunk with the content match SHALL receive a higher BM25 score (10x weight vs 1x)

#### Scenario: URL match contributes to relevance
- **WHEN** the search query is `setup`
- **AND** a chunk has `setup` in its URL
- **THEN** the URL match SHALL contribute 5x the weight of a title-only or path-only match

### Requirement: Structural Chunk Exclusion
The system SHALL exclude chunks whose `metadata.types` array contains `'structural'` from all search results, in both hybrid and FTS-only modes. Structural chunks are container elements (e.g., function signatures, class declarations) that provide hierarchical context but are not meaningful as standalone search results.

**Code reference:** `src/store/DocumentStore.ts:1579-1581`

#### Scenario: Structural chunk filtered from hybrid search
- **WHEN** a hybrid search returns a chunk with `metadata.types` containing `'structural'`
- **THEN** the chunk SHALL be excluded from the final results

#### Scenario: Structural chunk filtered from FTS-only search
- **WHEN** an FTS-only search returns a chunk with `metadata.types` containing `'structural'`
- **THEN** the chunk SHALL be excluded from the final results

#### Scenario: Non-structural chunk preserved
- **WHEN** a search returns a chunk with `metadata.types` not containing `'structural'`
- **THEN** the chunk SHALL be included in the results

### Requirement: Score Normalization
The system SHALL normalize raw search scores to positive values:

- **Vector score**: Computed as `1 / (1 + distance)`, converting cosine distance (where 0 is identical) to a similarity score between 0 and 1.
- **FTS score**: Computed as `-MIN(bm25_score, 0)`, converting BM25's negative scoring convention to a positive value. Higher values indicate better matches.

**Code reference:** `src/store/DocumentStore.ts:1571-1572`

#### Scenario: Vector distance to similarity conversion
- **WHEN** a vector search returns a chunk with cosine distance 0.2
- **THEN** the vector score SHALL be `1 / (1 + 0.2)` = approximately 0.833

#### Scenario: Identical vector match
- **WHEN** a vector search returns a chunk with cosine distance 0
- **THEN** the vector score SHALL be `1 / (1 + 0)` = 1.0

#### Scenario: BM25 score conversion
- **WHEN** FTS returns a chunk with BM25 score -7.5
- **THEN** the FTS score SHALL be 7.5 (negated to positive)
