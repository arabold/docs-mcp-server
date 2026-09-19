import { describe, expect, it } from "vitest";
import { loadConfig } from "../../utils/config";
import { createMimeTypeCapabilityPredicate } from "./capability";
import { PipelineFactory } from "./PipelineFactory";
import type { ContentPipeline } from "./types";

describe("createMimeTypeCapabilityPredicate", () => {
  const appConfig = loadConfig();
  const pipelines = PipelineFactory.createStandardPipelines(appConfig);
  const canProcess = createMimeTypeCapabilityPredicate(pipelines);

  describe("types the standard pipelines claim", () => {
    it.each([
      ["text/html", "HtmlPipeline"],
      ["text/markdown", "MarkdownPipeline"],
      ["application/json", "JsonPipeline"],
      ["application/pdf", "DocumentPipeline"],
      ["text/x-python", "SourceCodePipeline"],
      ["text/x-typescript", "SourceCodePipeline"],
      ["text/plain", "TextPipeline"],
    ])("accepts %s (%s)", (mimeType) => {
      expect(canProcess(mimeType)).toBe(true);
    });
  });

  // SVG appears below because no pipeline claims image/svg+xml, not because it is
  // special-cased anywhere. Teaching a pipeline the type is all that is needed.
  describe("types no pipeline claims", () => {
    it.each([
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/svg+xml",
      "video/mp4",
      "audio/mpeg",
      "application/zip",
      "application/octet-stream",
      "font/woff2",
    ])("rejects %s", (mimeType) => {
      expect(canProcess(mimeType)).toBe(false);
    });
  });

  it("widens automatically when a pipeline claims a new type", () => {
    const svgPipeline = {
      canProcess: (mimeType: string) => mimeType === "image/svg+xml",
      process: async () => ({}),
      close: async () => {},
    } as unknown as ContentPipeline;

    const widened = createMimeTypeCapabilityPredicate([...pipelines, svgPipeline]);

    expect(widened("image/svg+xml")).toBe(true);
    expect(widened("image/png")).toBe(false);
  });

  it("is never more restrictive than the pipeline-selection loop", () => {
    // The gates call canProcess without content; the selection loop calls it with a
    // buffer. Anything the predicate accepts must still be accepted with content in
    // hand, or a gate could admit content that nothing can process.
    const body = Buffer.from("# hello\n\nworld\n");
    const accepted = [
      "text/html",
      "text/markdown",
      "application/json",
      "text/x-python",
      "text/plain",
    ];

    for (const mimeType of accepted) {
      expect(canProcess(mimeType)).toBe(true);
      expect(pipelines.some((p) => p.canProcess(mimeType, body))).toBe(true);
    }
  });
});
