import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import type { PageContentResult } from "../store/types";
import { ValidationError } from "./errors";
import { ReadPageTool, type ReadPageToolOptions } from "./ReadPageTool";

describe("ReadPageTool", () => {
  let mockDocService: Partial<IDocumentManagement>;
  let tool: ReadPageTool;

  const pageResult: PageContentResult = {
    url: "https://react.dev/reference/react",
    title: "React Reference",
    contentType: "text/markdown",
    content: "# React\n\nBuilt-in React Hooks and Components.",
    startChunk: 0,
    totalChunks: 2,
    nextChunk: null,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockDocService = {
      getPageContent: vi.fn().mockResolvedValue(pageResult),
    };
    tool = new ReadPageTool(mockDocService as IDocumentManagement);
  });

  it("rejects a missing library or path and invalid chunk options", async () => {
    const cases: Array<{ label: string; input: ReadPageToolOptions }> = [
      { label: "empty library", input: { library: "", pathOrUrl: "/docs/quickstart" } },
      {
        label: "blank library",
        input: { library: "   ", pathOrUrl: "/docs/quickstart" },
      },
      { label: "empty path", input: { library: "react", pathOrUrl: "" } },
      { label: "path of only brackets", input: { library: "react", pathOrUrl: "<>" } },
      {
        label: "negative maxChars",
        input: { library: "react", pathOrUrl: "/docs", maxChars: -1 },
      },
      {
        label: "zero maxChars",
        input: { library: "react", pathOrUrl: "/docs", maxChars: 0 },
      },
      {
        label: "negative startChunk",
        input: { library: "react", pathOrUrl: "/docs", startChunk: -1 },
      },
      {
        label: "fractional startChunk",
        input: { library: "react", pathOrUrl: "/docs", startChunk: 1.5 },
      },
    ];

    for (const { label, input } of cases) {
      await expect.soft(tool.execute(input), label).rejects.toThrow(ValidationError);
    }
    expect(mockDocService.getPageContent).not.toHaveBeenCalled();
  });

  it("hands the store the cleaned path and the reading options", async () => {
    const noOptions = { startChunk: undefined, maxChars: undefined };
    const cases: Array<{
      label: string;
      input: Omit<ReadPageToolOptions, "library">;
      expected: Parameters<IDocumentManagement["getPageContent"]>;
    }> = [
      {
        label: "version and chunk window",
        input: {
          pathOrUrl: "https://react.dev/reference/react",
          version: " 19.0.0 ",
          startChunk: 3,
          maxChars: 1000,
        },
        expected: [
          "react",
          "19.0.0",
          "https://react.dev/reference/react",
          { startChunk: 3, maxChars: 1000 },
        ],
      },
      {
        label: "HTML-escaped link wrapper, ampersands decoded",
        input: { pathOrUrl: "&lt;https://x.dev/a?b=1&amp;c=2&gt;" },
        expected: ["react", undefined, "https://x.dev/a?b=1&c=2", noOptions],
      },
      {
        label: "literal HTML entities in a URL without a wrapper",
        input: { pathOrUrl: "https://x.dev/a?q=&amp;" },
        expected: ["react", undefined, "https://x.dev/a?q=&amp;", noOptions],
      },
      {
        label: "angle brackets copied along with a link",
        input: { pathOrUrl: "<https://x.dev/docs>" },
        expected: ["react", undefined, "https://x.dev/docs", noOptions],
      },
      {
        label: "relative path prefix",
        input: { pathOrUrl: "../docs/guide" },
        expected: ["react", undefined, "docs/guide", noOptions],
      },
      {
        label: "Windows backslashes",
        input: { pathOrUrl: "docs\\guide.md" },
        expected: ["react", undefined, "docs/guide.md", noOptions],
      },
      {
        label: "percent-encoding kept as given",
        input: { pathOrUrl: "/docs/My%20Page" },
        expected: ["react", undefined, "/docs/My%20Page", noOptions],
      },
    ];

    for (const { label, input, expected } of cases) {
      await tool.execute({ library: "react", ...input });
      expect
        .soft(mockDocService.getPageContent, label)
        .toHaveBeenLastCalledWith(...expected);
    }
  });
});
