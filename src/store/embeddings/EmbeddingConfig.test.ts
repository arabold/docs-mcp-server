/**
 * Unit tests for EmbeddingConfig class.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EmbeddingConfig } from "./EmbeddingConfig";

describe("EmbeddingConfig", () => {
  // Reset singleton instance before and after each test to ensure isolation
  beforeEach(() => {
    EmbeddingConfig.resetInstance();
  });

  afterEach(() => {
    EmbeddingConfig.resetInstance();
  });

  describe("parse", () => {
    it("should use default model when no modelSpec is provided", () => {
      const config = new EmbeddingConfig();
      const result = config.parse();

      expect(result.provider).toBe("openai");
      expect(result.model).toBe("text-embedding-3-small");
      expect(result.dimensions).toBe(1536);
      expect(result.modelSpec).toBe("text-embedding-3-small");
    });

    it("should parse model without provider prefix (defaults to openai)", () => {
      const config = new EmbeddingConfig();
      const result = config.parse("text-embedding-ada-002");

      expect(result.provider).toBe("openai");
      expect(result.model).toBe("text-embedding-ada-002");
      expect(result.dimensions).toBe(1536);
      expect(result.modelSpec).toBe("text-embedding-ada-002");
    });

    it("should parse model with provider prefix", () => {
      const config = new EmbeddingConfig();
      const result = config.parse("gemini:embedding-001");

      expect(result.provider).toBe("gemini");
      expect(result.model).toBe("embedding-001");
      expect(result.dimensions).toBe(768);
      expect(result.modelSpec).toBe("gemini:embedding-001");
    });

    it("should handle AWS models with colons in model names", () => {
      const config = new EmbeddingConfig();
      const result = config.parse("aws:amazon.titan-embed-text-v2:0");

      expect(result.provider).toBe("aws");
      expect(result.model).toBe("amazon.titan-embed-text-v2:0");
      expect(result.dimensions).toBe(1024);
      expect(result.modelSpec).toBe("aws:amazon.titan-embed-text-v2:0");
    });

    it("should return null dimensions for unknown models", () => {
      const config = new EmbeddingConfig();
      const result = config.parse("openai:unknown-model");

      expect(result.provider).toBe("openai");
      expect(result.model).toBe("unknown-model");
      expect(result.dimensions).toBeNull();
      expect(result.modelSpec).toBe("openai:unknown-model");
    });

    it("should handle case-insensitive model lookups", () => {
      const config = new EmbeddingConfig();
      const result = config.parse("openai:TEXT-EMBEDDING-3-SMALL");

      expect(result.provider).toBe("openai");
      expect(result.model).toBe("TEXT-EMBEDDING-3-SMALL");
      expect(result.dimensions).toBe(1536); // Should find the lowercase version
      expect(result.modelSpec).toBe("openai:TEXT-EMBEDDING-3-SMALL");
    });
  });

  describe("getKnownDimensions", () => {
    it("should return known dimensions for existing models", () => {
      const config = new EmbeddingConfig();

      expect(config.getKnownDimensions("text-embedding-3-small")).toBe(1536);
      expect(config.getKnownDimensions("embedding-001")).toBe(768);
      expect(config.getKnownDimensions("amazon.titan-embed-text-v1")).toBe(1536);
    });

    it("should return null for unknown models", () => {
      const config = new EmbeddingConfig();

      expect(config.getKnownDimensions("unknown-model")).toBeNull();
    });

    it("should handle case-insensitive lookups", () => {
      const config = new EmbeddingConfig();

      expect(config.getKnownDimensions("TEXT-EMBEDDING-3-SMALL")).toBe(1536);
      expect(config.getKnownDimensions("Text-Embedding-3-Small")).toBe(1536);
    });
  });

  describe("setKnownDimensions", () => {
    it("should cache new model dimensions", () => {
      const config = new EmbeddingConfig();

      // Initially unknown
      expect(config.getKnownDimensions("custom-model")).toBeNull();

      // Cache dimensions
      config.setKnownDimensions("custom-model", 2048);

      // Should now return cached value
      expect(config.getKnownDimensions("custom-model")).toBe(2048);
    });

    it("should update existing model dimensions", () => {
      const config = new EmbeddingConfig();

      // Set initial value
      config.setKnownDimensions("test-model", 1024);
      expect(config.getKnownDimensions("test-model")).toBe(1024);

      // Update to new value
      config.setKnownDimensions("test-model", 2048);
      expect(config.getKnownDimensions("test-model")).toBe(2048);
    });

    it("should handle case-insensitive caching and retrieval", () => {
      const config = new EmbeddingConfig();

      // Cache with mixed case
      config.setKnownDimensions("Custom-Model", 1536);

      // Should retrieve with different case
      expect(config.getKnownDimensions("custom-model")).toBe(1536);
      expect(config.getKnownDimensions("CUSTOM-MODEL")).toBe(1536);
    });
  });

  describe("static methods", () => {
    it("should provide static access to parsing", () => {
      const result = EmbeddingConfig.parseEmbeddingConfig("vertex:text-embedding-004");

      expect(result.provider).toBe("vertex");
      expect(result.model).toBe("text-embedding-004");
      expect(result.dimensions).toBe(768);
    });

    it("should provide static access to dimension lookup", () => {
      expect(EmbeddingConfig.getKnownModelDimensions("text-embedding-3-large")).toBe(
        3072,
      );
      expect(EmbeddingConfig.getKnownModelDimensions("unknown-model")).toBeNull();
    });

    it("should provide static access to dimension caching", () => {
      // Initially unknown
      expect(EmbeddingConfig.getKnownModelDimensions("static-test-model")).toBeNull();

      // Cache via static method
      EmbeddingConfig.setKnownModelDimensions("static-test-model", 768);

      // Should be available via static method
      expect(EmbeddingConfig.getKnownModelDimensions("static-test-model")).toBe(768);
    });

    it("should use singleton instance across static calls", () => {
      // Set dimensions via static method
      EmbeddingConfig.setKnownModelDimensions("singleton-test", 1024);

      // Should be available via instance method
      const config = EmbeddingConfig.getInstance();
      expect(config.getKnownDimensions("singleton-test")).toBe(1024);

      // And vice versa
      config.setKnownDimensions("instance-test", 2048);
      expect(EmbeddingConfig.getKnownModelDimensions("instance-test")).toBe(2048);
    });
  });

  describe("singleton behavior", () => {
    it("should return the same instance", () => {
      const instance1 = EmbeddingConfig.getInstance();
      const instance2 = EmbeddingConfig.getInstance();

      expect(instance1).toBe(instance2);
    });

    it("should persist state across getInstance calls", () => {
      const instance1 = EmbeddingConfig.getInstance();
      instance1.setKnownDimensions("persistent-model", 512);

      const instance2 = EmbeddingConfig.getInstance();
      expect(instance2.getKnownDimensions("persistent-model")).toBe(512);
    });

    it("should reset properly", () => {
      const instance1 = EmbeddingConfig.getInstance();
      instance1.setKnownDimensions("reset-test", 256);

      EmbeddingConfig.resetInstance();

      const instance2 = EmbeddingConfig.getInstance();
      expect(instance2.getKnownDimensions("reset-test")).toBeNull(); // Should be gone
      expect(instance1).not.toBe(instance2); // Should be different instances
    });
  });

  describe("provider validation", () => {
    const validProviders = [
      "openai",
      "vertex",
      "gemini",
      "aws",
      "microsoft",
      "sagemaker",
    ];

    it("should accept all valid providers", () => {
      const config = new EmbeddingConfig();

      for (const provider of validProviders) {
        const result = config.parse(`${provider}:test-model`);
        expect(result.provider).toBe(provider);
        expect(result.model).toBe("test-model");
      }
    });

    it("should handle unknown providers as valid", () => {
      const config = new EmbeddingConfig();
      const result = config.parse("unknown:test-model");

      // TypeScript typing will prevent this in real usage, but the parser should handle it gracefully
      expect(result.provider).toBe("unknown" as any);
      expect(result.model).toBe("test-model");
    });
  });

  describe("edge cases", () => {
    it("should handle empty string input", () => {
      const config = new EmbeddingConfig();
      const result = config.parse("");

      expect(result.provider).toBe("openai");
      expect(result.model).toBe("text-embedding-3-small"); // Falls back to default
      expect(result.dimensions).toBe(1536);
      expect(result.modelSpec).toBe("text-embedding-3-small"); // Uses default spec when empty string provided
    });

    it("should handle input with only colon", () => {
      const config = new EmbeddingConfig();
      const result = config.parse(":");

      expect(result.provider).toBe("");
      expect(result.model).toBe("");
      expect(result.dimensions).toBeNull();
      expect(result.modelSpec).toBe(":");
    });

    it("should handle input starting with colon", () => {
      const config = new EmbeddingConfig();
      const result = config.parse(":model-name");

      expect(result.provider).toBe("");
      expect(result.model).toBe("model-name");
      expect(result.dimensions).toBeNull();
      expect(result.modelSpec).toBe(":model-name");
    });

    it("should handle input ending with colon", () => {
      const config = new EmbeddingConfig();
      const result = config.parse("provider:");

      expect(result.provider).toBe("provider");
      expect(result.model).toBe("");
      expect(result.dimensions).toBeNull();
      expect(result.modelSpec).toBe("provider:");
    });
  });
});
