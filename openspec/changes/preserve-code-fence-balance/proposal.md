## Why

The markdown chunker can cut inside a fenced code block when the block is nested in a list item, blockquote, table cell, definition list, `<details>` element, or any wrapper not specifically recognised at section-detection time. The resulting chunk has an unbalanced fence count, which corrupts downstream markdown rendering and confuses LLM consumers — an opened fence makes everything after it look like code to a renderer or a model.

The search-quality benchmark introduced by `define-search-benchmark` surfaced this as `code_block_balance` = 96.7% on the current dataset: two of sixty queries return a chunk whose triple-backtick count is odd, both from the same Vite docs page where the manifest example sits inside a list item. Issue [#418](https://github.com/arabold/docs-mcp-server/issues/418) tracks the bug.

The root cause sits inside `TextContentSplitter`: when `ListContentSplitter` falls back to it for an oversized list item, or when an arbitrary `<div>`/`<dl>`/`<details>` wrapper falls through `SemanticMarkdownSplitter`'s generic `else` branch to become a `text` section, the splitter walks paragraph/line/word boundaries with no awareness of fence state and happily cuts inside a fenced block.

## What Changes

- `TextContentSplitter` becomes **fence-aware**. While walking candidate cut points (paragraph → line → word), it tracks the running open-fence state and refuses to cut while inside a fenced code block. When a cut would land inside an open fence, the splitter advances the cut to just past the next closing fence.
- When honoring this would force a chunk to exceed `maxChunkSize`, the splitter accepts the oversize chunk rather than break the fence. The existing oversize-chunk warning in `GreedySplitter` already covers visibility for downstream observers; `TextContentSplitter` emits the same `logger.warn` when it emits an oversize chunk on its own.
- The invariant lives in one place: a small `fenceState` helper module, unit-tested independently. It handles both backtick (` ``` `) and tilde (`~~~`) fences and tolerates the up-to-3-space leading indentation list items introduce.
- `ListContentSplitter`'s oversized-item fallback path picks up the new behaviour automatically; no change to its own logic is required.
- `TableContentSplitter` is **unchanged**: it splits on `|`-delimited rows and does not call `TextContentSplitter` mid-cell, so the invariant already holds for normal tables. A characterisation test locks in current behaviour for the unusual case of fenced content inside a cell.
- `SemanticMarkdownSplitter`'s section-detection is **unchanged**: code nested inside lists, blockquotes, definition lists, `<details>`, or generic wrappers continues to flow through the list or text splitter — but now safely.

The fence-balance invariant takes precedence over the size invariant in the unavoidable case (a single nested code block on its own exceeds `maxChunkSize`). That outcome is documented as the explicit trade-off; the alternative — synthetic close/reopen fences spliced into stored chunks — was rejected as visible pollution of search output.

## Capabilities

### Modified Capabilities

- `markdown-features`: adds the **Preserve code fence balance across chunk boundaries** requirement and amends **Support list chunking** to reference it. The fence-balance invariant is now a contractual property of every chunk the splitter emits, not just an emergent property of section detection.

## Impact

- **Code**: primary change in `src/splitter/splitters/TextContentSplitter.ts`; new helper `src/splitter/splitters/fenceState.ts`. Test additions in `TextContentSplitter.test.ts`, `ListContentSplitter.test.ts`, `SemanticMarkdownSplitter.test.ts`. No public API or configuration change.
- **Behaviour**: in the rare case where a single nested code block on its own exceeds `maxChunkSize`, the produced chunk also exceeds `maxChunkSize`. The existing oversize-chunk warning fires. This is the trade-off accepted in this change.
- **Benchmark**: `code_block_balance` is expected to return to 100% on the current dataset and the regression check then gates against future regressions. No baseline refresh expected — only the structural pass-rate moves.
- **Docs**: one-sentence update to `ARCHITECTURE.md` in the splitter section to record the invariant. No `README.md` change.
- **Performance**: the fence tracker is O(n) over the input string and runs once per `TextContentSplitter.split` call; negligible cost relative to the existing paragraph/line/word walks.
