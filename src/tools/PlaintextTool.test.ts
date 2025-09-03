import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { PlaintextTool } from "./PlaintextTool";

// Mock the analytics module
vi.mock("../telemetry", () => ({
  analytics: {
    trackTool: vi.fn((name, fn, metadata) => fn()),
  },
}));

// Mock the logger module
vi.mock("../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("PlaintextTool", () => {
  let mockDocService: IDocumentManagement;
  let plaintextTool: PlaintextTool;

  beforeEach(() => {
    // Create a mock document management service
    mockDocService = {
      initialize: vi.fn(),
      shutdown: vi.fn(),
      listLibraries: vi.fn(),
      validateLibraryExists: vi.fn(),
      findBestVersion: vi.fn(),
      searchStore: vi.fn(),
      removeAllDocuments: vi.fn(),
      removeVersion: vi.fn(),
      getVersionsByStatus: vi.fn(),
      findVersionsBySourceUrl: vi.fn(),
      getScraperOptions: vi.fn(),
      updateVersionStatus: vi.fn(),
      updateVersionProgress: vi.fn(),
      storeScraperOptions: vi.fn(),
      addDocument: vi.fn().mockResolvedValue(undefined),
    } as IDocumentManagement;

    plaintextTool = new PlaintextTool(mockDocService);
  });

  describe("execute", () => {
    it("should successfully add plaintext content with required fields", async () => {
      const options = {
        library: "test-library",
        version: "1.0.0",
        title: "Test Document",
        content: "This is test content for the document.",
      };

      const result = await plaintextTool.execute(options);

      expect(result.documentsAdded).toBe(1);
      expect(result.url).toMatch(/^plaintext:\/\/test-library\/1\.0\.0\/[a-f0-9]{8}$/);

      expect(mockDocService.addDocument).toHaveBeenCalledWith(
        "test-library",
        "1.0.0",
        expect.objectContaining({
          pageContent: "This is test content for the document.",
          metadata: expect.objectContaining({
            url: expect.stringMatching(
              /^plaintext:\/\/test-library\/1\.0\.0\/[a-f0-9]{8}$/,
            ),
            title: "Test Document",
            library: "test-library",
            version: "1.0.0",
            mimeType: "text/plain",
            sourceType: "plaintext",
          }),
        }),
      );
    });

    it("should handle unversioned content", async () => {
      const options = {
        library: "test-library",
        title: "Test Document",
        content: "This is test content.",
      };

      const result = await plaintextTool.execute(options);

      expect(result.documentsAdded).toBe(1);
      expect(result.url).toMatch(/^plaintext:\/\/test-library\/[a-f0-9]{8}$/);

      expect(mockDocService.addDocument).toHaveBeenCalledWith(
        "test-library",
        null,
        expect.objectContaining({
          metadata: expect.objectContaining({
            version: null,
            url: expect.stringMatching(/^plaintext:\/\/test-library\/[a-f0-9]{8}$/),
          }),
        }),
      );
    });

    it("should handle custom URL", async () => {
      const options = {
        library: "test-library",
        title: "Test Document",
        content: "This is test content.",
        url: "https://example.com/custom-doc",
      };

      const result = await plaintextTool.execute(options);

      expect(result.url).toBe("https://example.com/custom-doc");

      expect(mockDocService.addDocument).toHaveBeenCalledWith(
        "test-library",
        null,
        expect.objectContaining({
          metadata: expect.objectContaining({
            url: "https://example.com/custom-doc",
          }),
        }),
      );
    });

    it("should handle metadata fields", async () => {
      const options = {
        library: "test-library",
        title: "Test Document",
        content: "This is test content.",
        metadata: {
          description: "A test document for unit tests",
          tags: ["test", "documentation", "unit-test"],
          contentType: "text/markdown",
        },
      };

      await plaintextTool.execute(options);

      expect(mockDocService.addDocument).toHaveBeenCalledWith(
        "test-library",
        null,
        expect.objectContaining({
          metadata: expect.objectContaining({
            description: "A test document for unit tests",
            tags: ["test", "documentation", "unit-test"],
            mimeType: "text/markdown",
            customMetadata: expect.objectContaining({
              description: "A test document for unit tests",
              tags: ["test", "documentation", "unit-test"],
              contentType: "text/markdown",
            }),
          }),
        }),
      );
    });

    it("should throw error for empty content", async () => {
      const options = {
        library: "test-library",
        title: "Test Document",
        content: "",
      };

      await expect(plaintextTool.execute(options)).rejects.toThrow(
        "Content cannot be empty",
      );
      expect(mockDocService.addDocument).not.toHaveBeenCalled();
    });

    it("should throw error for empty title", async () => {
      const options = {
        library: "test-library",
        title: "",
        content: "This is test content.",
      };

      await expect(plaintextTool.execute(options)).rejects.toThrow(
        "Title cannot be empty",
      );
      expect(mockDocService.addDocument).not.toHaveBeenCalled();
    });

    it("should throw error for empty library", async () => {
      const options = {
        library: "",
        title: "Test Document",
        content: "This is test content.",
      };

      await expect(plaintextTool.execute(options)).rejects.toThrow(
        "Library cannot be empty",
      );
      expect(mockDocService.addDocument).not.toHaveBeenCalled();
    });

    it("should throw error for whitespace-only fields", async () => {
      const options = {
        library: "   ",
        title: "   ",
        content: "   ",
      };

      await expect(plaintextTool.execute(options)).rejects.toThrow(
        "Library cannot be empty",
      );
    });

    it("should handle document service errors", async () => {
      const options = {
        library: "test-library",
        title: "Test Document",
        content: "This is test content.",
      };

      const serviceError = new Error("Document service failed");
      (mockDocService.addDocument as any).mockRejectedValue(serviceError);

      await expect(plaintextTool.execute(options)).rejects.toThrow(
        "Document service failed",
      );
    });

    it("should generate unique URLs for different content", async () => {
      const options1 = {
        library: "test-library",
        title: "Test Document 1",
        content: "This is the first test content.",
      };

      const options2 = {
        library: "test-library",
        title: "Test Document 2",
        content: "This is the second test content.",
      };

      const result1 = await plaintextTool.execute(options1);
      const result2 = await plaintextTool.execute(options2);

      expect(result1.url).not.toBe(result2.url);
    });

    it("should generate same URL for identical content", async () => {
      const options1 = {
        library: "test-library",
        title: "Test Document",
        content: "This is identical content.",
      };

      const options2 = {
        library: "test-library",
        title: "Different Title",
        content: "This is identical content.",
      };

      const result1 = await plaintextTool.execute(options1);
      const result2 = await plaintextTool.execute(options2);

      // URLs should be the same since they're based on content hash, not title
      expect(result1.url).toBe(result2.url);
    });
  });

  describe("URL generation", () => {
    it("should generate proper format with version", () => {
      const tool = new PlaintextTool(mockDocService);
      const url = (tool as any).generatePlaintextUrl("test-lib", "1.0.0", "test content");
      expect(url).toMatch(/^plaintext:\/\/test-lib\/1\.0\.0\/[a-f0-9]{8}$/);
    });

    it("should generate proper format without version", () => {
      const tool = new PlaintextTool(mockDocService);
      const url = (tool as any).generatePlaintextUrl("test-lib", null, "test content");
      expect(url).toMatch(/^plaintext:\/\/test-lib\/[a-f0-9]{8}$/);
    });

    it("should generate consistent hashes for same content", () => {
      const tool = new PlaintextTool(mockDocService);
      const url1 = (tool as any).generatePlaintextUrl(
        "test-lib",
        "1.0.0",
        "identical content",
      );
      const url2 = (tool as any).generatePlaintextUrl(
        "test-lib",
        "1.0.0",
        "identical content",
      );
      expect(url1).toBe(url2);
    });
  });
});
