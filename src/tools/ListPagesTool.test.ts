import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { ValidationError } from "./errors";
import { ListPagesTool, type ListPagesToolOptions } from "./ListPagesTool";

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

  it("hands the store a trimmed query with the limit clamped to 1-200", async () => {
    vi.mocked(
      mockDocService.listPages as IDocumentManagement["listPages"],
    ).mockResolvedValue({
      library: "react",
      version: "",
      total: 0,
      pages: [],
      limit: 50,
      offset: 0,
      hasMore: false,
    });
    const cases: Array<{
      label: string;
      input: ListPagesToolOptions;
      expected: Parameters<IDocumentManagement["listPages"]>;
    }> = [
      {
        label: "limit above 200",
        input: { library: "react", limit: 500 },
        expected: ["react", undefined, { contains: undefined, limit: 200, offset: 0 }],
      },
      {
        label: "negative limit",
        input: { library: "react", limit: -10 },
        expected: ["react", undefined, { contains: undefined, limit: 50, offset: 0 }],
      },
      {
        label: "padded contains filter",
        input: { library: "react", contains: "  /hooks  " },
        expected: ["react", undefined, { contains: "/hooks", limit: 50, offset: 0 }],
      },
    ];

    for (const { label, input, expected } of cases) {
      await tool.execute(input);
      expect.soft(mockDocService.listPages, label).toHaveBeenLastCalledWith(...expected);
    }
  });
});
