import { MinimumChunkSizeError } from "../errors";
import type { ContentSplitter, ContentSplitterOptions } from "./types";

/**
 * Splits code content while preserving language information and formatting.
 * Uses line boundaries for splitting and ensures each chunk is properly
 * wrapped with language-specific code block markers.
 */
export class CodeContentSplitter implements ContentSplitter {
  constructor(private options: ContentSplitterOptions) {}

  async split(content: string): Promise<string[]> {
    // Capture the full CommonMark info string verbatim (everything between the
    // opening ``` and the following newline) and re-emit it on each chunk's
    // rewritten opener. The previous `\w+` regex only matched word characters
    // and failed for VitePress/Shiki tokens like `js{15-18} twoslash
    // [server.js]`, leaving the opener in place and producing a double-fenced
    // chunk. We deliberately preserve the entire info string — line-highlight
    // ranges, Twoslash hints, filename tabs and other renderer-specific
    // metadata — rather than reducing it to a single language word, so the
    // chunk remains a faithful copy of the source.
    const infoMatch = content.match(/^```([^\n]*)\n/);
    const infoString = (infoMatch?.[1] ?? "").trimEnd();
    const strippedContent = content.replace(/^```[^\n]*\n/, "").replace(/```\s*$/, "");

    const lines = strippedContent.split("\n");
    const chunks: string[] = [];
    let currentChunkLines: string[] = [];

    for (const line of lines) {
      // Check if a single line with code block markers exceeds chunkSize
      const singleLineSize = this.wrap(line, infoString).length;
      if (singleLineSize > this.options.chunkSize) {
        throw new MinimumChunkSizeError(singleLineSize, this.options.chunkSize);
      }

      currentChunkLines.push(line);
      const newChunkContent = this.wrap(currentChunkLines.join("\n"), infoString);
      const newChunkSize = newChunkContent.length;

      if (newChunkSize > this.options.chunkSize && currentChunkLines.length > 1) {
        // remove last item
        const lastLine = currentChunkLines.pop();
        // wrap content and create chunk
        chunks.push(this.wrap(currentChunkLines.join("\n"), infoString));
        currentChunkLines = [lastLine as string];
      }
    }

    if (currentChunkLines.length > 0) {
      chunks.push(this.wrap(currentChunkLines.join("\n"), infoString));
    }

    return chunks;
  }

  protected wrap(content: string, infoString?: string | null): string {
    return `\`\`\`${infoString || ""}\n${content.replace(/\n+$/, "")}\n\`\`\``;
  }
}
