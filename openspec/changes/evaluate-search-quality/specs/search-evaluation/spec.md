# Spec: Search Quality Evaluation

## ADDED Requirements

### Requirement: Automated Search Evaluation
The system MUST provide an automated pipeline to evaluate search result quality against a known dataset.

#### Scenario: Running the evaluation suite
- **Given** the `docs-mcp-server` has indexed the "react" documentation
- **When** the developer runs `npm run evaluate:search`
- **Then** the system should execute the `promptfoo` evaluation suite
- **And** it should generate a report comparing search results against expected golden answers.

#### Scenario: Assessing Relevance
- **Given** a search result for "How to use useEffect"
- **When** the result is evaluated
- **Then** the LLM judge should score it high if it mentions "side effects" and "dependency array"
- **And** score it low if it discusses `useState` or class components.

#### Scenario: Assessing Contextual Integrity
- **Given** a search result with a code block
- **When** the integrity check runs
- **Then** it must fail if the code block start tag (` ``` `) is present but the end tag is missing.

#### Scenario: Assessing Ranking
- **Given** a set of 5 search results
- **When** the ranking check runs
- **Then** it must verify that the `expectedUrl` from the dataset is present in the top 3 results.

#### Scenario: Handling missing index
- **Given** the "react" documentation is NOT indexed
- **When** the evaluation starts
- **Then** it should fail fast with a clear error message instructing the user to run `docs-mcp-server scrape ...` first.
