import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type DocumentManagementService, VersionNotFoundInStoreError } from "../store";
import { ValidationError } from "./errors";
import { FindVersionTool } from "./FindVersionTool";

describe("FindVersionTool", () => {
  let findBestVersion: Mock<DocumentManagementService["findBestVersion"]>;
  let findVersionTool: FindVersionTool;

  beforeEach(() => {
    findBestVersion = vi.fn();
    findVersionTool = new FindVersionTool({
      findBestVersion,
    } as unknown as DocumentManagementService);
  });

  it("describes the best match and whether unversioned docs exist", async () => {
    const cases: Array<{
      label: string;
      library: string;
      targetVersion?: string;
      found: { bestMatch: string | null; hasUnversioned: boolean };
      message: string;
    }> = [
      {
        label: "best match only",
        library: "react",
        targetVersion: "18.2.0",
        found: { bestMatch: "18.2.0", hasUnversioned: false },
        message: "Best match: 18.2.0.",
      },
      {
        label: "best match and unversioned docs",
        library: "react",
        targetVersion: "18.x",
        found: { bestMatch: "18.3.1", hasUnversioned: true },
        message: "Best match: 18.3.1. Unversioned docs also available.",
      },
      {
        label: "unversioned docs only",
        library: "vue",
        targetVersion: "4.0.0",
        found: { bestMatch: null, hasUnversioned: true },
        message: "No matching version found for vue@4.0.0, but unversioned docs exist.",
      },
      {
        // The store receives no target version, not a stand-in for one
        label: "no target version",
        library: "react",
        found: { bestMatch: "18.3.1", hasUnversioned: false },
        message: "Best match: 18.3.1.",
      },
    ];

    for (const { label, library, targetVersion, found, message } of cases) {
      findBestVersion.mockResolvedValueOnce(found);

      const result = await findVersionTool.execute({ library, targetVersion });

      expect
        .soft(findBestVersion, label)
        .toHaveBeenLastCalledWith(library, targetVersion);
      expect.soft(result, label).toEqual({ ...found, message });
    }
  });

  it("passes a store error on unchanged", async () => {
    const errors = [
      new VersionNotFoundInStoreError("angular", "1.0.0", ["15.0.0", "16.1.0"]),
      new VersionNotFoundInStoreError("unknown-lib", "latest", []),
      new Error("Database connection failed"),
    ];

    for (const error of errors) {
      findBestVersion.mockRejectedValueOnce(error);
      await expect
        .soft(findVersionTool.execute({ library: "react" }), error.message)
        .rejects.toBe(error);
    }
  });

  it("should throw ValidationError for invalid library input", async () => {
    await expect(findVersionTool.execute({ library: "" })).rejects.toThrow(
      new ValidationError(
        "Library name is required and must be a non-empty string.",
        "FindVersionTool",
      ),
    );
  });
});
