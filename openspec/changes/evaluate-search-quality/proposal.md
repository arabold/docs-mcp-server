# Search Quality Evaluation Pipeline

## Summary
Implement an automated "LLM-as-a-judge" evaluation pipeline to measure and track the quality of search results. This system will use `promptfoo` to evaluate the local search engine against a ground-truth dataset (e.g., React documentation) on metrics like relevance, compactness, contextual integrity, and ranking.

## Problem Statement
Search quality is currently subjective. We lack a quantitative way to measure if changes to the embedding model, chunking strategy, or re-ranking logic actually improve the user experience. We need a way to measure:
1.  **Relevance:** Does it answer the question?
2.  **Compactness:** Is it concise (token efficient)?
3.  **Integrity:** Are code blocks broken?
4.  **Ranking:** Is the best answer at the top?

## Proposed Solution
- **Tooling:** specific `promptfoo` integration (TypeScript-native).
- **Methodology:** Run a set of "Golden Queries" against a locally indexed documentation set (React).
- **Metrics:** Use Model-Graded evaluations for subjective quality and deterministic checks for structural integrity.
- **Workflow:** Separate from standard E2E tests; run on-demand or nightly.

## Impact
- **New Dependencies:** `promptfoo` (dev dependency).
- **New Scripts/Commands:** `promptfoo eval`-based evaluation scripts (e.g., package.json scripts and helper shell/TypeScript files).
- **No Runtime Impact:** This is purely a testing/evaluation capability.
