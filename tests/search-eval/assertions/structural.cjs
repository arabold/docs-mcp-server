/**
 * Promptfoo JS assertion: deterministic structural checks across the
 * returned chunks. Three checks reported as separate components.
 */

const path = require("node:path");
const { runStructuralChecks } = require(
  path.join(__dirname, "..", "lib", "structural.cjs"),
);

function extractResults(providerOutput, output) {
  const meta = providerOutput && providerOutput.metadata;
  if (meta && Array.isArray(meta.results)) return meta.results;
  if (typeof output === "string") {
    const m = output.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]);
        if (parsed.metadata && Array.isArray(parsed.metadata.results)) {
          return parsed.metadata.results;
        }
      } catch (_e) {}
    }
  }
  return [];
}

module.exports = (output, context) => {
  const results = extractResults(context && context.providerOutput, output);
  const checks = runStructuralChecks(results);
  const allPassed =
    checks.code_block_balance && checks.non_empty_content && checks.url_presence;

  return {
    pass: allPassed,
    score: allPassed ? 1 : 0,
    reason: `code_block_balance=${checks.code_block_balance} non_empty_content=${checks.non_empty_content} url_presence=${checks.url_presence}`,
    namedScores: {
      structural_code_block_balance: checks.code_block_balance ? 1 : 0,
      structural_non_empty_content: checks.non_empty_content ? 1 : 0,
      structural_url_presence: checks.url_presence ? 1 : 0,
    },
    componentResults: [
      booleanComponent("structural:code_block_balance", checks.code_block_balance),
      booleanComponent("structural:non_empty_content", checks.non_empty_content),
      booleanComponent("structural:url_presence", checks.url_presence),
    ],
  };
};

function booleanComponent(label, pass) {
  return {
    pass,
    score: pass ? 1 : 0,
    reason: `${label}=${pass}`,
    assertion: { type: "javascript", value: label },
  };
}
