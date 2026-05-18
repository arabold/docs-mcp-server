/**
 * Promptfoo JS assertion: compute deterministic IR metrics for one query.
 *
 * Promptfoo invokes the default export with (output, { vars, providerOutput }).
 * We pull the ranked URL list from providerOutput.metadata and the qrels
 * from the test case's vars, then return the full metric bundle as
 * componentResults so each individual metric appears in the report.
 */

const path = require("node:path");
const { computeIrMetrics } = require(path.join(__dirname, "..", "lib", "metrics.cjs"));

function extractRanked(providerOutput, output) {
  // Preferred path: structured providerOutput.metadata.
  const meta = providerOutput && providerOutput.metadata;
  if (meta && Array.isArray(meta.results)) {
    return meta.results
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((r) => r.url);
  }
  // Fallback: parse the JSON blob printed to stdout. Older promptfoo versions
  // expose `output` as the raw stdout when using exec providers.
  if (typeof output === "string") {
    const m = output.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]);
        if (parsed.metadata && Array.isArray(parsed.metadata.results)) {
          return parsed.metadata.results.map((r) => r.url);
        }
      } catch (_e) {}
    }
  }
  return [];
}

module.exports = (output, context) => {
  const vars = (context && context.vars) || {};
  const qrels = Array.isArray(vars.qrels) ? vars.qrels : [];
  const ranked = extractRanked(context && context.providerOutput, output);

  if (qrels.length === 0) {
    return {
      pass: false,
      score: 0,
      reason: "Test case has no qrels — cannot compute IR metrics.",
    };
  }
  if (ranked.length === 0) {
    return {
      pass: false,
      score: 0,
      reason: "Provider returned no results — IR metrics are zero.",
      componentResults: zeroComponentResults(),
    };
  }

  const m = computeIrMetrics(ranked, qrels);
  const headlineScore = m.ndcg_at_5; // What the report's overall row will show.

  return {
    pass: true,
    score: headlineScore,
    reason: `nDCG@5=${m.ndcg_at_5.toFixed(3)} MRR=${m.mrr.toFixed(3)} R@5=${m.recall_at_5.toFixed(3)} Hit@3=${m.hit_at_3}`,
    namedScores: m, // Surfaced as separate columns in promptfoo's report.
    componentResults: [
      named("mrr", m.mrr),
      named("recall_at_3", m.recall_at_3),
      named("recall_at_5", m.recall_at_5),
      named("recall_at_10", m.recall_at_10),
      named("ndcg_at_5", m.ndcg_at_5),
      named("ndcg_at_10", m.ndcg_at_10),
      named("hit_at_1", m.hit_at_1),
      named("hit_at_3", m.hit_at_3),
      named("hit_at_5", m.hit_at_5),
    ],
  };
};

function named(name, value) {
  return {
    pass: true,
    score: value,
    reason: `${name}=${typeof value === "number" ? value.toFixed(3) : value}`,
    assertion: { type: "javascript", value: `ir:${name}` },
  };
}

function zeroComponentResults() {
  return [
    "mrr",
    "recall_at_3",
    "recall_at_5",
    "recall_at_10",
    "ndcg_at_5",
    "ndcg_at_10",
    "hit_at_1",
    "hit_at_3",
    "hit_at_5",
  ].map((n) => named(n, 0));
}
