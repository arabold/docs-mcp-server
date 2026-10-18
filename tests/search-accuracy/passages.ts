/**
 * Matching golden passages against search results.
 *
 * Both sides are reduced to their sequence of words, so Markdown syntax,
 * punctuation, case and line breaks do not decide whether a result holds a
 * passage. Link targets are dropped first, so a passage may quote a link by
 * its text alone.
 */

/** How a text holds a passage: all of it, at least half of it (cut by the splitter), or not. */
export type PassageMatch = "whole" | "split" | null;

/**
 * Reduces Markdown text to lower-case words separated by single spaces.
 *
 * @param text Markdown or plain text.
 * @returns The words of the text, in order.
 */
export function normalizeWords(text: string): string[] {
  const withoutLinkTargets = text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");
  return withoutLinkTargets.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Tells whether a text holds a passage.
 *
 * @param content The text of a search result.
 * @param passage The golden passage.
 * @returns `"whole"` when the content holds every word of the passage in order,
 *   `"split"` when it holds an unbroken run of at least half of them, `null` otherwise.
 */
export function matchPassage(content: string, passage: string): PassageMatch {
  const passageWords = normalizeWords(passage);
  if (passageWords.length === 0) return null;
  const contentWords = normalizeWords(content);
  if (` ${contentWords.join(" ")} `.includes(` ${passageWords.join(" ")} `)) {
    return "whole";
  }
  const longestRun = longestCommonRun(contentWords, passageWords);
  return longestRun * 2 >= passageWords.length ? "split" : null;
}

/** Length of the longest run of consecutive words shared by both lists. */
function longestCommonRun(a: string[], b: string[]): number {
  let best = 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) best = current[j];
      }
    }
    previous = current;
  }
  return best;
}

/**
 * Tells whether a result URL is the page a passage names.
 *
 * @param url The `file://` URL of an indexed page.
 * @param page The page path relative to its library's indexed root.
 */
export function isPage(url: string, page: string): boolean {
  const decoded = decodeURIComponent(url).replace(/\\/g, "/");
  return decoded.endsWith(`/${page.replace(/^\/+/, "")}`);
}
