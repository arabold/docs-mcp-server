import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { ValidationError } from "./errors";
import { ReadPageTool } from "./ReadPageTool";

describe("ReadPageTool", () => {
  let mockDocService: Partial<IDocumentManagement>;
  let tool: ReadPageTool;

  beforeEach(() => {
    vi.resetAllMocks();
    mockDocService = {
      getPageContent: vi.fn(),
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
    await expect(tool.execute({ library: "react", pathOrUrl: "   " })).rejects.toThrow(
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

  it("should return page content successfully", async () => {
    const mockResult = {
      url: "https://react.dev/reference/react",
      title: "React Reference",
      content: "# React\n\nBuilt-in React Hooks and Components.",
      contentType: "text/markdown",
      charCount: 47,
      chunksCount: 2,
      truncated: false,
    };

    (mockDocService.getPageContent as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResult,
    );

    const result = await tool.execute({
      library: "react",
      pathOrUrl: "https://react.dev/reference/react",
      version: "19.0.0",
    });

    expect(mockDocService.getPageContent).toHaveBeenCalledWith(
      "react",
      "19.0.0",
      "https://react.dev/reference/react",
      { maxChars: undefined },
    );
    expect(result).toEqual(mockResult);
  });
});
