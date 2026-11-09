import { describe, expect, it } from "vitest";
import { loadConfig } from "../../utils/config";
import { FetchStatus, type RawContent } from "../fetcher/types";
import type { ScraperOptions } from "../types";
import { ScrapeMode } from "../types";
import { TextPipeline } from "./TextPipeline";

describe("TextPipeline", () => {
  const appConfig = loadConfig();
  const pipeline = new TextPipeline(appConfig);
  const baseOptions: ScraperOptions = {
    url: "http://example.com",
    library: "test-lib",
    version: "1.0.0",
    maxDepth: 1,
    maxPages: 10,
    scrapeMode: ScrapeMode.Auto,
  };

  it("should accept text and safe application types unless the body is binary", () => {
    const cases: Array<
      [label: string, mimeType: string, body: Buffer | undefined, expected: boolean]
    > = [
      ["text/plain", "text/plain", undefined, true],
      ["text/markdown", "text/markdown", undefined, true],
      ["text/css", "text/css", undefined, true],
      ["application/xml", "application/xml", undefined, true],
      ["application/javascript", "application/javascript", undefined, true],
      ["application/yaml", "application/yaml", undefined, true],
      [
        "PNG body",
        "image/png",
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        false,
      ],
      [
        "body with a null byte",
        "application/octet-stream",
        Buffer.from("text with null byte\0here"),
        false,
      ],
      ["unknown application type", "application/unknown", undefined, false],
      ["video", "video/mp4", undefined, false],
      ["no MIME type", "", undefined, false],
    ];

    for (const [label, mimeType, body, expected] of cases) {
      expect.soft(pipeline.canProcess(mimeType, body), label).toBe(expected);
    }
  });

  it("should keep the text of a string or Buffer body as is", async () => {
    const cases: Array<{ label: string; raw: RawContent; text: string }> = [
      {
        label: "plain text",
        raw: {
          content: "This is a simple text document with some content.",
          mimeType: "text/plain",
          source: "test.txt",
          status: FetchStatus.SUCCESS,
        },
        text: "This is a simple text document with some content.",
      },
      {
        label: "unknown content type",
        raw: {
          content: "Some unknown format content",
          mimeType: "application/unknown",
          source: "test.unknown",
          status: FetchStatus.SUCCESS,
        },
        text: "Some unknown format content",
      },
      {
        label: "Buffer",
        raw: {
          content: Buffer.from("Buffer content", "utf-8"),
          mimeType: "text/plain",
          charset: "utf-8",
          source: "test.txt",
          status: FetchStatus.SUCCESS,
        },
        text: "Buffer content",
      },
    ];

    for (const { label, raw, text } of cases) {
      const result = await pipeline.process(raw, baseOptions);

      expect.soft(result.textContent, label).toBe(text);
      expect.soft(result.links, label).toEqual([]);
      expect.soft(result.errors, label).toEqual([]);
      expect.soft(result.chunks?.length, label).toBeGreaterThan(0);
    }
  });
});
