import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import type { PageContentResult } from "../store/types";
import { ValidationError } from "./errors";
import { ReadPageTool } from "./ReadPageTool";

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

  /** Returns the page path or URL the tool handed to the document service. */
  const requestedPath = () =>
    (mockDocService.getPageContent as ReturnType<typeof vi.fn>).mock.calls[0][2];

  beforeEach(() => {
    vi.resetAllMocks();
    mockDocService = {
      getPageContent: vi.fn().mockResolvedValue(pageResult),
    };
    tool = new ReadPageTool(mockDocService as IDocumentManagement);
  });

  it("should throw ValidationError if library is missing or empty", async () => {
    await expect(
      tool.execute({ library: "", pathOrUrl: "/docs/quickstart" }),
    ).rejects.toThrow(ValidationError);
    await expect(
      tool.execute({ library: "   ", pathOrUrl: "/docs/quickstart" }),
    ).rejects.toThrow(ValidationError);
  });

  it("should throw ValidationError if pathOrUrl is missing or empty", async () => {
    await expect(tool.execute({ library: "react", pathOrUrl: "" })).rejects.toThrow(
      ValidationError,
    );
    await expect(tool.execute({ library: "react", pathOrUrl: "<>" })).rejects.toThrow(
      ValidationError,
    );
  });

  it("should throw ValidationError if maxChars is invalid", async () => {
    await expect(
      tool.execute({ library: "react", pathOrUrl: "/docs", maxChars: -1 }),
    ).rejects.toThrow(ValidationError);
    await expect(
      tool.execute({ library: "react", pathOrUrl: "/docs", maxChars: 0 }),
    ).rejects.toThrow(ValidationError);
  });

  it("should throw ValidationError if startChunk is negative or fractional", async () => {
    await expect(
      tool.execute({ library: "react", pathOrUrl: "/docs", startChunk: -1 }),
    ).rejects.toThrow(ValidationError);
    await expect(
      tool.execute({ library: "react", pathOrUrl: "/docs", startChunk: 1.5 }),
    ).rejects.toThrow(ValidationError);
  });

  it("should return the page content from the document service", async () => {
    const result = await tool.execute({
      library: "react",
      pathOrUrl: "https://react.dev/reference/react",
      version: "19.0.0",
      startChunk: 3,
      maxChars: 1000,
    });

    expect(mockDocService.getPageContent).toHaveBeenCalledWith(
      "react",
      "19.0.0",
      "https://react.dev/reference/react",
      { startChunk: 3, maxChars: 1000 },
    );
    expect(result).toEqual(pageResult);
  });

  it("should strip an HTML-escaped link wrapper and decode its ampersands", async () => {
    await tool.execute({
      library: "react",
      pathOrUrl: "&lt;https://x.dev/a?b=1&amp;c=2&gt;",
    });

    expect(requestedPath()).toBe("https://x.dev/a?b=1&c=2");
  });

  it("should keep literal HTML entities in a URL without a wrapper", async () => {
    await tool.execute({ library: "react", pathOrUrl: "https://x.dev/a?q=&amp;" });

    expect(requestedPath()).toBe("https://x.dev/a?q=&amp;");
  });

  it("should strip angle brackets copied along with a link", async () => {
    await tool.execute({ library: "react", pathOrUrl: "<https://x.dev/docs>" });

    expect(requestedPath()).toBe("https://x.dev/docs");
  });

  it("should strip relative path prefixes", async () => {
    await tool.execute({ library: "react", pathOrUrl: "../docs/guide" });

    expect(requestedPath()).toBe("docs/guide");
  });

  it("should turn Windows backslashes into slashes", async () => {
    await tool.execute({ library: "react", pathOrUrl: "docs\\guide.md" });

    expect(requestedPath()).toBe("docs/guide.md");
  });

  it("should keep percent-encoding as given", async () => {
    await tool.execute({ library: "react", pathOrUrl: "/docs/My%20Page" });

    expect(requestedPath()).toBe("/docs/My%20Page");
  });
});
