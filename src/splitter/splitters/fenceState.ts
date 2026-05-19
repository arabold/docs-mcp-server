/**
 * Tracks whether a given offset in a markdown string falls inside an open
 * fenced code block. Used by content splitters to avoid cutting chunks in the
 * middle of a fence, which would leave one chunk with an unmatched opener and
 * the next chunk with an unmatched closer.
 *
 * Follows CommonMark fence semantics for the cases that matter to us: a fence
 * is a line whose only leading non-whitespace content is three or more
 * identical backticks or three or more identical tildes, with up to three
 * leading spaces of indentation. The closing fence must use the same character
 * and at least as many of them as the opener. Backticks and tildes do not
 * pair across types.
 */

interface FenceRegion {
  /** Start offset of the line containing the opener. */
  startOffset: number;
  /** End offset (exclusive) of the line after the matching closer, or text.length if unclosed. */
  endOffset: number;
}

interface LineInfo {
  content: string;
  /** Offset of the first character of this line in the source string. */
  offset: number;
  /** Length of the trailing newline (0 for the last line if no trailing newline). */
  newlineLength: number;
}

// Recognise a fence opener with any leading horizontal whitespace and any
// number of blockquote (`>`) prefix markers. CommonMark itself restricts
// fences to ≤3 leading spaces, but Turndown emits 4-space indented fences
// inside list items and blockquote-prefixed fences inside `> ` blocks, and
// downstream consumers (LLMs, renderers not strictly CommonMark-aware) still
// treat the literal ``` / ~~~ as a fence. For our balance invariant we
// recognise any leading indentation/blockquote-prefix combination.
const FENCE_PREFIX = "[ \\t]*(?:>[ \\t]*)*";
const FENCE_OPENER = new RegExp(`^${FENCE_PREFIX}(\`{3,}|~{3,})`);

function splitLinesWithOffsets(text: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let offset = 0;
  while (offset <= text.length) {
    const nlIndex = text.indexOf("\n", offset);
    if (nlIndex === -1) {
      if (offset < text.length) {
        lines.push({ content: text.slice(offset), offset, newlineLength: 0 });
      }
      return lines;
    }
    lines.push({
      content: text.slice(offset, nlIndex),
      offset,
      newlineLength: 1,
    });
    offset = nlIndex + 1;
  }
  return lines;
}

function isClosingFence(line: string, delimiter: string, openerCount: number): boolean {
  // Match the opener's permissiveness (see FENCE_OPENER): allow any leading
  // horizontal whitespace plus blockquote markers.
  const closerRegex = new RegExp(
    `^${FENCE_PREFIX}\\${delimiter}{${openerCount},}[ \\t]*$`,
  );
  return closerRegex.test(line);
}

/**
 * Scan the input and return non-overlapping fence regions. Each region covers
 * the line containing the opener through the line containing the matching
 * closer (inclusive of trailing newlines). Unclosed openers produce a region
 * extending to the end of input.
 */
function findFenceRegions(text: string): FenceRegion[] {
  const regions: FenceRegion[] = [];
  const lines = splitLinesWithOffsets(text);

  let i = 0;
  while (i < lines.length) {
    const opener = FENCE_OPENER.exec(lines[i].content);
    if (!opener) {
      i += 1;
      continue;
    }

    const delimiter = opener[1][0]; // '`' or '~'
    const count = opener[1].length;
    const startOffset = lines[i].offset;

    let closerLineIndex = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (isClosingFence(lines[j].content, delimiter, count)) {
        closerLineIndex = j;
        break;
      }
    }

    if (closerLineIndex === -1) {
      regions.push({ startOffset, endOffset: text.length });
      break;
    }

    const closerLine = lines[closerLineIndex];
    const endOffset =
      closerLine.offset + closerLine.content.length + closerLine.newlineLength;
    regions.push({ startOffset, endOffset });
    i = closerLineIndex + 1;
  }

  return regions;
}

/**
 * Returns true when `offset` falls strictly inside a fence — after the start
 * of an opener line and before the end of its closer line. An offset exactly
 * on a fence opener's start or exactly past a closer's end is outside.
 */
export function isOpenAt(text: string, offset: number): boolean {
  for (const region of findFenceRegions(text)) {
    if (offset > region.startOffset && offset < region.endOffset) {
      return true;
    }
  }
  return false;
}

/**
 * If `candidateOffset` falls inside a fence, returns the offset immediately
 * after the corresponding closer (or `text.length` if the fence is unclosed).
 * Otherwise returns `candidateOffset` unchanged.
 */
export function nextSafeOffset(text: string, candidateOffset: number): number {
  for (const region of findFenceRegions(text)) {
    if (candidateOffset > region.startOffset && candidateOffset < region.endOffset) {
      return region.endOffset;
    }
  }
  return candidateOffset;
}

/**
 * Returns true if `chunk` ends while inside an open fence — i.e. its triple-
 * backtick/tilde count is odd in a way that leaves a dangling opener.
 */
export function hasOpenFenceAtEnd(chunk: string): boolean {
  const regions = findFenceRegions(chunk);
  if (regions.length === 0) return false;
  const last = regions[regions.length - 1];
  if (last.endOffset !== chunk.length) return false;
  // Region reached end of input — confirm it's because there was no closer.
  const lines = splitLinesWithOffsets(chunk.slice(last.startOffset));
  if (lines.length < 2) return true;
  const opener = FENCE_OPENER.exec(lines[0].content);
  if (!opener) return false;
  return !isClosingFence(lines[lines.length - 1].content, opener[1][0], opener[1].length);
}
