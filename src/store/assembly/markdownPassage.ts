import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { sectionSlug } from "../../utils/sections";
import {
  countDocumentedOptions,
  countRequestedIdentifiers,
  requestedIdentifiers,
} from "../documentationRanking";

const markdown = unified().use(remarkParse).use(remarkGfm);

type MarkdownSection = {
  heading: string;
  markup: string;
  blocks: string[];
};

function escapePattern(value: string): string {
  return value.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
}

/**
 * Finds the API names a question names explicitly or shares with the page's title.
 * @param query Documentation search terms.
 * @param title Title of the indexed page.
 * @param pageName Final component of the indexed path.
 * @returns Function and type names that can identify relevant code.
 */
export function requestedApiNames(query: string, title: string, pageName: string): string[] {
  const identifiers = requestedIdentifiers(query).filter((name) => !name.startsWith("--"));
  for (const candidate of [title, pageName]) {
    if (
      /^[A-Za-z_$][\w$]{2,}$/.test(candidate) &&
      new RegExp("(^|[^\\w$])" + escapePattern(candidate) + "(?![\\w$])", "i").test(query)
    ) {
      identifiers.push(candidate);
    }
  }
  return [...new Set(identifiers)].slice(0, 8);
}

type ApiContext = {
  names: string[];
  command?: string;
};

type UsageBlock = {
  markdown: string;
  value: string;
  kind: "signature" | "example";
  score: number;
};

function usageLine(block: string, command: RegExp): string | undefined {
  return block
    .split("\n")
    .find((line) => /\busage\b/i.test(line) && command.test(line))
    ?.replace(/^.*?\busage\b[\s:*|]+/i, "")
    .replace(/\s*\|\s*$/, "")
    .trim();
}

/**
 * Supplements a focused passage with stored syntax and one relevant example.
 * @param passage The selected explanation.
 * @param nearby Adjacent stored chunks and the page start.
 * @param query Search terms used to rank examples.
 * @param context API names or the command described by the reference page.
 * @param maxChars Target size for the combined passage.
 * @returns The passage with relevant blocks appended in their original Markdown.
 */
export function addUsageContext(
  passage: string,
  nearby: string,
  query: string,
  context: ApiContext,
  maxChars: number,
): string {
  const { names, command } = context;
  const apiCall = names.length
    ? new RegExp("(^|[^\\w$.])(?:" + names.map(escapePattern).join("|") + ")\\s*\\(", "m")
    : undefined;
  const commandLine = command
    ? new RegExp(
        "(^|[^\\w-])" + command.split(" ").map(escapePattern).join("\\s+") + "(?![\\w-])",
        "m",
      )
    : undefined;
  const candidates: UsageBlock[] = [];
  const terms = new Set(searchTerms(query));
  let headings: { depth: number; title: string }[] = [];
  let explanation = "";

  for (const node of markdown.parse(nearby).children) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    const block = nearby.slice(start, end);
    if (node.type === "heading") {
      headings = headings.filter(({ depth }) => depth < node.depth);
      headings.push({ depth: node.depth, title: headingText(node) });
      explanation = "";
      continue;
    }
    const section = headings.map(({ title }) => title).join(" ");
    const syntaxSection =
      /\b(?:parameters?|reference|signature|syntax|usage|arguments?)\b/i.test(section);
    const exampleSection = /\bexamples?\b/i.test(section);

    if (commandLine && (node.type === "paragraph" || node.type === "table")) {
      const usage = usageLine(block, commandLine);
      if (usage && /\[/.test(usage)) {
        candidates.push({
          markdown: "Usage: " + usage,
          value: usage,
          kind: "signature",
          score: 1,
        });
      }
    }

    if (
      node.type === "code" &&
      (apiCall?.test(node.value) || commandLine?.test(node.value))
    ) {
      const declaration = /^\s*(?:export\s+)?(?:async\s+)?(?:def|function|declare)\s/.test(
        node.value,
      );
      const bareCall = /^[\w$.]+\([\w$,\s.?[\]:|=]*\)$/.test(node.value.trim());
      const signature =
        !exampleSection &&
        node.value.trim().split("\n").length <= 4 &&
        (bareCall || declaration || (commandLine && /\[options?\]/i.test(node.value)) ||
          (syntaxSection && !/[='";{}]/.test(node.value)));
      candidates.push({
        markdown: block,
        value: node.value.trim(),
        kind: signature ? "signature" : "example",
        score:
          (exampleSection ? 2 : 0) +
          overlap(terms, [section, explanation, node.value].join(" ")) +
          countRequestedIdentifiers(query, node.value),
      });
    }
    explanation = node.type === "paragraph" ? block : "";
  }

  let result = passage;
  for (const kind of ["signature", "example"] as const) {
    const ranked = candidates
      .filter((item) => item.kind === kind)
      .sort((a, b) => b.score - a.score);
    if (ranked.some(({ value }) => passage.includes(value))) continue;
    const selected = ranked.find(
      ({ markdown }) => result.length + markdown.length + 2 <= maxChars,
    );
    if (selected) result += "\n\n" + selected.markdown;
  }
  return result;
}

function searchTerms(text: string): string[] {
  return (
    text
      .replace(/([a-z\d])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .match(/[\p{L}\p{N}]{3,}/gu) ?? []
  ).map((word) => (word.length > 4 ? word.replace(/s$/, "") : word));
}

function overlap(terms: Set<string>, content: string): number {
  const found = new Set(searchTerms(content));
  return [...terms].filter((term) => found.has(term)).length;
}

function chooseBlocks(
  section: MarkdownSection,
  query: string,
  terms: Set<string>,
  maxChars: number,
): string[] {
  const { blocks, markup } = section;
  const score = (block: string) =>
    (countDocumentedOptions(query, block) * 2 + countRequestedIdentifiers(query, block)) *
      (terms.size + 1) + overlap(terms, block);
  const ranked = blocks.map((block, index) => ({ index, score: score(block) }));
  ranked.sort((a, b) => b.score - a.score);
  const best = ranked[0].index;
  let first = best;
  let last = best;
  let size = markup.length + blocks[best].length + 2;

  while (first > 0 || last + 1 < blocks.length) {
    const before = blocks[first - 1];
    const after = blocks[last + 1];
    if (before && size + before.length + 2 <= maxChars) {
      first--;
      size += before.length + 2;
    } else if (after && size + after.length + 2 <= maxChars) {
      last++;
      size += after.length + 2;
    } else {
      break;
    }
  }
  return blocks.slice(first, last + 1);
}

/**
 * Builds a passage around one relevant Markdown section using already stored text.
 * @param content Assembled neighboring chunks in document order.
 * @param query The search query.
 * @param maxChars Target size, allowing a single complete block to exceed it.
 * @returns The focused passage and its rendered heading, if one can be established.
 */
export function focusMarkdownPassage(
  content: string,
  query: string,
  maxChars: number,
  headingHint?: string,
): { content: string; heading?: string } {
  const sections: MarkdownSection[] = [];
  const prefix: string[] = [];
  let current: MarkdownSection | undefined;
  for (const node of markdown.parse(content).children) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    const block = content.slice(start, end);
    if (node.type === "heading") {
      const heading = headingText(node).trim();
      current = { heading, markup: block, blocks: [] };
      sections.push(current);
    } else if (current) {
      current.blocks.push(block);
    } else {
      prefix.push(block);
    }
  }

  const terms = new Set(searchTerms(query));
  const ranked = sections
    .filter(({ heading, blocks }) => heading && blocks.length > 0)
    .map((section) => {
      const body = section.blocks.join("\n\n");
      return {
        section,
        identifiers: countRequestedIdentifiers(query, section.heading + "\n" + body),
        options: countDocumentedOptions(query, body),
        headingTerms: overlap(terms, section.heading),
        bodyTerms: overlap(terms, body),
        sameHeading: sectionSlug(section.heading) === sectionSlug(headingHint ?? ""),
      };
    })
    .sort(
      (a, b) =>
        b.options - a.options ||
        b.identifiers - a.identifiers ||
        b.headingTerms - a.headingTerms ||
        Number(b.sameHeading) - Number(a.sameHeading) ||
        b.bodyTerms - a.bodyTerms,
    );
  const best = ranked[0];
  if (!best || !(best.identifiers || best.headingTerms || best.bodyTerms)) {
    return { content };
  }

  // A block before the first heading can be the original match in an excerpt.
  // Keep it when no headed section contains the requested identifier or topic.
  const prefixContent = prefix.join("\n\n");
  if (
    countDocumentedOptions(query, prefixContent) > best.options ||
    (!best.options &&
      (countRequestedIdentifiers(query, prefixContent) > best.identifiers ||
        (!best.identifiers &&
          overlap(terms, prefixContent) > best.headingTerms + best.bodyTerms)))
  ) {
    return { content };
  }

  const { section } = best;
  const blocks = chooseBlocks(section, query, terms, maxChars);
  const focused = [section.markup, ...blocks].join("\n\n");
  if (
    !countDocumentedOptions(query, focused) &&
    countRequestedIdentifiers(query, focused) < countRequestedIdentifiers(query, content)
  ) {
    return { content };
  }
  return {
    heading: section.heading,
    content: focused,
  };
}

function headingText(node: unknown): string {
  if (typeof node !== "object" || node === null) return "";
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("alt" in node && typeof node.alt === "string") return node.alt;
  if ("children" in node && Array.isArray(node.children)) {
    return node.children.map(headingText).join("");
  }
  return "";
}
