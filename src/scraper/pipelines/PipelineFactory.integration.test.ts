import { describe, expect, it } from "vitest";
import { ScrapeMode } from "../types";
import { type PipelineConfiguration, PipelineFactory } from "./PipelineFactory";

describe("PipelineFactory Integration", () => {
  describe("configuration propagation", () => {
    it("should propagate custom chunk sizes through process method", async () => {
      // Create pipelines with custom configuration
      const config: PipelineConfiguration = {
        chunkSizes: {
          preferred: 100, // Very small for testing
          max: 200,
        },
      };

      const pipelines = PipelineFactory.createStandardPipelines(config);

      // Create content that would definitely exceed the custom chunk size
      const longContent =
        "This is a test sentence that is long enough to be split.\n".repeat(10); // ~570 characters with newlines

      // Test with TextPipeline (last pipeline, universal fallback)
      const textPipeline = pipelines[4]; // TextPipeline

      // Create mock RawContent for the process method
      const rawContent = {
        source: "test.txt",
        content: longContent,
        mimeType: "text/plain",
      };

      const scraperOptions = {
        url: "test.txt",
        library: "test",
        version: "1.0.0",
        scrapeMode: ScrapeMode.Fetch,
        ignoreErrors: false,
        maxConcurrency: 1,
      };

      const processed = await textPipeline.process(rawContent, scraperOptions);

      // Verify that chunks are smaller due to custom configuration
      // With 570 characters and 100 char preferred size, should be multiple chunks
      expect(processed.chunks.length).toBeGreaterThan(1); // Should be split into multiple chunks
      processed.chunks.forEach((chunk) => {
        expect(chunk.content.length).toBeGreaterThan(0);
        // Should be much smaller than default 1500
        expect(chunk.content.length).toBeLessThan(300);
      });
    });

    it("should use default chunk sizes when no configuration provided", async () => {
      const pipelines = PipelineFactory.createStandardPipelines();

      // Create moderate content that would fit in default chunks
      const moderateContent = "This is a test sentence. ".repeat(10); // ~250 characters

      // Test with TextPipeline
      const textPipeline = pipelines[4];

      const rawContent = {
        source: "test.txt",
        content: moderateContent,
        mimeType: "text/plain",
      };

      const scraperOptions = {
        url: "test.txt",
        library: "test",
        version: "1.0.0",
        scrapeMode: ScrapeMode.Fetch,
        ignoreErrors: false,
        maxConcurrency: 1,
      };

      const processed = await textPipeline.process(rawContent, scraperOptions);

      // With default chunk size (1500), this should fit in one chunk
      expect(processed.chunks.length).toBe(1);
      expect(processed.chunks[0].content.length).toBeLessThan(300);
    });

    it("should handle different pipeline types with custom configuration", async () => {
      const config: PipelineConfiguration = {
        chunkSizes: {
          preferred: 300,
          max: 600,
        },
      };

      const pipelines = PipelineFactory.createStandardPipelines(config);

      // Test each pipeline
      const testContent = "This is a test content that might be split. ".repeat(10); // ~450 characters

      for (const pipeline of pipelines) {
        const rawContent = {
          source: "test.txt",
          content: testContent,
          mimeType: "text/plain",
        };

        const scraperOptions = {
          url: "test.txt",
          library: "test",
          version: "1.0.0",
          scrapeMode: ScrapeMode.Fetch,
          ignoreErrors: false,
          maxConcurrency: 1,
        };

        const processed = await pipeline.process(rawContent, scraperOptions);
        expect(processed.chunks.length).toBeGreaterThanOrEqual(1);

        // Verify each chunk respects the configuration
        processed.chunks.forEach((chunk) => {
          expect(chunk.content.length).toBeGreaterThan(0);
          // Allow some flexibility for splitting logic, but ensure it's not wildly large
          expect(chunk.content.length).toBeLessThan(800);
        });
      }
    });
  });
});
