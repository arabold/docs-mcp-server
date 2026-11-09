import { beforeEach, describe, expect, it, type MockedObject, vi } from "vitest";
import type { DocumentManagementService } from "../store";
import { RemoveTool, type RemoveToolArgs } from "./RemoveTool";

// Create a properly typed mock using MockedObject
const mockDocService = {
  removeVersion: vi.fn(),
  validateLibraryExists: vi.fn(),
  // Add other methods used by DocumentManagementService if needed, mocking them with vi.fn()
} as MockedObject<DocumentManagementService>;

describe("RemoveTool", () => {
  let removeTool: RemoveTool;

  beforeEach(() => {
    // Reset mocks before each test
    vi.resetAllMocks(); // Resets all mocks, including those on mockDocService
    // Without a pipeline, the document service removes the version
    removeTool = new RemoveTool(mockDocService, undefined);
  });

  // Failures, the pipeline route and a missing library are covered end to end:
  // cli-e2e "reports a failing command without the help or a stack trace",
  // remote-worker-e2e "cancels the worker's job when the web UI removes its
  // version", and library-identity-e2e.
  it("removes the version and names what it removed", async () => {
    mockDocService.validateLibraryExists.mockResolvedValue(undefined);
    mockDocService.removeVersion.mockResolvedValue(undefined);
    const cases: Array<{ label: string; args: RemoveToolArgs; message: string }> = [
      {
        label: "versioned",
        args: { library: "react", version: "18.2.0" },
        message: "Successfully removed react@18.2.0.",
      },
      {
        label: "unversioned",
        args: { library: "lodash" },
        message: "Successfully removed lodash.",
      },
      {
        label: "empty version",
        args: { library: "moment", version: "" },
        message: "Successfully removed moment.",
      },
      {
        // A library "d1" that exists in the database with no versions or
        // documents is removed without a confusing error.
        label: "library in a broken state",
        args: { library: "d1" },
        message: "Successfully removed d1.",
      },
    ];

    for (const { label, args, message } of cases) {
      const result = await removeTool.execute(args);

      expect
        .soft(mockDocService.validateLibraryExists, label)
        .toHaveBeenLastCalledWith(args.library);
      expect
        .soft(mockDocService.removeVersion, label)
        .toHaveBeenLastCalledWith(args.library, args.version);
      expect.soft(result, label).toEqual({ message });
    }
  });
});
