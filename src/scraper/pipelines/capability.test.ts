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

  // The gates call canProcess without content; the selection loop calls it with the
  // fetched body. A gate that rejected something the loop would accept would drop
  // processable content, so the predicate must be the more permissive side.
  describe("relation to the pipeline-selection loop", () => {
    const bodies = {
      text: Buffer.from("# hello\n\nworld\n"),
      binary: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
    };
    const mimeTypes = [
      "text/html",
      "text/markdown",
      "text/plain",
      "text/x-python",
      "application/json",
      "application/pdf",
      "image/png",
      "application/octet-stream",
    ];

    it("accepts every type the loop accepts with the body in hand", () => {
      const selectedByLoop = mimeTypes.flatMap((mimeType) =>
        Object.values(bodies)
          .filter((body) =>
            pipelines.some((pipeline) => pipeline.canProcess(mimeType, body)),
          )
          .map(() => mimeType),
      );

      expect(selectedByLoop.length).toBeGreaterThan(0);
      expect(selectedByLoop.filter((mimeType) => !canProcess(mimeType))).toEqual([]);
    });

    it("may accept a type that the loop refuses once it sees the body", () => {
      // TextPipeline refuses content with null bytes, which only the loop can see.
      expect(canProcess("text/plain")).toBe(true);
      expect(
        pipelines.some((pipeline) => pipeline.canProcess("text/plain", bodies.binary)),
      ).toBe(false);
    });
  });
});
