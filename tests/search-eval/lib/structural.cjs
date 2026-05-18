/**
 * Deterministic structural checks on returned chunks.
 * No LLM calls. Used both from promptfoo JS assertions and the TS aggregator.
 */

/**
 * Triple-backtick fences must appear in pairs.
 */
function codeBlockBalance(content) {
  if (typeof content !== "string") return false;
  const fences = (content.match(/```/g) || []).length;
  return fences % 2 === 0;
}

function nonEmptyContent(content) {
  return typeof content === "string" && content.trim().length > 0;
}

function urlPresence(url) {
  return typeof url === "string" && url.trim().length > 0;
}

/**
 * Run all structural checks against a list of result records.
 * Returns per-check pass status for the *query* (all results must pass).
 */
function runStructuralChecks(results) {
  const checks = {
    code_block_balance: true,
    non_empty_content: true,
    url_presence: true,
  };
  for (const r of results || []) {
    if (!codeBlockBalance(r.content)) checks.code_block_balance = false;
    if (!nonEmptyContent(r.content)) checks.non_empty_content = false;
    if (!urlPresence(r.url)) checks.url_presence = false;
  }
  return checks;
}

module.exports = {
  codeBlockBalance,
  nonEmptyContent,
  urlPresence,
  runStructuralChecks,
};
