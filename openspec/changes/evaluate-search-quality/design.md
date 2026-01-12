# Design: Search Quality Evaluation

## Architecture

### 1. Evaluation Engine: Promptfoo
We selected **Promptfoo** because:
- It is **TypeScript-native**, allowing direct import of our `DocumentRetrieverService` without complex inter-process communication (unlike Python alternatives like Ragas).
- It provides a built-in **Matrix View** HTML report to visualize trade-offs (e.g., shorter context vs. higher relevance).
- It supports **Model-Graded Metrics** out of the box.

### 2. The Provider Adapter
To bridge `promptfoo` and `docs-mcp-server`, we will create a Custom Provider script (`src/tools/search-provider.ts`).
- **Input:** The query string from the test dataset.
- **Process:**
    1.  Instantiate `DocumentStore` and `DocumentRetrieverService`.
    2.  Execute `search(library, version, query, limit)`.
    3.  Assemble the results into a single prompt-friendly string.
- **Output:** The raw text content of the search results, plus metadata (URLs, scores) for deterministic ranking checks.

### 3. Metric Strategy

| Metric | Implementation | Judge |
| :--- | :--- | :--- |
| **Relevance** | `model-graded-closedqa` | LLM judge (default: `openai:gpt-4o-mini`, configurable in `promptfoo.yaml`) checks if the answer contains specific concepts. |
| **Compactness** | `llm-rubric` | LLM grades 1-5 on "fluff" ratio. |
| **Integrity** | `javascript` assertion | Regex checks for unclosed code blocks (` ``` `) or mid-sentence cutoffs. |
| **Ranking** | `javascript` assertion | Checks if the expected URL is within the top K results (simulating NDCG). |

### 4. Test Data & Prerequisites
- **Data Source:** We will use **React** documentation as the standard test corpus.
- **Pre-condition:** The evaluation script **assumes** the React documentation is already indexed in the local database.
    - *Constraint:* The evaluation tool does **not** index the data itself to keep runs fast and focused on retrieval quality.
- **Separation:** This is **not** an E2E test. E2E tests check if the server is up; this evaluates *how good* the answers are. It will live in `tests/search-eval/` separate from `tests/e2e/`.

## Workflow
1.  Developer runs `npm run evaluate:search`.
2.  Script verifies React docs exist in DB (warns if not).
3.  Promptfoo executes the test set.
4.  Developer views `promptfoo view` to see the matrix.
