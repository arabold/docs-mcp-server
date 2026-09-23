import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { ValidationError } from "./errors";
import { ListPagesTool } from "./ListPagesTool";

describe("ListPagesTool", () => {
  let mockDocService: Partial<IDocumentManagement>;
  let tool: ListPagesTool;

  beforeEach(() => {
    vi.resetAllMocks();
    mockDocService = {
      listPages: vi.fn(),
    };
    tool = new ListPagesTool(mockDocService as IDocumentManagement);
  });

  it("should throw ValidationError if library is missing or empty", async () => {
    await expect(tool.execute({ library: "" })).rejects.toThrow(ValidationError);
    await expect(tool.execute({ library: "   " })).rejects.toThrow(ValidationError);
  });

  it("should enforce limit constraints and clamp between 1 and 200", async () => {
    const mockResult = {
      library: "react",
      version: "19.0.0",
      total: 1,
      pages: [{ url: "https://react.dev/start", title: "Quickstart", depth: 1 }],
      limit: 50,
      offset: 0,
      hasMore: false,
    };
    (mockDocService.listPages as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

    await tool.execute({ library: "react", limit: 500 });
    expect(mockDocService.listPages).toHaveBeenCalledWith("react", undefined, {
      prefix: undefined,
      limit: 200,
      offset: 0,
    });

    await tool.execute({ library: "react", limit: -10 });
    expect(mockDocService.listPages).toHaveBeenCalledWith("react", undefined, {
      prefix: undefined,
      limit: 50,
      offset: 0,
    });
  });

  it("should return list of pages successfully", async () => {
    const mockResult = {
      library: "openrouter",
      version: "",
      total: 2,
      pages: [
        { url: "https://openrouter.ai/docs/quickstart", title: "Quickstart", depth: 1 },
        { url: "https://openrouter.ai/docs/models", title: "Models", depth: 2 },
      ],
      limit: 50,
      offset: 0,
      hasMore: false,
    };
    (mockDocService.listPages as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

    const result = await tool.execute({
      library: "openrouter",
      prefix: "/docs",
      limit: 50,
      offset: 0,
    });

    expect(result).toEqual(mockResult);
  });
});
