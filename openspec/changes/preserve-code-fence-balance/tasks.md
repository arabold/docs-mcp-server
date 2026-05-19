## 1. Fence-state utility

- [x] 1.1 Add `src/splitter/splitters/fenceState.ts` exposing `isOpenAt(text, offset)` and a streaming walker that, given a sequence of candidate cut offsets, returns the next safe (out-of-fence) offset. Support both ` ``` ` and `~~~` fences. Treat the language tag after the opener as opaque. Tolerate up to three leading spaces (standard CommonMark fence indentation).
- [x] 1.2 Unit-test `fenceState` in `src/splitter/splitters/fenceState.test.ts`: opener/closer pairing, language tags, indented fences inside list items, tilde fences, mixed fences in one document, edge cases (fence at offset 0, fence at end of input, content with no fences).

## 2. Fence-aware TextContentSplitter

- [x] 2.1 In `src/splitter/splitters/TextContentSplitter.ts`, post-process cut points returned by `splitByParagraphs` and `splitByLines`: if a candidate cut falls inside an open fence, advance it to the next safe offset reported by `fenceState`.
- [x] 2.2 In the word-level fallback path (currently `RecursiveCharacterTextSplitter`), re-assemble its output so no emitted chunk ends mid-fence. Where re-assembly would push a chunk past `maxChunkSize`, accept the oversize chunk and call `logger.warn` with the same emoji/format the `GreedySplitter` oversize warning uses, naming `TextContentSplitter` as the source.
- [x] 2.3 Confirm `ListContentSplitter` requires no code change — its oversized-item fallback to `TextContentSplitter` inherits the new behaviour. Add a test that proves this end-to-end.

## 3. Splitter tests

- [x] 3.1 In `TextContentSplitter.test.ts`: fenced block straddling a paragraph boundary stays intact; oversized fenced block emits a single balanced oversize chunk plus a warning; multiple fenced blocks separated by prose all stay balanced; ` ~~~ ` tilde fences honour the same invariant; fence with a language tag (` ```ts `) is treated identically.
- [x] 3.2 In `ListContentSplitter.test.ts`: list with a single long item containing a fenced code block produces only balanced chunks; warning is emitted when that single item exceeds `maxChunkSize`.
- [x] 3.3 In `SemanticMarkdownSplitter.test.ts`: property test asserting `count('```') % 2 === 0` for every chunk produced from markdown sources where the code block is nested in (a) a list item, (b) a blockquote, (c) a `<dl><dd>`, (d) a `<details>` block, (e) a generic `<div>` wrapper, (f) a table cell.

## 4. Table-cell characterisation

- [x] 4.1 In `TableContentSplitter.test.ts`: characterisation test that feeds a markdown table whose cells contain backticks and a fenced block, asserts the current Turndown round-trip behaviour, and documents (in a code comment) what is locked in so a future change to `TableContentSplitter` cannot silently regress it.

## 5. Benchmark verification

- [ ] 5.1 Run `npm run evaluate:search` and confirm `code_block_balance` returns to 100% on the existing dataset. Confirm no headline IR metric regresses beyond the configured tolerance. _Deferred: requires an indexed library plus a configured LLM judge; run manually before merging._

## 6. Spec delta and docs

- [x] 6.1 Apply the `markdown-features` spec delta in `openspec/changes/preserve-code-fence-balance/specs/markdown-features/spec.md`.
- [x] 6.2 Update `ARCHITECTURE.md` splitter section with one sentence recording the fence-balance invariant and the oversize trade-off.

## 7. Validation

- [x] 7.1 `npm run lint`, `npm run typecheck`, `npm test` all pass.
