/**
 * Tests for LanguageParserRegistry - Parser registration and lookup
 */

import { beforeEach, describe, expect, it } from "vitest";
import { LanguageParserRegistry } from "./LanguageParserRegistry";

describe("LanguageParserRegistry", () => {
  let registry: LanguageParserRegistry;

  beforeEach(() => {
    registry = new LanguageParserRegistry();
  });

  describe("initialization", () => {
    it("should initialize with JavaScript parser", () => {
      expect(registry.getSupportedLanguages()).toContain("javascript");
    });

    it("should register JavaScript file extensions", () => {
      expect(registry.isExtensionSupported(".js")).toBe(true);
      expect(registry.isExtensionSupported(".jsx")).toBe(true);
      expect(registry.isExtensionSupported(".mjs")).toBe(true);
      expect(registry.isExtensionSupported(".cjs")).toBe(true);
    });

    it("should register JavaScript MIME types", () => {
      expect(registry.isMimeTypeSupported("text/javascript")).toBe(true);
      expect(registry.isMimeTypeSupported("application/javascript")).toBe(true);
      expect(registry.isMimeTypeSupported("text/jsx")).toBe(true);
      expect(registry.isMimeTypeSupported("application/jsx")).toBe(true);
    });
  });

  describe("parser lookup", () => {
    it("should find parser by language name", () => {
      const parser = registry.getParser("javascript");
      expect(parser).toBeDefined();
      expect(parser?.name).toBe("javascript");
    });

    it("should find parser by file extension", () => {
      const parser = registry.getParserByExtension(".js");
      expect(parser).toBeDefined();
      expect(parser?.name).toBe("javascript");
    });

    it("should find parser by MIME type", () => {
      const parser = registry.getParserByMimeType("text/javascript");
      expect(parser).toBeDefined();
      expect(parser?.name).toBe("javascript");
    });

    it("should handle case insensitive lookups", () => {
      expect(registry.getParserByExtension(".JS")).toBeDefined();
      expect(registry.getParserByMimeType("TEXT/JAVASCRIPT")).toBeDefined();
    });

    it("should return undefined for unsupported languages", () => {
      expect(registry.getParser("python")).toBeUndefined();
      expect(registry.getParserByExtension(".py")).toBeUndefined();
      expect(registry.getParserByMimeType("text/python")).toBeUndefined();
    });
  });

  describe("supported checks", () => {
    it("should correctly identify supported languages", () => {
      expect(registry.isLanguageSupported("javascript")).toBe(true);
      expect(registry.isLanguageSupported("python")).toBe(false);
    });

    it("should correctly identify supported extensions", () => {
      expect(registry.isExtensionSupported(".js")).toBe(true);
      expect(registry.isExtensionSupported(".py")).toBe(false);
    });

    it("should correctly identify supported MIME types", () => {
      expect(registry.isMimeTypeSupported("text/javascript")).toBe(true);
      expect(registry.isMimeTypeSupported("text/python")).toBe(false);
    });
  });

  describe("list methods", () => {
    it("should return list of supported languages", () => {
      const languages = registry.getSupportedLanguages();
      expect(languages).toContain("javascript");
      expect(Array.isArray(languages)).toBe(true);
    });

    it("should return list of supported extensions", () => {
      const extensions = registry.getSupportedExtensions();
      expect(extensions).toContain(".js");
      expect(extensions).toContain(".jsx");
      expect(Array.isArray(extensions)).toBe(true);
    });

    it("should return list of supported MIME types", () => {
      const mimeTypes = registry.getSupportedMimeTypes();
      expect(mimeTypes).toContain("text/javascript");
      expect(mimeTypes).toContain("application/javascript");
      expect(Array.isArray(mimeTypes)).toBe(true);
    });
  });
});
