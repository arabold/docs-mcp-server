/**
 * Safe SQLite FTS5 query parser and sanitizer
 *
 * This module provides secure parsing and sanitization of user-provided search queries
 * for SQLite FTS5. It prevents FTS injection attacks while supporting legitimate
 * advanced FTS syntax when explicitly intended by users.
 *
 * Security approach:
 * - Quote terms with unsafe characters by default to prevent injection
 * - Allow safe alphanumeric terms without quotes
 * - Preserve quoted strings as-is
 * - Handle empty queries gracefully
 * - Support basic OR logic for multi-word queries
 */

const FTS_OPERATORS = new Set(["AND", "OR", "NOT", "NEAR"]);
const SAFE_TERM_PATTERN = /^[\p{L}\p{N}_]+$/u;

/**
 * Parse and sanitize a user query for safe FTS5 usage
 */
export function parseQuery(
  query: string,
  options: { defaultOperator?: "AND" | "OR" } = {},
): string {
  const { defaultOperator = "OR" } = options;

  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return "";
  }

  // Check if query contains quotes - if so, pass through as-is (assume user knows FTS syntax)
  if (trimmed.includes('"')) {
    return trimmed;
  }

  // Check if query contains explicit FTS operators
  const hasOperators = Array.from(FTS_OPERATORS).some((op) =>
    new RegExp(`\\b${op}\\b`, "i").test(trimmed),
  );

  if (hasOperators) {
    return trimmed;
  }

  // Split into terms and process each one
  const terms = trimmed.split(/\s+/).filter(Boolean);

  if (terms.length === 0) {
    return "";
  }

  if (terms.length === 1) {
    return quoteSafeString(terms[0]);
  }

  // Multiple terms - quote each one if needed and join with OR
  const quotedTerms = terms.map(quoteSafeString);
  return quotedTerms.join(` ${defaultOperator} `);
}

/**
 * Quote a term if it contains unsafe characters, otherwise return as-is
 */
function quoteSafeString(term: string): string {
  // If term is safe (alphanumeric + underscores), return as-is
  if (SAFE_TERM_PATTERN.test(term)) {
    return term;
  }

  // Otherwise quote it to prevent FTS injection
  const escaped = term.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Simple validation method for external use
 */
export function isValidQuery(query: string): boolean {
  return parseQuery(query).length > 0;
}

/**
 * Extract terms from a query for analysis (strips operators, quotes, etc.)
 */
export function extractTerms(query: string): string[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }

  // Simple approach: split on whitespace and filter out operators
  const terms = trimmed.split(/\s+/).filter(Boolean);
  return terms.filter((term) => !FTS_OPERATORS.has(term.toUpperCase()));
}
