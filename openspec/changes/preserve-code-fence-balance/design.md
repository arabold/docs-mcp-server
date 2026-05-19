# Design: preserve code fence balance

## Context

The chunker is a three-stage pipeline: `SemanticMarkdownSplitter` produces structural sections (heading, text, code, table, list, blockquote, media), each of which is fed to a type-specific content splitter (`TextContentSplitter`, `CodeContentSplitter`, `TableContentSplitter`, `ListContentSplitter`), and `GreedySplitter` then concatenates the resulting chunks up to `preferredChunkSize` / `maxChunkSize` while respecting major-section boundaries.

`CodeContentSplitter` already preserves fence balance correctly — it strips the outer fence, splits by line, and re-wraps each chunk with the original language tag. The bug lives one level up: `SemanticMarkdownSplitter` only recognises a `<pre>` element as its own `code` section when the `<pre>` is a **direct child of `<body>`**. Code blocks nested inside `<ul>`, `<blockquote>`, `<dl>`, `<details>`, `<td>`, or any unrecognised wrapper instead travel with their container's section type and are eventually handed to `TextContentSplitter` (directly, or via `ListContentSplitter`'s oversized-item fallback). `TextContentSplitter` walks paragraph → line → word boundaries with no fence awareness.

## Decision

Make `TextContentSplitter` fence-aware rather than restructure section detection.

The alternative — descending into wrappers in `SemanticMarkdownSplitter` and extracting each nested `<pre>` as its own section — was considered and rejected. It would lose the semantic context of "this code is inside a list item" (bullet, indentation, surrounding bullet text), split a single list item across multiple chunk `types`, and require careful per-container logic for lists, blockquotes, definition lists, `<details>`, and the catch-all `<div>` wrapper case. Fence-aware splitting in one downstream component fixes every container variant uniformly.

When fence-aware splitting would force a chunk past `maxChunkSize`, the splitter accepts the oversize chunk. The alternative — synthetic close/reopen fences — would inject ` ``` ` markers into stored chunks that have no source equivalent, polluting search output and assembled responses. Oversize chunks already have a warning code path (`GreedySplitter` emits one when the base splitter hands it an oversize chunk), and the case is rare in practice: a single nested code block large enough to exceed `maxChunkSize` is unusual content.

## Fence detection

A fence is a line whose only non-whitespace prefix is three or more identical backticks or three or more identical tildes, with up to three leading spaces of indentation (CommonMark rule). Backticks and tildes do not pair across types — a ` ``` ` opener can only be closed by a ` ``` ` line, not a `~~~` line. The closing fence must use at least as many delimiter characters as the opener.

For this splitter's purposes a simplified state machine suffices: scan the input line by line, when not in a fence look for a line matching `/^ {0,3}(`{3,}|~{3,})/`, and on match enter the fence with the matched delimiter character and length. When in a fence, exit on a line matching `/^ {0,3}(?:\1{count,})\s*$/` for that delimiter/length. Anything that looks like a fence opener inside a fence is ignored.

The walker exposes:

```ts
isOpenAt(text: string, offset: number): boolean
nextSafeOffset(text: string, candidateOffset: number): number
```

`nextSafeOffset` returns `candidateOffset` itself if it is not inside an open fence, otherwise the offset of the line *after* the corresponding closing fence (or `text.length` if no closing fence appears).

## Splitter integration

`TextContentSplitter.splitByParagraphs` already records candidate cut offsets via a regex walk over `\n\s*\n`. The change: each candidate offset is passed through `fenceState.nextSafeOffset`. If the resulting offset is past the end of the input, the whole text is emitted as a single (possibly oversize) chunk and a warning is logged.

`splitByLines` performs an identical adjustment: each candidate `\n` boundary is run through `nextSafeOffset`.

The word-level fallback path currently delegates to LangChain's `RecursiveCharacterTextSplitter`. That splitter cannot be made fence-aware without a wrapper. Approach: keep the LangChain call, then post-process its output: walk the produced chunks, and for any chunk whose own fence state ends "open", merge it with the next chunk (and repeat) until the running chunk closes its fence or the end of input is reached. If a merged chunk exceeds `maxChunkSize`, emit it and warn.

## Trade-offs

- **Oversize chunks**: rare but possible. Embedding quality on those degrades slightly. Accepted.
- **Single point of change**: the invariant lives in `TextContentSplitter` and `fenceState`. Future content splitters (`ListContentSplitter`, any new wrapper-aware splitter) inherit the guarantee by delegating to `TextContentSplitter` for their fallback paths.
- **Tilde fences**: supported even though our HTML→Markdown pipeline produces only backtick fences. Local-file markdown inputs (`text/markdown` pipeline) can use either, so we handle both. Cost is one extra regex match per line.
- **`TableContentSplitter`**: left unchanged. Tables produced by our pipeline never embed `<pre>` cells in practice; the characterisation test locks in current behaviour and the spec does not promise fence balance inside table cells. If real-world content surfaces a regression here, the same fence-aware approach can extend to `TableContentSplitter`.

## Alternatives considered

1. **Section-aware splitting in `SemanticMarkdownSplitter`** (descend into wrappers, extract nested `<pre>` as separate code sections). Rejected: high implementation cost, loses semantic context, changes chunk `types` in ways that ripple through assembly and search-result UX.
2. **Defensive close at assembly time** (in `MarkdownAssemblyStrategy`, append a closing ` ``` ` when the assembled content has an odd fence count). Rejected: papers over the root cause, stored chunks remain malformed, embedding quality on those chunks remains bad.
3. **Synthetic close-and-reopen at split boundaries**. Rejected: pollutes stored content with markers that have no source equivalent and confuses consumers who diff chunks against source.
