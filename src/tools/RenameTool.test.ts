import { beforeEach, describe, expect, it, type MockedObject, vi } from "vitest";
import type { DocumentManagementService } from "../store";
import { ValidationError } from "./errors";
import { RenameTool } from "./RenameTool";

// Create a properly typed mock using MockedObject
const mockDocService = {
  renameLibrary: vi.fn(),
  validateLibraryExists: vi.fn(),
} as MockedObject<DocumentManagementService>;

describe("RenameTool", () => {
  let renameTool: RenameTool;

  beforeEach(() => {
    // Reset mocks before each test
    vi.resetAllMocks();
    renameTool = new RenameTool(mockDocService);
  });

  it("renames the library and names both names", async () => {
    mockDocService.validateLibraryExists.mockResolvedValue(undefined);
    mockDocService.renameLibrary.mockResolvedValue({
      oldName: "React",
      newName: "Next.js Docs",
    });

    const result = await renameTool.execute({
      library: "react",
      newName: "Next.js Docs",
    });

    expect(mockDocService.validateLibraryExists).toHaveBeenLastCalledWith("react");
    expect(mockDocService.renameLibrary).toHaveBeenLastCalledWith(
      "react",
      "Next.js Docs",
    );
    expect(result.message).toBe("Successfully renamed React to Next.js Docs.");
  });

  it.each([
    { label: "missing library", args: { library: "", newName: "next" } },
    { label: "blank library", args: { library: "  ", newName: "next" } },
    { label: "missing new name", args: { library: "react", newName: "" } },
    { label: "blank new name", args: { library: "react", newName: "  " } },
  ])("rejects $label without touching the store", async ({ args }) => {
    await expect(renameTool.execute(args)).rejects.toBeInstanceOf(ValidationError);

    expect(mockDocService.validateLibraryExists).not.toHaveBeenCalled();
    expect(mockDocService.renameLibrary).not.toHaveBeenCalled();
  });

  it("wraps a store failure with both names", async () => {
    mockDocService.validateLibraryExists.mockResolvedValue(undefined);
    mockDocService.renameLibrary.mockRejectedValue(
      new Error('Library "Vue" already exists.'),
    );

    await expect(
      renameTool.execute({ library: "react", newName: "vue" }),
    ).rejects.toThrow('Failed to rename react to vue: Library "Vue" already exists.');
  });
});
