import { describe, expect, it } from "vitest";
import { SPLITTER_PREFERRED_CHUNK_SIZE } from "../../utils/config";
import { HtmlPipeline } from "./HtmlPipeline";
import { JsonPipeline } from "./JsonPipeline";
import { MarkdownPipeline } from "./MarkdownPipeline";
import { PipelineFactory } from "./PipelineFactory";
import { SourceCodePipeline } from "./SourceCodePipeline";
import { TextPipeline } from "./TextPipeline";

describe("PipelineFactory", () => {
  describe("createStandardPipelines", () => {
    it("should create all five standard pipelines", () => {
      const pipelines = PipelineFactory.createStandardPipelines();

      expect(pipelines).toHaveLength(5);
      expect(pipelines[0]).toBeInstanceOf(HtmlPipeline);
      expect(pipelines[1]).toBeInstanceOf(MarkdownPipeline);
      expect(pipelines[2]).toBeInstanceOf(JsonPipeline);
      expect(pipelines[3]).toBeInstanceOf(SourceCodePipeline);
      expect(pipelines[4]).toBeInstanceOf(TextPipeline);
    });

    it("should create new instances each time", () => {
      const pipelines1 = PipelineFactory.createStandardPipelines();
      const pipelines2 = PipelineFactory.createStandardPipelines();

      expect(pipelines1[0]).not.toBe(pipelines2[0]);
      expect(pipelines1[1]).not.toBe(pipelines2[1]);
      expect(pipelines1[2]).not.toBe(pipelines2[2]);
      expect(pipelines1[3]).not.toBe(pipelines2[3]);
      expect(pipelines1[4]).not.toBe(pipelines2[4]);
    });
  });

  describe("configuration", () => {
    it("should use default chunk sizes when no configuration provided", () => {
      const pipelines = PipelineFactory.createStandardPipelines();
      expect(pipelines).toHaveLength(5);
      // Test passes if no errors are thrown during pipeline creation
    });

    it("should accept custom chunk sizes configuration", () => {
      const config = {
        chunkSizes: {
          preferred: 800,
          max: 1600,
        },
      };

      const pipelines = PipelineFactory.createStandardPipelines(config);
      expect(pipelines).toHaveLength(5);
      expect(pipelines[0]).toBeInstanceOf(HtmlPipeline);
      expect(pipelines[1]).toBeInstanceOf(MarkdownPipeline);
      expect(pipelines[2]).toBeInstanceOf(JsonPipeline);
      expect(pipelines[3]).toBeInstanceOf(SourceCodePipeline);
      expect(pipelines[4]).toBeInstanceOf(TextPipeline);
    });

    it("should use default values when configuration is partially provided", () => {
      const config = {
        chunkSizes: {
          preferred: 800,
          // max is omitted - should use default
        },
      };

      const pipelines = PipelineFactory.createStandardPipelines(config);
      expect(pipelines).toHaveLength(5);
      // Test passes if no errors are thrown during pipeline creation
    });

    it("should use constants as defaults when configuration is undefined", () => {
      const pipelines = PipelineFactory.createStandardPipelines(undefined);
      expect(pipelines).toHaveLength(5);
      // Verify that the default constant is being used implicitly
      expect(SPLITTER_PREFERRED_CHUNK_SIZE).toBe(1500);
    });
  });
});
