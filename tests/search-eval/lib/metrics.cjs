/**
 * Deterministic IR metrics for the search-quality benchmark.
 *
 * CommonJS so it can be required from both:
 *   - promptfoo JS assertions (which evaluate as CJS)
 *   - the TypeScript aggregator (via createRequire / dynamic import)
 *
 * No external dependencies. Pure functions over (rankedUrls, qrels).
 */

/**
 * Build a Map<url, grade> from a list of qrels.
 * @param {{url: string, grade: number}[]} qrels
 * @returns {Map<string, number>}
 */
function qrelsToMap(qrels) {
  const m = new Map();
  for (const q of qrels || []) {
    if (q && typeof q.url === "string" && typeof q.grade === "number") {
      m.set(q.url, q.grade);
    }
  }
  return m;
}

/**
 * Mean Reciprocal Rank: 1 / (1-based rank of first relevant hit), 0 if none.
 * @param {string[]} ranked
 * @param {Map<string, number>} relevant
 */
function mrr(ranked, relevant) {
  for (let i = 0; i < ranked.length; i++) {
    if (relevant.has(ranked[i])) return 1 / (i + 1);
  }
  return 0;
}

/**
 * Recall@k: fraction of DISTINCT relevant URLs found in the top-k.
 *
 * Our search returns chunks, and multiple chunks can come from the same URL —
 * counting raw occurrences would push Recall above 1.0 when the top-k is
 * dominated by repeated hits on the same canonical page. Standard IR Recall
 * counts each relevant URL at most once.
 */
function recallAtK(ranked, relevant, k) {
  if (relevant.size === 0) return 0;
  const seen = new Set();
  for (const url of ranked.slice(0, k)) {
    if (relevant.has(url)) seen.add(url);
  }
  return seen.size / relevant.size;
}

/**
 * Hit@k: 1 if any relevant URL is in the top-k, else 0.
 */
function hitAtK(ranked, relevant, k) {
  const topK = ranked.slice(0, k);
  for (const url of topK) if (relevant.has(url)) return 1;
  return 0;
}

/**
 * DCG@k with graded relevance.
 * Uses the standard formulation: sum_{i=1..k} (2^rel_i - 1) / log2(i + 1).
 *
 * When the same URL appears multiple times in the ranking (different chunks
 * from the same page), only the FIRST occurrence contributes. Without this,
 * a result list of [pathlib, pathlib, pathlib, pathlib, pathlib] would count
 * the qrel grade five times and produce nDCG well above 1.0.
 */
function dcgAtK(ranked, relevant, k) {
  let s = 0;
  const counted = new Set();
  const limit = Math.min(k, ranked.length);
  for (let i = 0; i < limit; i++) {
    const url = ranked[i];
    if (counted.has(url)) continue;
    counted.add(url);
    const rel = relevant.get(url) ?? 0;
    if (rel > 0) s += (Math.pow(2, rel) - 1) / Math.log2(i + 2);
  }
  return s;
}

/**
 * Ideal DCG@k: DCG of the qrels sorted by descending grade, truncated to k.
 */
function idealDcgAtK(relevant, k) {
  const grades = Array.from(relevant.values()).sort((a, b) => b - a).slice(0, k);
  let s = 0;
  for (let i = 0; i < grades.length; i++) {
    s += (Math.pow(2, grades[i]) - 1) / Math.log2(i + 2);
  }
  return s;
}

/**
 * nDCG@k: DCG@k / ideal DCG@k, or 0 if no relevant docs.
 */
function ndcgAtK(ranked, relevant, k) {
  const ideal = idealDcgAtK(relevant, k);
  if (ideal === 0) return 0;
  return dcgAtK(ranked, relevant, k) / ideal;
}

/**
 * Compute the full per-query IR metric bundle.
 * @param {string[]} ranked The ordered list of result URLs (top first).
 * @param {{url: string, grade: number}[]} qrels
 */
function computeIrMetrics(ranked, qrels) {
  const relevant = qrelsToMap(qrels);
  return {
    mrr: mrr(ranked, relevant),
    recall_at_3: recallAtK(ranked, relevant, 3),
    recall_at_5: recallAtK(ranked, relevant, 5),
    recall_at_10: recallAtK(ranked, relevant, 10),
    ndcg_at_5: ndcgAtK(ranked, relevant, 5),
    ndcg_at_10: ndcgAtK(ranked, relevant, 10),
    hit_at_1: hitAtK(ranked, relevant, 1),
    hit_at_3: hitAtK(ranked, relevant, 3),
    hit_at_5: hitAtK(ranked, relevant, 5),
  };
}

/**
 * Arithmetic mean. Returns 0 for empty input rather than NaN so downstream
 * arithmetic (regression deltas) does not blow up on an empty intent slice.
 */
function mean(xs) {
  if (!xs || xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

module.exports = {
  qrelsToMap,
  mrr,
  recallAtK,
  hitAtK,
  dcgAtK,
  idealDcgAtK,
  ndcgAtK,
  computeIrMetrics,
  mean,
};
