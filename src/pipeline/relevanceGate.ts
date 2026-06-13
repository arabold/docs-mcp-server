/**
 * Relevance gate helpers: path/scope coherence and `expectTerms` sampling.
 *
 * Pure functions with no I/O, fully unit-testable. Consumed by the
 * PipelineManager quality-gate seam to compute the optional relevance axes
 * (SCOPE_DRIFT and OFF_TOPIC) when a caller opts in via `expectTerms`.
 *
 * @module relevanceGate
 */

/**
 * Normalizes a URL to a host-qualified, ref-agnostic path for scope comparison.
 *
 * GitHub blob/tree URLs collapse `/owner/repo/(blob|tree)/<branch>/<rest>` to
 * `/owner/repo/<rest>` so a `/tree/` root and its `/blob/` children align
 * (review F1). Non-GitHub URLs keep their pathname unchanged. A trailing slash
 * is stripped so prefix comparisons behave consistently.
 *
 * @param rawUrl - The URL to normalize.
 * @returns The host and ref-agnostic path, or null if the URL cannot be parsed.
 */
export function toScopeKey(rawUrl: string): { host: string; path: string } | null {
  try {
    const u = new URL(rawUrl);
    let path = u.pathname;
    if (u.hostname.endsWith("github.com")) {
      const ref = path.match(/^\/([^/]+)\/([^/]+)\/(?:blob|tree)\/[^/]+\/(.*)$/);
      if (ref) {
        path = `/${ref[1]}/${ref[2]}/${ref[3]}`;
      } else {
        const base = path.match(/^\/([^/]+)\/([^/]+)/);
        if (base) path = `/${base[1]}/${base[2]}`;
      }
    }
    return { host: u.hostname, path: path.replace(/\/+$/, "") };
  } catch {
    return null;
  }
}

/**
 * Computes the fraction (0..1) of `indexedUrls` whose scope key is under the
 * root URL's scope key (same host, path prefix). Returns 0 when there are no
 * indexed URLs or the root is unparseable.
 *
 * @param rootUrl - The requested scrape root.
 * @param indexedUrls - The URLs actually indexed.
 * @returns The in-scope ratio in the range 0..1.
 */
export function computeInScopeRatio(rootUrl: string, indexedUrls: string[]): number {
  if (indexedUrls.length === 0) return 0;
  const root = toScopeKey(rootUrl);
  if (!root) return 0;
  const inScope = indexedUrls.filter((u) => {
    const k = toScopeKey(u);
    return k !== null && k.host === root.host && k.path.startsWith(root.path);
  }).length;
  return inScope / indexedUrls.length;
}

/**
 * Returns true if any sampled chunk contains any expected term
 * (case-insensitive substring match). An empty `expectTerms` list is treated
 * as a pass (no expectation to satisfy).
 *
 * @param chunks - Sampled chunk contents.
 * @param expectTerms - Terms expected to appear in the indexed docs.
 * @returns Whether at least one term was found.
 */
export function sampleExpectTermsMatch(chunks: string[], expectTerms: string[]): boolean {
  if (expectTerms.length === 0) return true;
  const haystack = chunks.join("\n").toLowerCase();
  return expectTerms.some((t) => haystack.includes(t.toLowerCase()));
}
