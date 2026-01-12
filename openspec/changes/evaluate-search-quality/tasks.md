# Tasks: Search Quality Evaluation

1.  [ ] **Install Dependencies**
    - Add `promptfoo` to `devDependencies`.
    - Add `evaluate:search` script to `package.json`.
    - Validation: `npm run evaluate:search` runs (even if empty).

2.  [ ] **Implement Search Provider Adapter**
    - Create `src/tools/search-provider.ts`.
    - Implement the logic to connect to `DocumentStore` and run `DocumentRetrieverService.search`.
    - Validation: Unit test the provider to ensure it returns strings from the DB.

3.  [ ] **Configure Promptfoo**
    - Create `promptfoo.yaml`.
    - Define the metrics (Relevance, Compactness, Integrity, Ranking) using assertions.
    - Validation: Run `promptfoo eval` with a dummy prompt and verify metrics appear.

4.  [ ] **Create Evaluation Dataset**
    - Create `tests/search-eval/dataset.yaml`.
    - Add at least 5 "Golden Pairs" for React documentation (Query + Expected URL + Key Concepts).
    - Validation: The dataset is parsable by promptfoo.

5.  [ ] **Wire Up Evaluation Runner**
    - Configure the `evaluate:search` npm script to run `promptfoo eval` using `promptfoo.yaml` and the dataset in `tests/search-eval/`.
    - Ensure the flow checks for the existence of the React index before running the evaluation.
    - Validation: `npm run evaluate:search` runs the full evaluation using `tests/search-eval/dataset.yaml`.
