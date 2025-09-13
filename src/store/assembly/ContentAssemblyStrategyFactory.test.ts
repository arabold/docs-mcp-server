import { describe, expect, it } from "vitest";
import {
  createContentAssemblyStrategy,
  getStrategyName,
} from "./ContentAssemblyStrategyFactory";
import { HierarchicalAssemblyStrategy } from "./strategies/HierarchicalAssemblyStrategy";
import { MarkdownAssemblyStrategy } from "./strategies/MarkdownAssemblyStrategy";

describe("ContentAssemblyStrategyFactory", () => {
  describe("createContentAssemblyStrategy", () => {
    it("returns MarkdownAssemblyStrategy for undefined MIME type", () => {
      const strategy = createContentAssemblyStrategy();
      expect(strategy).toBeInstanceOf(MarkdownAssemblyStrategy);
    });

    it("returns MarkdownAssemblyStrategy for markdown MIME types", () => {
      const strategy1 = createContentAssemblyStrategy("text/markdown");
      const strategy2 = createContentAssemblyStrategy("text/x-markdown");
      expect(strategy1).toBeInstanceOf(MarkdownAssemblyStrategy);
      expect(strategy2).toBeInstanceOf(MarkdownAssemblyStrategy);
    });

    it("returns MarkdownAssemblyStrategy for HTML MIME types", () => {
      const strategy1 = createContentAssemblyStrategy("text/html");
      const strategy2 = createContentAssemblyStrategy("application/xhtml+xml");
      expect(strategy1).toBeInstanceOf(MarkdownAssemblyStrategy);
      expect(strategy2).toBeInstanceOf(MarkdownAssemblyStrategy);
    });

    it("returns MarkdownAssemblyStrategy for plain text MIME types", () => {
      const strategy = createContentAssemblyStrategy("text/plain");
      expect(strategy).toBeInstanceOf(MarkdownAssemblyStrategy);
    });

    it("returns HierarchicalAssemblyStrategy for source code MIME types", () => {
      const strategy1 = createContentAssemblyStrategy("text/x-typescript");
      const strategy2 = createContentAssemblyStrategy("text/javascript");
      const strategy3 = createContentAssemblyStrategy("text/x-python");

      expect(strategy1).toBeInstanceOf(HierarchicalAssemblyStrategy);
      expect(strategy2).toBeInstanceOf(HierarchicalAssemblyStrategy);
      expect(strategy3).toBeInstanceOf(HierarchicalAssemblyStrategy);
    });

    it("returns HierarchicalAssemblyStrategy for JSON MIME types", () => {
      const strategy1 = createContentAssemblyStrategy("application/json");
      const strategy2 = createContentAssemblyStrategy("text/json");

      expect(strategy1).toBeInstanceOf(HierarchicalAssemblyStrategy);
      expect(strategy2).toBeInstanceOf(HierarchicalAssemblyStrategy);
    });

    it("returns MarkdownAssemblyStrategy for unknown MIME types", () => {
      const strategy = createContentAssemblyStrategy("application/octet-stream");
      expect(strategy).toBeInstanceOf(MarkdownAssemblyStrategy);
    });
  });

  describe("getStrategyName", () => {
    it("returns correct strategy names", () => {
      expect(getStrategyName()).toBe("MarkdownAssemblyStrategy (default)");
      expect(getStrategyName("text/markdown")).toBe("MarkdownAssemblyStrategy");
      expect(getStrategyName("text/x-typescript")).toBe("HierarchicalAssemblyStrategy");
      expect(getStrategyName("application/json")).toBe("HierarchicalAssemblyStrategy");
    });
  });
});
