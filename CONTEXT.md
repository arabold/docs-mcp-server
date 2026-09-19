# Grounded Documentation Search

This context defines the language used to describe how documentation moves from
retrieval to the results returned to a user.

## Language

**Search Query**:
The user's text that describes the documentation they need.
_Avoid_: Prompt, request

**Search Candidate**:
A raw documentation chunk that can become part of a Search Result.
_Avoid_: Hit, raw result, document

**Baseline Ranking**:
The candidate order produced by the built-in search before optional reranking.
_Avoid_: Old order, fallback order, RRF order

**Reranker**:
An optional external ranking stage that orders Search Candidates by relevance to
the Search Query.
_Avoid_: Embedder, search provider, ranker

**Context Assembly**:
The stage that expands ranked Search Candidates into coherent Search Results.
_Avoid_: Reranking, chunk joining

**Search Result**:
Coherent documentation content returned to the user after ranking and Context
Assembly.
_Avoid_: Search Candidate, raw chunk

**Fail-open Search**:
A search that uses Baseline Ranking when the Reranker cannot return a complete
valid ranking.
_Avoid_: Failed search, partial reranking
