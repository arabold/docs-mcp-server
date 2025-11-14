import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type DocumentManagementService, VersionNotFoundInStoreError } from "../store";
import { ValidationError } from "./errors";
import { FindVersionTool, type FindVersionToolOptions } from "./FindVersionTool";

// Mock dependencies
vi.mock("../store"); // Mock the entire store module if DocumentManagementService is complex

describe("FindVersionTool", () => {
  let mockDocService: Partial<DocumentManagementService>;
  let findVersionTool: FindVersionTool;

  beforeEach(() => {
    // Reset mocks before each test
    vi.resetAllMocks();

    // Setup mock DocumentManagementService
    mockDocService = {
      findBestVersion: vi.fn(),
    };

    // Create instance of the tool with the mock service
    findVersionTool = new FindVersionTool(mockDocService as DocumentManagementService);
  });

  it("should return structured result indicating best match when found", async () => {
    const options: FindVersionToolOptions = { library: "react", targetVersion: "18.2.0" };
    const mockResult = { bestMatch: "18.2.0", hasUnversioned: false };
    (mockDocService.findBestVersion as Mock).mockResolvedValue(mockResult);

    const result = await findVersionTool.execute(options);

    expect(mockDocService.findBestVersion).toHaveBeenCalledWith("react", "18.2.0");
    expect(result.bestMatch).toBe("18.2.0");
    expect(result.hasUnversioned).toBe(false);
    expect(result.message).toContain("Best match: 18.2.0");
    expect(result.message).not.toContain("Unversioned docs");
  });

  it("should return structured result indicating best match and unversioned docs when both exist", async () => {
    const options: FindVersionToolOptions = { library: "react", targetVersion: "18.x" };
    const mockResult = { bestMatch: "18.3.1", hasUnversioned: true };
    (mockDocService.findBestVersion as Mock).mockResolvedValue(mockResult);

    const result = await findVersionTool.execute(options);

    expect(mockDocService.findBestVersion).toHaveBeenCalledWith("react", "18.x");
    expect(result.bestMatch).toBe("18.3.1");
    expect(result.hasUnversioned).toBe(true);
    expect(result.message).toContain("Best match: 18.3.1");
    expect(result.message).toContain("Unversioned docs also available");
  });

  it("should return structured result indicating only unversioned docs when no version matches", async () => {
    const options: FindVersionToolOptions = { library: "vue", targetVersion: "4.0.0" };
    const mockResult = { bestMatch: null, hasUnversioned: true };
    (mockDocService.findBestVersion as Mock).mockResolvedValue(mockResult);

    const result = await findVersionTool.execute(options);

    expect(mockDocService.findBestVersion).toHaveBeenCalledWith("vue", "4.0.0");
    expect(result.bestMatch).toBe(null);
    expect(result.hasUnversioned).toBe(true);
    expect(result.message).toContain("No matching version found");
    expect(result.message).toContain("but unversioned docs exist");
  });

  it("should throw VersionNotFoundInStoreError when no match is found", async () => {
    const options: FindVersionToolOptions = {
      library: "angular",
      targetVersion: "1.0.0",
    };
    // Update test data to match LibraryVersionDetails
    const available = ["15.0.0", "16.1.0"];
    const error = new VersionNotFoundInStoreError("angular", "1.0.0", available);
    (mockDocService.findBestVersion as Mock).mockRejectedValue(error);

    await expect(findVersionTool.execute(options)).rejects.toThrow(
      VersionNotFoundInStoreError,
    );
    expect(mockDocService.findBestVersion).toHaveBeenCalledWith("angular", "1.0.0");
  });

  it("should throw VersionNotFoundInStoreError when no available versions exist", async () => {
    const options: FindVersionToolOptions = { library: "unknown-lib" };
    // Pass empty available versions array
    const error = new VersionNotFoundInStoreError("unknown-lib", "latest", []);
    (mockDocService.findBestVersion as Mock).mockRejectedValue(error);

    await expect(findVersionTool.execute(options)).rejects.toThrow(
      VersionNotFoundInStoreError,
    );
    expect(mockDocService.findBestVersion).toHaveBeenCalledWith("unknown-lib", undefined); // targetVersion is undefined
  });

  it("should throw unexpected errors from docService", async () => {
    const options: FindVersionToolOptions = { library: "react" };
    const unexpectedError = new Error("Database connection failed");
    (mockDocService.findBestVersion as Mock).mockRejectedValue(unexpectedError);

    await expect(findVersionTool.execute(options)).rejects.toThrow(
      "Database connection failed",
    );
  });

  it("should handle missing targetVersion correctly", async () => {
    const options: FindVersionToolOptions = { library: "react" }; // No targetVersion
    const mockResult = { bestMatch: "18.3.1", hasUnversioned: false };
    (mockDocService.findBestVersion as Mock).mockResolvedValue(mockResult);

    const result = await findVersionTool.execute(options);

    // Check that findBestVersion was called with undefined for targetVersion
    expect(mockDocService.findBestVersion).toHaveBeenCalledWith("react", undefined);
    expect(result.bestMatch).toBe("18.3.1");
    expect(result.hasUnversioned).toBe(false);
    expect(result.message).toContain("Best match: 18.3.1");
  });

  it("should throw ValidationError for invalid library input", async () => {
    const options: FindVersionToolOptions = { library: "" };

    await expect(findVersionTool.execute(options)).rejects.toThrow(ValidationError);
    await expect(findVersionTool.execute(options)).rejects.toThrow(
      "Library name is required",
    );
  });
});
