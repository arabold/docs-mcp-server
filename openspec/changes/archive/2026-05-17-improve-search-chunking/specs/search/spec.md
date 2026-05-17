# Search Capability

The search capability retrieves relevant documentation chunks based on semantic queries, assembling them into coherent results for LLM consumption.

## ADDED Requirements

### Requirement: Configurable Chunk Distance
The system MUST allow configuring the maximum distance between chunks to consider them part of the same result group.

#### Scenario: Default Configuration
Given the default configuration
When the application starts
Then `assembly.maxChunkDistance` should be 3.

### Requirement: Distance-Based Result Splitting
Search hits from the same document MUST be split into separate results if they are separated by more than the configured distance.

#### Scenario: Splitting Distant Chunks
Given a search query matches Chunk A (order 1) and Chunk B (order 10) in the same document
And `maxChunkDistance` is 3
When the search is executed
Then the result set should contain two separate entries: one for Chunk A and one for Chunk B.

#### Scenario: Merging Close Chunks
Given a search query matches Chunk A (order 1) and Chunk B (order 3) in the same document
And `maxChunkDistance` is 3
When the search is executed
Then the result set should contain a single entry merging Chunk A and Chunk B (and potentially the gap between them).

### Requirement: Relevance Sorting
The final list of search results MUST be sorted by relevance score, regardless of which document they originated from.

#### Scenario: Re-sorting After Split
Given a document yields two result clusters: Cluster A (score 0.9) and Cluster B (score 0.5)
And another document yields Cluster C (score 0.8)
When the search returns
Then the order should be Cluster A, Cluster C, Cluster B.
