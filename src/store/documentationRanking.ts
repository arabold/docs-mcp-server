import { parseUrl, sectionQueryBase } from "../utils/sections";
import type { DbPageChunk } from "./types";

function words(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .trim();
}

function containsPhrase(text: string, phrase: string): boolean {
  return Boolean(phrase) && ` ${text} `.includes(` ${phrase} `);
}

/**
 * Checks whether a result contains an explicitly requested code identifier or CLI flag.
 * @param query The original request.
 * @param content The candidate snippets.
 * @returns Whether each explicit identifier occurs in the snippets.
 */
export function includesRequestedIdentifiers(query: string, content: string): boolean {
  const requested = requestedIdentifiers(query);
  return requested.every((identifier) => mentionsIdentifier(content, identifier));
}

/**
 * Counts distinct explicit identifiers supported by a Markdown passage.
 * @param query The original search request.
 * @param content The passage to inspect.
 * @returns Number of requested symbols or flags found in the passage.
 */
export function countRequestedIdentifiers(query: string, content: string): number {
  return requestedIdentifiers(query).filter((name) => mentionsIdentifier(content, name))
    .length;
}

/**
 * Extracts identifiers, function calls and flags named in a documentation query.
 * @param query The original search request.
 * @returns Distinct technical terms in query order.
 */
export function requestedIdentifiers(query: string): string[] {
  const tokens =
    query.match(/https?:\/\/\S+|--[\w-]+|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+(?![\w$])|[A-Za-z_$][\w$]*(?:\(\))?/g) ??
    [];
  const names = tokens
    .filter(
      (token) =>
        !token.includes("://") &&
        (token.startsWith("--") ||
          /[.(]/.test(token) ||
          /[a-z\d][A-Z]|^[A-Z]{2,}[a-z]|\w+_\w+/.test(token)),
    )
    .map((token) => token.replace(/\(\)$/, ""));
  return [...new Set(names)].slice(0, 8);
}

function escapePattern(name: string): string {
  return name.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
}

function mentionsIdentifier(text: string, name: string): boolean {
  const boundary = name.startsWith("--") ? "\\w-" : "\\w$";
  const startBoundary = name.includes(".") ? boundary + "." : boundary;
  return new RegExp(
    "(^|[^" + startBoundary + "])" + escapePattern(name) + "(?![" + boundary + "])",
  ).test(text);
}

/**
 * Counts identifiers defined by a Markdown option or parameter table.
 * @param query The original search request.
 * @param content Content of the passage or table.
 * @returns Number of identifiers found in the first column of a table row.
 */
export function countDocumentedOptions(query: string, content: string): number {
  return requestedIdentifiers(query).filter((name) =>
    new RegExp(
      "^[ \\t]*\\|[ \\t]*\x60?" + escapePattern(name) + "\\??\x60?[ \\t]*\\|",
      "m",
    ).test(content),
  ).length;
}

/**
 * Ranks exact documentation targets ahead of general text matches.
 * @param query The documentation search terms.
 * @param chunk A candidate with its indexed title and section.
 * @returns A priority tier, where higher values appear first.
 */
export function documentationPriority(query: string, chunk: DbPageChunk): number {
  const pathname = parseUrl(chunk.url)?.pathname ?? chunk.url;
  if (/\/llms-full\.txt$/i.test(pathname)) return 0;

  const terms = words(query);
  const title = words(chunk.title?.split(/\s+(?:[|–—]|::)\s+/)[0] ?? "");
  const pageName = words(pathname.split("/").filter(Boolean).at(-1) ?? "");
  const command = words(pathname.split("/reference/cli/").at(1) ?? "");
  const reference = /\/(?:api(?:-reference)?|reference|man)\//i.test(pathname);
  const options = countDocumentedOptions(query, chunk.content);
  const symbols = requestedIdentifiers(query).filter((name) => !name.startsWith("--"));
  const headings = (chunk.metadata.path ?? []).slice(1);
  const definesSymbol = symbols.some((name) =>
    headings.some((heading) =>
      mentionsIdentifier(heading, name) && mentionsIdentifier(chunk.content, name),
    ),
  );
  if (containsPhrase(terms, command)) return 20 + options;
  if (options) return 7 + options;
  if (definesSymbol && reference) return 6;
  if (
    reference &&
    symbols.some(
      (name) =>
        mentionsIdentifier(chunk.title ?? "", name) && mentionsIdentifier(chunk.content, name),
    )
  ) {
    return 5;
  }
  if (title.includes(" ") && containsPhrase(terms, title)) {
    return 3;
  }
  if (reference && pageName.length >= 3 && containsPhrase(terms, pageName)) {
    return 2;
  }

  return countRequestedIdentifiers(query, chunk.content) > 0 ? 1 : 0;
}

/**
 * Drops repeated hits to identical stored chunks under different section URLs.
 * @param ranked Candidates in priority and relevance order.
 * @param limit Number of distinct chunks to return.
 * @returns Candidates in the same order with room for unique hits.
 */
export function distinctDocumentationMatches<T extends DbPageChunk>(
  ranked: T[],
  limit: number,
): T[] {
  const seen = new Map<string, string>();
  const kept: T[] = [];
  for (const chunk of ranked) {
    const url = parseUrl(chunk.url);
    const base =
      sectionQueryBase(chunk.url) ??
      (url && !url.search && !url.hash ? url.href : undefined);
    if (base) {
      const key = JSON.stringify([
        base,
        chunk.sort_order,
        chunk.metadata.path,
        chunk.content,
      ]);
      const previous = seen.get(key);
      if (previous && previous !== chunk.url) continue;
      seen.set(key, chunk.url);
    }
    kept.push(chunk);
    if (kept.length === limit) break;
  }
  return kept;
}
