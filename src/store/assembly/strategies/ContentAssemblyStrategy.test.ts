import { describe, expect, it } from "vitest";
import { HierarchicalAssemblyStrategy } from "./HierarchicalAssemblyStrategy";
import { MarkdownAssemblyStrategy } from "./MarkdownAssemblyStrategy";

describe("ContentAssemblyStrategy canHandle methods", () => {
  describe("MarkdownAssemblyStrategy", () => {
    const strategy = new MarkdownAssemblyStrategy();

    it("handles markdown content types", () => {
      expect(strategy.canHandle("text/markdown")).toBe(true);
      expect(strategy.canHandle("text/x-markdown")).toBe(true);
    });

    it("handles HTML content types", () => {
      expect(strategy.canHandle("text/html")).toBe(true);
      expect(strategy.canHandle("application/xhtml+xml")).toBe(true);
    });

    it("handles plain text content types", () => {
      expect(strategy.canHandle("text/plain")).toBe(true);
      expect(strategy.canHandle("text/css")).toBe(true);
    });

    it("does not handle source code content types", () => {
      expect(strategy.canHandle("text/x-typescript")).toBe(false);
      expect(strategy.canHandle("text/javascript")).toBe(false);
      expect(strategy.canHandle("text/x-python")).toBe(false);
    });

    it("does not handle JSON content types", () => {
      expect(strategy.canHandle("application/json")).toBe(false);
      expect(strategy.canHandle("text/json")).toBe(false);
    });
  });

  describe("HierarchicalAssemblyStrategy", () => {
    const strategy = new HierarchicalAssemblyStrategy();

    it("handles source code content types", () => {
      expect(strategy.canHandle("text/x-typescript")).toBe(true);
      expect(strategy.canHandle("text/javascript")).toBe(true);
      expect(strategy.canHandle("text/x-python")).toBe(true);
      expect(strategy.canHandle("text/x-go")).toBe(true);
      expect(strategy.canHandle("text/x-rust")).toBe(true);
    });

    it("handles JSON content types", () => {
      expect(strategy.canHandle("application/json")).toBe(true);
      expect(strategy.canHandle("text/json")).toBe(true);
      expect(strategy.canHandle("text/x-json")).toBe(true);
    });

    it("does not handle markdown content types", () => {
      expect(strategy.canHandle("text/markdown")).toBe(false);
      expect(strategy.canHandle("text/x-markdown")).toBe(false);
    });

    it("does not handle HTML content types", () => {
      expect(strategy.canHandle("text/html")).toBe(false);
      expect(strategy.canHandle("application/xhtml+xml")).toBe(false);
    });

    it("does not handle plain text content types", () => {
      expect(strategy.canHandle("text/plain")).toBe(false);
      expect(strategy.canHandle("text/css")).toBe(false);
    });

    it("does not handle unknown content types", () => {
      expect(strategy.canHandle("application/octet-stream")).toBe(false);
      expect(strategy.canHandle("image/png")).toBe(false);
    });
  });
});
