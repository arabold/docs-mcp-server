import { JSDOM } from "jsdom";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import remarkGfm from "remark-gfm";
import remarkHtml from "remark-html";
import remarkParse from "remark-parse";
import TurndownService from "turndown";
import { unified } from "unified";
import { createJSDOM } from "../utils/dom";
import { logger } from "../utils/logger";
import { fullTrim } from "../utils/string";
import { ContentSplitterError, MinimumChunkSizeError } from "./errors";
import { CodeContentSplitter } from "./splitters/CodeContentSplitter";
import { JsonContentSplitter } from "./splitters/JsonContentSplitter";
import { TableContentSplitter } from "./splitters/TableContentSplitter";
import { TextContentSplitter } from "./splitters/TextContentSplitter";
import type { ContentChunk, DocumentSplitter, SectionContentType } from "./types";

/**
 * Represents a section of content within a document,
 * typically defined by a heading
 */
interface DocumentSection {
  level: number;
  path: string[]; // Full path including parent headings
  content: {
    type: SectionContentType;
    text: string;
  }[];
}

/**
 * Splits markdown documents into semantic chunks while preserving
 * structure and distinguishing between different content types.
 *
 * The splitting process happens in two steps:
 * 1. Split document into sections based on headings (H1-H3 only)
 * 2. Split section content into smaller chunks based on preferredChunkSize
 */
export class SemanticMarkdownSplitter implements DocumentSplitter {
  private turndownService: TurndownService;
  public textSplitter: TextContentSplitter;
  public codeSplitter: CodeContentSplitter;
  public tableSplitter: TableContentSplitter;
  public jsonSplitter: JsonContentSplitter;

  constructor(
    private preferredChunkSize: number,
    private maxChunkSize: number,
  ) {
    this.turndownService = new TurndownService({
      headingStyle: "atx",
      hr: "---",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      emDelimiter: "_",
      strongDelimiter: "**",
      linkStyle: "inlined",
    });

    // Add table rule to preserve markdown table format
    this.turndownService.addRule("table", {
      filter: ["table"],
      replacement: (content, node) => {
        const table = node as HTMLTableElement;
        const headers = Array.from(table.querySelectorAll("th")).map(
          (th) => th.textContent?.trim() || "",
        );
        const rows = Array.from(table.querySelectorAll("tr")).filter(
          (tr) => !tr.querySelector("th"),
        );

        if (headers.length === 0 && rows.length === 0) return "";

        let markdown = "\n";
        if (headers.length > 0) {
          markdown += `| ${headers.join(" | ")} |\n`;
          markdown += `|${headers.map(() => "---").join("|")}|\n`;
        }

        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll("td")).map(
            (td) => td.textContent?.trim() || "",
          );
          markdown += `| ${cells.join(" | ")} |\n`;
        }

        return markdown;
      },
    });

    // Text splitter uses preferred chunk size (keeps paragraphs together if possible)
    this.textSplitter = new TextContentSplitter({
      chunkSize: this.preferredChunkSize,
    });
    // Code/table splitters use the hard chunk size (avoid splitting unless necessary)
    this.codeSplitter = new CodeContentSplitter({
      chunkSize: this.maxChunkSize,
    });
    this.tableSplitter = new TableContentSplitter({
      chunkSize: this.maxChunkSize,
    });
    this.jsonSplitter = new JsonContentSplitter({
      chunkSize: this.maxChunkSize,
    });
  }

  /**
   * Main entry point for splitting markdown content
   */
  async splitText(markdown: string): Promise<ContentChunk[]> {
    const html = await this.markdownToHtml(markdown);
    const dom = await this.parseHtml(html);
    const sections = await this.splitIntoSections(dom);
    return this.splitSectionContent(sections);
  }

  /**
   * Step 1: Split document into sections based on H1-H6 headings,
   * as well as code blocks and tables.
   */
  private async splitIntoSections(dom: Document): Promise<DocumentSection[]> {
    const body = dom.querySelector("body");
    if (!body) {
      throw new Error("Invalid HTML structure: no body element found");
    }

    let currentSection = this.createRootSection();
    const sections: DocumentSection[] = [];
    const stack: DocumentSection[] = [currentSection];

    // Process each child of the body
    for (const element of Array.from(body.children)) {
      const headingMatch = element.tagName.match(/H([1-6])/);

      if (headingMatch) {
        // Create new section for H1-H6 heading
        const level = Number.parseInt(headingMatch[1], 10);
        const title = fullTrim(element.textContent || "");

        // Pop sections from stack until we find the parent level
        while (stack.length > 1 && stack[stack.length - 1].level >= level) {
          stack.pop();
        }

        // Start new section with the header
        currentSection = {
          level,
          path: [
            ...stack.slice(1).reduce((acc: string[], s) => {
              const lastPath = s.path[s.path.length - 1];
              if (lastPath) acc.push(lastPath);
              return acc;
            }, []),
            title,
          ],
          content: [
            {
              type: "heading",
              text: `${"#".repeat(level)} ${title}`,
            },
          ],
        };

        sections.push(currentSection);
        stack.push(currentSection);
      } else if (element.tagName === "PRE") {
        // Code blocks are kept as separate chunks
        const code = element.querySelector("code");
        const language = code?.className.replace("language-", "") || "";
        const content = code?.textContent || element.textContent || "";
        const markdown = `${"```"}${language}\n${content}\n${"```"}`;

        currentSection = {
          level: currentSection.level,
          path: currentSection.path,
          content: [
            {
              type: "code",
              text: markdown,
            },
          ],
        } satisfies DocumentSection;
        sections.push(currentSection);
      } else if (element.tagName === "TABLE") {
        // Tables are kept as separate chunks
        const markdown = fullTrim(this.turndownService.turndown(element.outerHTML));

        currentSection = {
          level: currentSection.level,
          path: currentSection.path,
          content: [
            {
              type: "table",
              text: markdown,
            },
          ],
        } satisfies DocumentSection;
        sections.push(currentSection);
      } else {
        const markdown = fullTrim(this.turndownService.turndown(element.innerHTML));
        if (markdown) {
          // Create a new section for the text content
          currentSection = {
            level: currentSection.level,
            path: currentSection.path,
            content: [
              {
                type: "text",
                text: markdown,
              },
            ],
          } satisfies DocumentSection;
          sections.push(currentSection);
        }
      }
    }

    return sections;
  }

  /**
   * Step 2: Split section content into smaller chunks
   */
  private async splitSectionContent(
    sections: DocumentSection[],
  ): Promise<ContentChunk[]> {
    const chunks: ContentChunk[] = [];

    for (const section of sections) {
      for (const content of section.content) {
        let splitContent: string[] = [];

        try {
          switch (content.type) {
            case "heading":
            case "text": {
              splitContent = await this.textSplitter.split(content.text);
              break;
            }
            case "code": {
              // Detect JSON code blocks
              if (/^```json\s*/i.test(content.text)) {
                // Remove code block markers for splitting
                const jsonBody = content.text
                  .replace(/^```json\s*/i, "")
                  .replace(/```\s*$/, "");
                // Account for code block wrapper overhead
                const wrapperSize = "```json\n".length + "\n```".length; // 9 + 4 = 13
                const allowedChunkSize = Math.max(1, this.maxChunkSize - wrapperSize);
                // Use a temporary JsonContentSplitter with reduced chunk size
                const jsonSplitter = new JsonContentSplitter({
                  chunkSize: allowedChunkSize,
                });
                splitContent = await jsonSplitter.split(jsonBody);
                // Re-wrap as code blocks
                splitContent = splitContent.map((chunk) =>
                  ["```json", chunk, "```"].join("\n"),
                );
              } else {
                splitContent = await this.codeSplitter.split(content.text);
              }
              break;
            }
            case "table": {
              splitContent = await this.tableSplitter.split(content.text);
              break;
            }
          }
        } catch (err) {
          // If it's a MinimumChunkSizeError, use RecursiveCharacterTextSplitter directly
          if (err instanceof MinimumChunkSizeError) {
            logger.warn(
              `⚠ Cannot split ${content.type} chunk normally, using RecursiveCharacterTextSplitter: ${err.message}`,
            );

            // Create a RecursiveCharacterTextSplitter with aggressive settings to ensure splitting
            const splitter = new RecursiveCharacterTextSplitter({
              chunkSize: this.maxChunkSize,
              chunkOverlap: Math.min(20, Math.floor(this.maxChunkSize * 0.1)),
              // Use more aggressive separators including empty string as last resort
              separators: [
                "\n\n",
                "\n",
                " ",
                "\t",
                ".",
                ",",
                ";",
                ":",
                "-",
                "(",
                ")",
                "[",
                "]",
                "{",
                "}",
                "",
              ],
            });

            const chunks = await splitter.splitText(content.text);
            if (chunks.length === 0) {
              // If still no chunks, use the most extreme approach: just truncate
              splitContent = [content.text.substring(0, this.maxChunkSize)];
            } else {
              splitContent = chunks;
            }
          } else {
            // Convert other error message to string, handling non-Error objects
            const errMessage = err instanceof Error ? err.message : String(err);
            throw new ContentSplitterError(
              `Failed to split ${content.type} content: ${errMessage}`,
            );
          }
        }

        // Create chunks from split content
        chunks.push(
          ...splitContent.map(
            (text): ContentChunk => ({
              types: [content.type],
              content: text,
              section: {
                level: section.level,
                path: section.path,
              },
            }),
          ),
        );
      }
    }

    return chunks;
  }

  /**
   * Helper to create the root section
   */
  private createRootSection(): DocumentSection {
    return {
      level: 0,
      path: [],
      content: [],
    };
  }

  /**
   * Convert markdown to HTML using remark
   */
  private async markdownToHtml(markdown: string): Promise<string> {
    const html = await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkHtml)
      .process(markdown);

    return `<!DOCTYPE html>
      <html>
        <body>
          ${String(html)}
        </body>
      </html>`;
  }

  /**
   * Parse HTML
   */
  private async parseHtml(html: string): Promise<Document> {
    // Use createJSDOM which includes default options like virtualConsole
    const { window } = createJSDOM(html);
    return window.document;
  }
}
