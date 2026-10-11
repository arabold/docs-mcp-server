import { describe, expect, it } from "vitest";
import { type AppConfig, loadConfig } from "../../utils/config";
import { FetchStatus } from "../fetcher";
import { ScrapeMode } from "../types";
import { DocumentPipeline } from "./DocumentPipeline";
import { HtmlPipeline } from "./HtmlPipeline";
import { JsonPipeline } from "./JsonPipeline";
import { MarkdownPipeline } from "./MarkdownPipeline";
import { PipelineFactory } from "./PipelineFactory";
import { SourceCodePipeline } from "./SourceCodePipeline";
import { TextPipeline } from "./TextPipeline";
import type { ContentPipeline } from "./types";

const appConfig = loadConfig();

/** Picks a pipeline the way the scraper strategies do: the first that claims the content. */
function select(pipelines: ContentPipeline[], mimeType: string, body: Buffer) {
  return pipelines.find((pipeline) => pipeline.canProcess(mimeType, body));
}

describe("PipelineFactory.createStandardPipelines", () => {
  it("creates the six pipelines in selection order", () => {
    const pipelines = PipelineFactory.createStandardPipelines(appConfig);

    expect(pipelines.map((pipeline) => pipeline.constructor)).toEqual([
      JsonPipeline,
      SourceCodePipeline,
      DocumentPipeline,
      HtmlPipeline,
      MarkdownPipeline,
      TextPipeline,
    ]);
  });

  it("creates new instances on each call", () => {
    const first = PipelineFactory.createStandardPipelines(appConfig);
    const second = PipelineFactory.createStandardPipelines(appConfig);

    first.forEach((pipeline, index) => {
      expect(pipeline).not.toBe(second[index]);
    });
  });

  // TextPipeline also claims HTML, JSON, Markdown and source code, so the order
  // above is what routes those types to their specialised pipelines.
  const routes: Array<
    [string, (new (config: AppConfig) => ContentPipeline) | undefined]
  > = [
    ["application/json", JsonPipeline],
    ["text/x-typescript", SourceCodePipeline],
    ["application/javascript", SourceCodePipeline],
    ["application/pdf", DocumentPipeline],
    ["text/html", HtmlPipeline],
    ["application/xhtml+xml", HtmlPipeline],
    ["text/markdown", MarkdownPipeline],
    ["text/plain", TextPipeline],
    ["text/x-unknown", TextPipeline],
    ["application/unknown-format", undefined],
    ["image/png", undefined],
  ];

  it.each(
    routes.map(
      ([mimeType, expected]) =>
        [mimeType, expected?.name ?? "no pipeline", expected] as const,
    ),
  )("routes %s to %s", (mimeType, _name, expected) => {
    const pipelines = PipelineFactory.createStandardPipelines(appConfig);

    const selected = select(pipelines, mimeType, Buffer.from("plain text body"));

    expect(selected?.constructor).toBe(expected);
  });

  it("passes the configured chunk sizes to the pipelines", async () => {
    const text = "This is a test sentence that is long enough to be split.\n".repeat(10);
    const body = Buffer.from(text);
    const tinyConfig: AppConfig = {
      ...appConfig,
      splitter: { ...appConfig.splitter, preferredChunkSize: 100, maxChunkSize: 200 },
    };
    const chunksWith = async (config: AppConfig) => {
      const pipeline = select(
        PipelineFactory.createStandardPipelines(config),
        "text/plain",
        body,
      );
      const result = await pipeline?.process(
        {
          source: "test.txt",
          content: body,
          mimeType: "text/plain",
          status: FetchStatus.SUCCESS,
        },
        {
          url: "test.txt",
          library: "test",
          version: "1.0.0",
          scrapeMode: ScrapeMode.Fetch,
        },
      );
      return result?.chunks ?? [];
    };

    const defaultChunks = await chunksWith(appConfig);
    const tinyChunks = await chunksWith(tinyConfig);

    expect(defaultChunks).toHaveLength(1);
    expect(tinyChunks.length).toBeGreaterThan(1);
    for (const chunk of tinyChunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(tinyConfig.splitter.maxChunkSize);
    }
  });
});
