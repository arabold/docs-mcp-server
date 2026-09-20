// @ts-expect-error
import { gfm } from "@joplin/turndown-plugin-gfm";
import type * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import TurndownService from "turndown";
import { logger } from "../../utils/logger";
import { fullTrim } from "../../utils/string";
import type { ContentProcessorMiddleware, MiddlewareContext } from "./types";

const maxGfmTableRows = 500;
const maxGfmTableCells = 1_000;
const maxGfmTableHtmlLength = 100_000;
const gfmTableChunkRows = 100;
const preservedTablePlaceholderAttribute = "data-docs-mcp-preserved-table-id";
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Middleware to convert the final processed HTML content (from Cheerio object in context.dom)
 * into Markdown using Turndown, applying custom rules.
 */
export class HtmlToMarkdownMiddleware implements ContentProcessorMiddleware {
  private turndownService: TurndownService;
  private readonly preservedTableHtml = new Map<string, string>();
  private preservedTableSequence = 0;

  constructor() {
    this.turndownService = new TurndownService({
      headingStyle: "atx",
      hr: "---",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      emDelimiter: "_",
      strongDelimiter: "**",
      linkStyle: "inlined",
    });

    this.turndownService.use(gfm);

    this.addCustomRules();
  }

  private addCustomRules(): void {
    // Preserve code blocks and syntax (replicated from HtmlProcessor)
    this.turndownService.addRule("pre", {
      filter: ["pre"],
      replacement: (_content: string, node: Node) => {
        const element = node as unknown as HTMLElement;
        let language = element.getAttribute("data-language") || "";
        if (!language) {
          // Try to infer the language from the class name
          // This is a common pattern in syntax highlighters
          const highlightElement =
            element.closest(
              '[class*="highlight-source-"], [class*="highlight-"], [class*="language-"]',
            ) ||
            element.querySelector(
              '[class*="highlight-source-"], [class*="highlight-"], [class*="language-"]',
            );
          if (highlightElement) {
            const className = highlightElement.className;
            const match = className.match(
              /(?:highlight-source-|highlight-|language-)(\w+)/,
            );
            if (match) language = match[1];
          }
        }

        const text = this.extractPreText(element);

        return `\n\`\`\`${language}\n${text.replace(/^\n+|\n+$/g, "")}\n\`\`\`\n`;
      },
    });
    this.turndownService.addRule("anchor", {
      filter: ["a"],
      replacement: (content: string, node: Node) => {
        const element = node as HTMLElement;
        const href = element.getAttribute("href");
        const normalizedContent = this.normalizeLinkContent(content);

        if (!normalizedContent || normalizedContent === "#") {
          return ""; // Remove if content is # or empty
        }
        if (!href) {
          return normalizedContent; // Preserve content if href is missing or empty
        }
        return `[${normalizedContent}](${href})`; // Standard link conversion
      },
    });
    this.turndownService.addRule("preservedOversizedTable", {
      filter: (node: Node) => {
        const element = node as HTMLElement;
        return (
          element.nodeName === "DIV" &&
          element.hasAttribute(preservedTablePlaceholderAttribute)
        );
      },
      replacement: (_content: string, node: Node) => {
        const element = node as HTMLElement;
        const tableId = element.getAttribute(preservedTablePlaceholderAttribute);
        const tableHtml = tableId ? this.preservedTableHtml.get(tableId) : undefined;
        return tableHtml ? `\n\n${tableHtml}\n\n` : "";
      },
    });
  }

  /**
   * Reads the text of a `<pre>` block, inserting the line breaks its markup
   * only implies visually.
   *
   * The walk is deliberately read-only. Cloning or mutating the node would be
   * the obvious way to splice newlines in, but `cloneNode` recreates each
   * element through `document.createElement`, which rejects any name the DOM
   * considers invalid. Real pages carry such names — a generator that emits
   * `<lt;200 cores/socket>` for text it failed to escape leaves elements no
   * DOM will recreate — and a throw here fails the whole page conversion.
   */
  private extractPreText(element: HTMLElement): string {
    // Modern syntax highlighters (Shiki, Prism, highlight.js, etc.) split each
    // line into a `<span class="line">` or `<div class="line">` with no
    // surrounding whitespace, relying on CSS `display: block` for the visual
    // line break. `textContent` collapses those into a single line, so we emit
    // a newline after every line container except the last.
    const lineNodes = Array.from(
      element.querySelectorAll("span.line, div.line, [data-line]"),
    );
    const lineNodeSet = new Set<Node>(lineNodes);
    const lastLineNode = lineNodes[lineNodes.length - 1];

    let text = "";
    const visit = (node: Node): void => {
      if (node.nodeType === TEXT_NODE) {
        text += node.nodeValue ?? "";
        return;
      }
      if (node.nodeType !== ELEMENT_NODE) {
        return;
      }
      if (node.nodeName === "BR") {
        text += "\n";
        return;
      }
      for (const child of Array.from(node.childNodes)) {
        visit(child);
      }
      if (lineNodeSet.has(node) && node !== lastLineNode) {
        text += "\n";
      }
    };
    for (const child of Array.from(element.childNodes)) {
      visit(child);
    }
    return text;
  }

  /**
   * Converts as much of a subtree as Turndown will accept, descending past the
   * parts it rejects.
   *
   * Turndown converts a document in one call, so a single node it cannot
   * handle costs the whole page. Retrying node by node confines the damage:
   * every subtree that converts keeps its Markdown — headings included, which
   * is what the semantic splitter chunks on — and only the subtree that keeps
   * throwing falls back to its text. Formatting inside that subtree flattens;
   * the point is to keep the words.
   */
  private convertNodeWithFallback($: cheerio.CheerioAPI, node: AnyNode): string {
    if (node.type === "text") {
      return fullTrim(node.data);
    }
    if (node.type !== "tag") {
      return "";
    }

    try {
      return this.turndownService.turndown($.html(node)).trim();
    } catch {
      const parts = $(node)
        .contents()
        .toArray()
        .map((child) => this.convertNodeWithFallback($, child))
        .filter((part) => part.length > 0);

      return parts.length > 0 ? parts.join("\n\n") : fullTrim($(node).text());
    }
  }

  /**
   * Salvages Markdown from a document whose whole-document conversion threw.
   */
  private salvageMarkdown($: cheerio.CheerioAPI): string {
    const roots = $("body").length > 0 ? $("body").contents() : $.root().contents();
    return roots
      .toArray()
      .map((node) => this.convertNodeWithFallback($, node))
      .filter((part) => part.length > 0)
      .join("\n\n")
      .trim();
  }

  private normalizeLinkContent(content: string): string {
    return fullTrim(content).replace(/[ \t]*[\r\n]+[ \t]*/g, " ");
  }

  private splitOversizedTables($: cheerio.CheerioAPI, source: string): void {
    $("table").each((_index, element) => {
      const $table = $(element);
      const rowCount = $table.find("tr").length;
      const cellCount = $table.find("td, th").length;
      const htmlLength = $.html(element).length;

      if (
        rowCount <= maxGfmTableRows &&
        cellCount <= maxGfmTableCells &&
        htmlLength <= maxGfmTableHtmlLength
      ) {
        return;
      }

      const replacement = this.buildSplitTableHtml($, $table);
      if (!replacement) {
        const tableId = `table-${++this.preservedTableSequence}`;
        this.preservedTableHtml.set(tableId, $.html(element));
        logger.warn(
          `⚠️  Preserving oversized HTML table for ${source} as HTML before GFM conversion: ${rowCount} rows, ${cellCount} cells, ${htmlLength} chars`,
        );
        $table.replaceWith(
          `<div ${preservedTablePlaceholderAttribute}="${tableId}">preserved table</div>`,
        );
        return;
      }

      logger.warn(
        `⚠️  Splitting oversized HTML table for ${source} before GFM conversion: ${rowCount} rows, ${cellCount} cells, ${htmlLength} chars`,
      );
      $table.replaceWith(replacement);
    });
  }

  private buildSplitTableHtml(
    $: cheerio.CheerioAPI,
    $table: cheerio.Cheerio<Element>,
  ): string | null {
    const headerRows = this.getHeaderRows($table);
    const headerRowSet = new Set(headerRows);
    const dataRows = $table
      .find("tr")
      .toArray()
      .filter((row): row is Element => row.type === "tag" && !headerRowSet.has(row));

    if (dataRows.length <= gfmTableChunkRows) {
      return null;
    }

    const chunks: string[] = [];
    const headerHtml = headerRows.map((row) => $.html(row)).join("");
    const preservedChildHtml = this.getPreservedTableChildHtml($, $table);

    for (let index = 0; index < dataRows.length; index += gfmTableChunkRows) {
      const rowsHtml = dataRows
        .slice(index, index + gfmTableChunkRows)
        .map((row) => $.html(row))
        .join("");
      const tableParts = ["<table>", preservedChildHtml];
      if (headerHtml) {
        tableParts.push("<thead>", headerHtml, "</thead>");
      }
      tableParts.push("<tbody>", rowsHtml, "</tbody></table>");
      chunks.push(tableParts.join(""));
    }

    return chunks.join("\n");
  }

  private getPreservedTableChildHtml(
    $: cheerio.CheerioAPI,
    $table: cheerio.Cheerio<Element>,
  ): string {
    return $table
      .children("caption, colgroup")
      .toArray()
      .filter((child): child is Element => child.type === "tag")
      .map((child) => $.html(child))
      .join("");
  }

  private getHeaderRows($table: cheerio.Cheerio<Element>): Element[] {
    const theadRows = $table
      .children("thead")
      .find("tr")
      .toArray()
      .filter((row): row is Element => row.type === "tag");

    if (theadRows.length > 0) {
      return theadRows;
    }

    const firstRow = $table.find("tr").first();
    if (firstRow.length === 0) {
      return [];
    }

    const cells = firstRow.children("th, td").toArray();
    const isHeaderRow =
      cells.length > 0 &&
      cells.every((cell) => cell.type === "tag" && cell.tagName === "th");

    return isHeaderRow ? (firstRow.toArray() as Element[]) : [];
  }

  /**
   * Processes the context to convert the sanitized HTML body node to Markdown.
   * @param context The current processing context.
   * @param next Function to call the next middleware.
   */
  async process(context: MiddlewareContext, next: () => Promise<void>): Promise<void> {
    // Check if we have a Cheerio object from a previous step
    const $ = context.dom;
    if (!$) {
      logger.warn(
        `⏭️ Skipping ${this.constructor.name}: context.dom is missing. Ensure HtmlCheerioParserMiddleware ran correctly.`,
      );
      await next();
      return;
    }

    // Only process if we have a Cheerio object (implicitly means it's HTML)
    try {
      logger.debug(`Converting HTML content to Markdown for ${context.source}`);
      this.preservedTableHtml.clear();
      this.splitOversizedTables($, context.source);
      // Provide Turndown with the HTML string content from the Cheerio object's body,
      // or the whole document if body is empty/unavailable.
      const htmlToConvert = $("body").html() || $.html();
      const markdown = this.turndownService.turndown(htmlToConvert).trim();

      if (!markdown) {
        // If conversion results in empty markdown, log a warning but treat as valid empty markdown
        const warnMsg = `HTML to Markdown conversion resulted in empty content for ${context.source}.`;
        logger.warn(`⚠️  ${warnMsg}`);
        context.content = "";
      } else {
        // Conversion successful and produced non-empty markdown
        context.content = markdown;
        logger.debug(`Successfully converted HTML to Markdown for ${context.source}`);
      }

      // Update contentType to reflect the converted format
      context.contentType = "text/markdown";
    } catch (error) {
      logger.error(
        `❌ Error converting HTML to Markdown for ${context.source}: ${error}`,
      );
      context.errors.push(
        new Error(
          `Failed to convert HTML to Markdown: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      // A failed conversion leaves `context.content` holding the HTML we were
      // handed, and the rest of the pipeline would split and embed that markup
      // as if it were prose. Convert what we can instead, node by node.
      const salvaged = this.salvageMarkdown($);
      if (salvaged) {
        logger.warn(
          `⚠️  Recovered ${salvaged.length} characters of Markdown for ${context.source} after a failed conversion`,
        );
        context.contentType = "text/markdown";
      }
      // Empty means we salvaged nothing. Paired with the recorded error that
      // reads downstream as "we learned nothing about this page", which leaves
      // any previously stored content untouched.
      context.content = salvaged;
    } finally {
      this.preservedTableHtml.clear();
    }

    // Call the next middleware in the chain regardless of whether conversion happened
    await next();

    // No need to close/free Cheerio object explicitly
    // context.dom = undefined; // Optionally clear the dom property if no longer needed downstream
  }
}
