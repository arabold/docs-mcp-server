import { describe, expect, it } from "vitest";
import { loadConfig } from "../../utils/config";
import { createContentAssemblyStrategy } from "./ContentAssemblyStrategyFactory";
import { HierarchicalAssemblyStrategy } from "./strategies/HierarchicalAssemblyStrategy";
import { MarkdownAssemblyStrategy } from "./strategies/MarkdownAssemblyStrategy";

describe("ContentAssemblyStrategyFactory", () => {
  const config = loadConfig();

  describe("createContentAssemblyStrategy", () => {
    it("returns MarkdownAssemblyStrategy for undefined MIME type", () => {
      const strategy = createContentAssemblyStrategy(undefined, config);
      expect(strategy).toBeInstanceOf(MarkdownAssemblyStrategy);
    });

    it("returns MarkdownAssemblyStrategy for markdown MIME types", () => {
      const strategy1 = createContentAssemblyStrategy("text/markdown", config);
      const strategy2 = createContentAssemblyStrategy("text/x-markdown", config);
      expect(strategy1).toBeInstanceOf(MarkdownAssemblyStrategy);
      expect(strategy2).toBeInstanceOf(MarkdownAssemblyStrategy);
    });

    it("returns MarkdownAssemblyStrategy for HTML MIME types", () => {
      const strategy1 = createContentAssemblyStrategy("text/html", config);
      const strategy2 = createContentAssemblyStrategy("application/xhtml+xml", config);
      expect(strategy1).toBeInstanceOf(MarkdownAssemblyStrategy);
      expect(strategy2).toBeInstanceOf(MarkdownAssemblyStrategy);
    });

    it("returns MarkdownAssemblyStrategy for plain text MIME types", () => {
      const strategy = createContentAssemblyStrategy("text/plain", config);
      expect(strategy).toBeInstanceOf(MarkdownAssemblyStrategy);
    });

    it("returns HierarchicalAssemblyStrategy for source code MIME types", () => {
      const strategy1 = createContentAssemblyStrategy("text/x-typescript", config);
      const strategy2 = createContentAssemblyStrategy("text/javascript", config);
      const strategy3 = createContentAssemblyStrategy("text/x-python", config);

      expect(strategy1).toBeInstanceOf(HierarchicalAssemblyStrategy);
      expect(strategy2).toBeInstanceOf(HierarchicalAssemblyStrategy);
      expect(strategy3).toBeInstanceOf(HierarchicalAssemblyStrategy);
    });

    it("returns HierarchicalAssemblyStrategy for JSON MIME types", () => {
      const strategy1 = createContentAssemblyStrategy("application/json", config);
      const strategy2 = createContentAssemblyStrategy("text/json", config);

      expect(strategy1).toBeInstanceOf(HierarchicalAssemblyStrategy);
      expect(strategy2).toBeInstanceOf(HierarchicalAssemblyStrategy);
    });

    it("returns MarkdownAssemblyStrategy for unknown MIME types", () => {
      const strategy = createContentAssemblyStrategy("application/octet-stream", config);
      expect(strategy).toBeInstanceOf(MarkdownAssemblyStrategy);
    });
  });
});
