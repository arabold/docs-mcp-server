import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { CompactStoreTool } from "./CompactStoreTool";

describe("CompactStoreTool", () => {
  let mockDocService: Partial<IDocumentManagement>;
  let tool: CompactStoreTool;

  beforeEach(() => {
    vi.resetAllMocks();
    mockDocService = {
      compact: vi.fn(),
    };
    tool = new CompactStoreTool(mockDocService as IDocumentManagement);
  });

  it("should run compaction and return stats", async () => {
    const mockResult = {
      skipped: false,
      vacuumed: true,
      beforeBytes: 10485760,
      afterBytes: 5242880,
      reclaimedBytes: 5242880,
    };
    (mockDocService.compact as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

    const result = await tool.execute({ force: true, vacuum: true });

    expect(mockDocService.compact).toHaveBeenCalledWith({ force: true, vacuum: true });
    expect(result).toEqual(mockResult);
  });
});
