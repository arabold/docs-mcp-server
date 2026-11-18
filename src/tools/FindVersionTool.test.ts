import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type DocumentManagementService, VersionNotFoundInStoreError } from "../store";
import { ValidationError } from "./errors";
import { FindVersionTool } from "./FindVersionTool";

describe("FindVersionTool", () => {
  let resolveDocumentation: Mock<DocumentManagementService["resolveDocumentation"]>;
  let findVersionTool: FindVersionTool;

  beforeEach(() => {
    resolveDocumentation = vi.fn();
    findVersionTool = new FindVersionTool({
      resolveDocumentation,
    } as unknown as DocumentManagementService);
  });

  it("describes the best match and whether unversioned docs exist", async () => {
    const cases: Array<{
      label: string;
      library: string;
      resolvedLibrary?: string;
      targetVersion?: string;
      versions: string[];
      message: string;
    }> = [
      {
        label: "best match only",
        library: "react",
        targetVersion: "18.2.0",
        versions: ["18.2.0"],
        message: "Best match: 18.2.0. Matches requested version 18.2.0.",
      },
      {
        label: "best match and unversioned docs",
        library: "react",
        targetVersion: "18.x",
        versions: ["18.3.1", ""],
        message: "Best match: 18.3.1. Matches requested version 18.x. Unversioned docs also available.",
      },
      {
        label: "unversioned docs only",
        library: "vue",
        targetVersion: "4.0.0",
        versions: [""],
        message: "Requested: 4.0.0. Using unversioned documentation. The source version is unknown.",
      },
      {
        // The store receives no target version, not a stand-in for one
        label: "no target version",
        library: "react",
        versions: ["18.3.1"],
        message: "Best match: 18.3.1.",
      },
      {
        label: "alias and same-line fallback",
        library: "Spring Boot",
        resolvedLibrary: "spring-boot",
        targetVersion: "3.4.1",
        versions: ["3.4.13", ""],
        message: "Indexed library: spring-boot. Best match: 3.4.13. Requested: 3.4.1. Using a different indexed version. Unversioned docs also available.",
      },
    ];

    for (const { label, library, resolvedLibrary, targetVersion, versions, message } of cases) {
      resolveDocumentation.mockResolvedValueOnce({ library: resolvedLibrary ?? library, versions });

      const result = await findVersionTool.execute({ library, targetVersion });

      expect
        .soft(resolveDocumentation, label)
        .toHaveBeenLastCalledWith(library, targetVersion);
      expect.soft(result, label).toEqual({
        bestMatch: versions[0] || null,
        hasUnversioned: versions.includes(""),
        message,
      });
    }
  });

  it("passes a store error on unchanged", async () => {
    const errors = [
      new VersionNotFoundInStoreError("angular", "1.0.0", ["15.0.0", "16.1.0"]),
      new VersionNotFoundInStoreError("unknown-lib", "latest", []),
      new Error("Database connection failed"),
    ];

    for (const error of errors) {
      resolveDocumentation.mockRejectedValueOnce(error);
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
