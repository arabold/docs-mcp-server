/**
 * Tracks whether a markdown string ends inside an open fenced code block. Used
 * by content splitters to avoid cutting chunks in the middle of a fence, which
 * would leave one chunk with an unmatched opener and the next chunk with an
 * unmatched closer.
 *
 * Follows CommonMark fence semantics for the cases that matter to us: a fence
 * is a line whose only leading non-whitespace content is three or more
 * identical backticks or three or more identical tildes. The closing fence
 * must use the same character and at least as many of them as the opener.
 * Backticks and tildes do not pair across types.
 */

// Recognise a fence opener with any leading horizontal whitespace and any
// number of blockquote (`>`) prefix markers. CommonMark itself restricts
// fences to ≤3 leading spaces, but Turndown emits 4-space indented fences
// inside list items and blockquote-prefixed fences inside `> ` blocks, and
// downstream consumers (LLMs, renderers not strictly CommonMark-aware) still
// treat the literal ``` / ~~~ as a fence. For our balance invariant we
// recognise any leading indentation/blockquote-prefix combination.
const FENCE_PREFIX = "[ \\t]*(?:>[ \\t]*)*";
const FENCE_OPENER = new RegExp(`^(${FENCE_PREFIX})(\`{3,}|~{3,})`);

/** A fence opener read from a single line. */
export interface FenceOpener {
  /** Indentation and blockquote markers before the fence characters. */
  prefix: string;
  /** The fence character, a backtick or a tilde. */
  delimiter: string;
  /** How many fence characters the opener uses. */
  length: number;
}

/**
 * Reads a fence opener from one line.
 *
 * @param line A single line, without its newline.
 * @returns The opener's parts, or null when the line does not open a fence.
 */
export function parseFenceOpener(line: string): FenceOpener | null {
  const match = FENCE_OPENER.exec(line);
  if (!match) return null;
  return { prefix: match[1], delimiter: match[2][0], length: match[2].length };
}

/**
 * Builds the pattern for the line that closes a fence: the same character, at
 * least as many of them, and as permissive about the prefix as the opener.
 */
function closingFencePattern(opener: FenceOpener): RegExp {
  return new RegExp(`^${FENCE_PREFIX}\\${opener.delimiter}{${opener.length},}[ \\t]*$`);
}

/**
 * Follows fence state across consecutive pieces of one text.
 *
 * Callers that join pieces in order can ask whether the text so far ends
 * inside a fence without rescanning it, which keeps a document with a long or
 * unclosed fence linear instead of quadratic.
 */
export class FenceTracker {
  /** Matches the line that closes the open fence, or null while none is open. */
  private closer: RegExp | null = null;
  private partialLine = "";

  /**
   * Adds the next piece of the text.
   *
   * @param text The piece, joined directly after the previous one.
   */
  feed(text: string): void {
    const lines = `${this.partialLine}${text}`.split("\n");
    this.partialLine = lines.pop() ?? "";
    for (const line of lines) {
      this.closer = this.next(this.closer, line);
    }
  }

  /**
   * Reports whether the text fed so far ends inside an open fence. A trailing
   * line without its newline counts as a whole line.
   *
   * @returns True when a fence is open at the end of the text.
   */
  isOpen(): boolean {
    const closer = this.partialLine
      ? this.next(this.closer, this.partialLine)
      : this.closer;
    return closer !== null;
  }

  private next(closer: RegExp | null, line: string): RegExp | null {
    if (closer === null) {
      const opener = parseFenceOpener(line);
      return opener ? closingFencePattern(opener) : null;
    }
    return closer.test(line) ? null : closer;
  }
}

/**
 * Returns true if `chunk` ends while inside an open fence, leaving a dangling
 * opener.
 *
 * @param chunk The text to check.
 * @returns True when a fence is open at the end of `chunk`.
 */
export function hasOpenFenceAtEnd(chunk: string): boolean {
  const tracker = new FenceTracker();
  tracker.feed(chunk);
  return tracker.isOpen();
}
