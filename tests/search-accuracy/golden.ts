/**
 * Golden set of the search accuracy benchmark: queries labelled with the
 * passages that answer them.
 */

import { readFileSync } from "node:fs";
import { parse } from "yaml";

/** How a query is phrased. */
export const QUERY_STYLES = [
  "keywords",
  "identifier",
  "question",
  "agent-request",
] as const;
export type QueryStyle = (typeof QUERY_STYLES)[number];

/** What a query is after. */
export const QUERY_INTENTS = [
  "api-lookup",
  "how-to",
  "conceptual",
  "comparison",
  "troubleshooting",
] as const;
export type QueryIntent = (typeof QUERY_INTENTS)[number];

/** A passage that answers a query, on one page of the corpus. */
export interface GoldenPassage {
  /** Path of the page relative to its library's indexed root. */
  page: string;
  /** The passage as it appears in the indexed content. */
  text: string;
  /** 3 answers the query directly, 2 answers part of it, 1 is useful context. */
  grade: 1 | 2 | 3;
}

/** A labelled query. */
export interface GoldenQuery {
  id: string;
  library: string;
  query: string;
  intent: QueryIntent;
  style: QueryStyle;
  passages: GoldenPassage[];
}

/** The parsed golden set. */
export interface GoldenSet {
  status: string;
  queries: GoldenQuery[];
}

/** Coverage the full golden set has to meet. */
export const COVERAGE = {
  minQueries: 100,
  minLibraries: 4,
  maxLibraryShare: 0.4,
  minStyleShare: 0.1,
} as const;

/** Thrown when the golden set is malformed or misses its coverage rules. */
export class GoldenSetError extends Error {
  constructor(
    source: string,
    readonly problems: string[],
  ) {
    super(`${source} is invalid:\n  ${problems.join("\n  ")}`);
    this.name = "GoldenSetError";
  }
}

/**
 * Reads the golden set and checks every entry and the coverage rules.
 *
 * @param path Path of `golden.yaml`.
 * @param libraries Libraries the corpus provides; a query for any other is rejected.
 * @returns The golden set.
 * @throws GoldenSetError listing every problem found.
 */
export function loadGoldenSet(path: string, libraries: string[]): GoldenSet {
  const set = parseGoldenSet(parse(readFileSync(path, "utf8")), libraries, path);
  const problems = checkCoverage(set.queries);
  if (problems.length > 0) throw new GoldenSetError(path, problems);
  return set;
}

/**
 * Checks the shape of every entry of a parsed golden set.
 *
 * @param raw The parsed YAML document.
 * @param libraries Libraries the corpus provides.
 * @param source Name used in the error message.
 * @throws GoldenSetError listing every malformed entry.
 */
export function parseGoldenSet(
  raw: unknown,
  libraries: string[],
  source: string,
): GoldenSet {
  const document = raw as { status?: unknown; queries?: unknown } | null;
  if (!document || !Array.isArray(document.queries)) {
    throw new GoldenSetError(source, ['"queries" must be a list']);
  }

  const problems: string[] = [];
  const ids = new Set<string>();
  const queries = document.queries.map((entry: Partial<GoldenQuery>, index: number) => {
    const where = typeof entry?.id === "string" ? entry.id : `queries[${index}]`;
    if (typeof entry?.id !== "string" || !/^[a-z0-9-]+$/.test(entry.id)) {
      problems.push(`${where}: "id" must use lower-case letters, digits and hyphens`);
    } else if (ids.has(entry.id)) {
      problems.push(`${where}: duplicate id`);
    } else {
      ids.add(entry.id);
    }
    if (typeof entry?.library !== "string" || !libraries.includes(entry.library)) {
      problems.push(`${where}: "library" must be one of ${libraries.join(", ")}`);
    }
    if (typeof entry?.query !== "string" || entry.query.trim() === "") {
      problems.push(`${where}: "query" must be a non-empty string`);
    }
    if (!QUERY_INTENTS.includes(entry?.intent as QueryIntent)) {
      problems.push(`${where}: "intent" must be one of ${QUERY_INTENTS.join(", ")}`);
    }
    if (!QUERY_STYLES.includes(entry?.style as QueryStyle)) {
      problems.push(`${where}: "style" must be one of ${QUERY_STYLES.join(", ")}`);
    }
    if (!Array.isArray(entry?.passages) || entry.passages.length === 0) {
      problems.push(`${where}: needs at least one passage`);
    } else {
      entry.passages.forEach((passage: Partial<GoldenPassage>, passageIndex: number) => {
        const at = `${where} passages[${passageIndex}]`;
        if (typeof passage?.page !== "string" || passage.page.trim() === "") {
          problems.push(`${at}: "page" must be a non-empty path`);
        }
        if (typeof passage?.text !== "string" || passage.text.trim() === "") {
          problems.push(`${at}: "text" must be a non-empty string`);
        }
        if (passage?.grade !== 1 && passage?.grade !== 2 && passage?.grade !== 3) {
          problems.push(`${at}: "grade" must be 1, 2 or 3`);
        }
      });
    }
    return entry as GoldenQuery;
  });

  if (problems.length > 0) throw new GoldenSetError(source, problems);
  return { status: String(document.status ?? "draft"), queries };
}

/**
 * Lists the coverage rules a set of queries breaks.
 *
 * @param queries The full golden set.
 * @returns One message per broken rule; empty when the set is covered.
 */
export function checkCoverage(queries: GoldenQuery[]): string[] {
  const problems: string[] = [];
  const total = queries.length;
  if (total < COVERAGE.minQueries) {
    problems.push(`has ${total} queries; needs at least ${COVERAGE.minQueries}`);
  }

  const perLibrary = countBy(queries, (query) => query.library);
  if (perLibrary.size < COVERAGE.minLibraries) {
    problems.push(
      `covers ${perLibrary.size} libraries; needs at least ${COVERAGE.minLibraries}`,
    );
  }
  for (const [library, count] of perLibrary) {
    if (count / total > COVERAGE.maxLibraryShare) {
      problems.push(
        `library "${library}" has ${count} of ${total} queries; at most ${COVERAGE.maxLibraryShare * 100}% allowed`,
      );
    }
  }

  const perStyle = countBy(queries, (query) => query.style);
  for (const style of QUERY_STYLES) {
    const count = perStyle.get(style) ?? 0;
    if (count / Math.max(total, 1) < COVERAGE.minStyleShare) {
      problems.push(
        `style "${style}" has ${count} of ${total} queries; needs at least ${COVERAGE.minStyleShare * 100}%`,
      );
    }
  }
  return problems;
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}
