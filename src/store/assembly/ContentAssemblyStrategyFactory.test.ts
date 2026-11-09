import { describe, expect, it } from "vitest";
import { loadConfig } from "../../utils/config";
import { createContentAssemblyStrategy } from "./ContentAssemblyStrategyFactory";
import { HierarchicalAssemblyStrategy } from "./strategies/HierarchicalAssemblyStrategy";
import { MarkdownAssemblyStrategy } from "./strategies/MarkdownAssemblyStrategy";

describe("createContentAssemblyStrategy", () => {
  const config = loadConfig();

  it("assembles structured content hierarchically and everything else as Markdown", () => {
    const hierarchical = HierarchicalAssemblyStrategy;
    const markdown = MarkdownAssemblyStrategy;
    const cases: [
      mimeType: string | null | undefined,
      expected: typeof hierarchical | typeof markdown,
    ][] = [
      [undefined, markdown],
      [null, markdown],
      ["text/markdown", markdown],
      ["text/x-markdown", markdown],
      ["text/html", markdown],
      ["application/xhtml+xml", markdown],
      ["text/plain", markdown],
      ["text/csv", markdown],
      ["text/typescript", hierarchical],
      ["text/x-typescript", hierarchical],
      ["text/javascript", hierarchical],
      ["text/x-python", hierarchical],
      ["text/x-go", hierarchical],
      ["text/x-rust", hierarchical],
      ["text/css", hierarchical],
      ["application/json", hierarchical],
      ["text/json", hierarchical],
      ["text/x-json", hierarchical],
      // Unknown types fall back to Markdown
      ["application/octet-stream", markdown],
      ["image/png", markdown],
      ["application/unknown", markdown],
    ];

    for (const [mimeType, expected] of cases) {
      expect
        .soft(createContentAssemblyStrategy(mimeType, config), String(mimeType))
        .toBeInstanceOf(expected);
    }
  });
});
