import { describe, expect, it } from "vitest";
import { HtmlPipeline } from "./HtmlPipeline";
import { JsonPipeline } from "./JsonPipeline";
import { MarkdownPipeline } from "./MarkdownPipeline";
import { PipelineFactory } from "./PipelineFactory";
import { SourceCodePipeline } from "./SourceCodePipeline";

describe("PipelineFactory", () => {
  describe("createStandardPipelines", () => {
    it("should create all four standard pipelines", () => {
      const pipelines = PipelineFactory.createStandardPipelines();

      expect(pipelines).toHaveLength(4);
      expect(pipelines[0]).toBeInstanceOf(HtmlPipeline);
      expect(pipelines[1]).toBeInstanceOf(MarkdownPipeline);
      expect(pipelines[2]).toBeInstanceOf(JsonPipeline);
      expect(pipelines[3]).toBeInstanceOf(SourceCodePipeline);
    });

    it("should create new instances each time", () => {
      const pipelines1 = PipelineFactory.createStandardPipelines();
      const pipelines2 = PipelineFactory.createStandardPipelines();

      expect(pipelines1[0]).not.toBe(pipelines2[0]);
      expect(pipelines1[1]).not.toBe(pipelines2[1]);
      expect(pipelines1[2]).not.toBe(pipelines2[2]);
      expect(pipelines1[3]).not.toBe(pipelines2[3]);
    });
  });
});
