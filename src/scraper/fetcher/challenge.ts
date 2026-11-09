/**
 * Recognition of bot-protection challenge pages that a site serves in place of
 * the requested document, with a success status.
 */

/**
 * How much of a document is inspected. Challenge pages are a few kilobytes and
 * carry their markers in the head, so a documentation page that merely
 * mentions them further down is not mistaken for one.
 */
const SCAN_LIMIT = 64 * 1024;

/** The title of Fastly's client challenge page. */
const FASTLY_CHALLENGE_TITLE = /<title>\s*Client Challenge\s*<\/title>/i;

/** The path prefix Fastly serves the challenge's scripts and assets from. */
const FASTLY_CHALLENGE_ASSET_PATH = "/_fs-ch-";

/**
 * Detects a challenge page that answered a request in place of the document.
 *
 * Recognizes Fastly's client challenge (served by pypi.org, among others): a
 * page titled "Client Challenge" whose scripts load from `/_fs-ch-<id>/`. It is
 * served with status 200 and stays in place in a headless browser.
 *
 * @param html The HTML as served, or as rendered by a browser.
 * @returns The challenge type to report in a `ChallengeError`, or null when the
 * document is not a known challenge page.
 */
export function detectChallengePage(html: string | Buffer): string | null {
  const head =
    typeof html === "string"
      ? html.slice(0, SCAN_LIMIT)
      : html.subarray(0, SCAN_LIMIT).toString("utf-8");

  if (FASTLY_CHALLENGE_TITLE.test(head) && head.includes(FASTLY_CHALLENGE_ASSET_PATH)) {
    return "fastly";
  }
  return null;
}
