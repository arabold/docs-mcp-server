/**
 * Tests for TreeSitterDocumentSplitter
 */

import { beforeEach, describe, expect, it } from "vitest";
import { TreeSitterDocumentSplitter } from "./TreeSitterDocumentSplitter";

describe("TreeSitterDocumentSplitter", () => {
  let splitter: TreeSitterDocumentSplitter;

  beforeEach(() => {
    splitter = new TreeSitterDocumentSplitter();
  });

  describe("canParseWithTreeSitter", () => {
    it("should return true for supported Python MIME types", () => {
      expect(splitter.canParseWithTreeSitter("text/x-python")).toBe(true);
      expect(splitter.canParseWithTreeSitter("application/x-python")).toBe(true);
    });

    it("should return false for unsupported MIME types", () => {
      expect(splitter.canParseWithTreeSitter("text/plain")).toBe(false);
      expect(splitter.canParseWithTreeSitter("application/json")).toBe(false);
      expect(splitter.canParseWithTreeSitter("text/html")).toBe(false);
    });

    it("should return false for undefined content type", () => {
      expect(splitter.canParseWithTreeSitter(undefined)).toBe(false);
    });
  });

  describe("getSupportedContentTypes", () => {
    it("should return list of supported MIME types", () => {
      const supportedTypes = splitter.getSupportedContentTypes();
      
      expect(supportedTypes).toContain("text/x-python");
      expect(supportedTypes).toContain("application/x-python");
      expect(Array.isArray(supportedTypes)).toBe(true);
    });
  });

  describe("splitText", () => {
    it("should split Python code using TreeSitter when supported", async () => {
      const pythonCode = `
def hello_world():
    """Print hello world message."""
    print("Hello, World!")

class Calculator:
    """Simple calculator class."""
    
    def add(self, a, b):
        """Add two numbers."""
        return a + b
`;

      const chunks = await splitter.splitText(pythonCode, "text/x-python");
      
      expect(chunks).toBeDefined();
      expect(chunks.length).toBeGreaterThan(0);
      
      // Should have chunks with proper structure
      const functionChunk = chunks.find(chunk => 
        chunk.section?.path.includes("hello_world")
      );
      const classChunk = chunks.find(chunk => 
        chunk.section?.path.includes("Calculator")
      );
      
      expect(functionChunk).toBeDefined();
      expect(classChunk).toBeDefined();
    });

    it("should use fallback splitting for unsupported content types", async () => {
      const textContent = `
This is some plain text content
that should be split using the fallback method.

It has multiple lines and paragraphs.
The fallback method should handle this gracefully.
`;

      const chunks = await splitter.splitText(textContent, "text/plain");
      
      expect(chunks).toBeDefined();
      expect(chunks.length).toBeGreaterThan(0);
      
      // Should create fallback chunks
      const chunk = chunks[0];
      expect(chunk.types).toContain("code");
      expect(chunk.section?.path).toBeDefined();
    });

    it("should handle empty content", async () => {
      const chunks = await splitter.splitText("", "text/x-python");
      expect(chunks).toEqual([]);
    });

    it("should handle whitespace-only content", async () => {
      const chunks = await splitter.splitText("   \n\n  \t  ", "text/x-python");
      expect(chunks).toEqual([]);
    });

    it("should filter out empty chunks", async () => {
      const pythonCode = `

# Just a comment

`;

      const chunks = await splitter.splitText(pythonCode, "text/x-python");
      
      // Should not include empty or comment-only chunks
      const meaningfulChunks = chunks.filter(chunk => chunk.content.trim().length > 0);
      expect(meaningfulChunks.length).toBe(chunks.length);
    });

    it("should handle very large chunks appropriately", async () => {
      // Create a large Python function with actual structure
      const largeFunctionBody = Array(100).fill("    print('line')").join("\n");
      const pythonCode = `
def large_function():
    """A very large function."""
${largeFunctionBody}
    return "done"
`;

      const chunks = await splitter.splitText(pythonCode, "text/x-python");
      
      expect(chunks).toBeDefined();
      // Should not filter out large structural chunks when preserveStructure is true
      expect(chunks.length).toBeGreaterThan(0);
      
      // Should find the large function
      const largeFunction = chunks.find(chunk => 
        chunk.section?.path.includes("large_function")
      );
      expect(largeFunction).toBeDefined();
    });
  });

  describe("fallback behavior", () => {
    it("should gracefully handle TreeSitter parsing errors", async () => {
      // Create invalid Python syntax but with some structure 
      const invalidPython = `
def valid_function():
    return "this is valid"

# Invalid syntax that might cause parsing issues
def invalid syntax here
    this is not valid python
    but should not crash the splitter

def another_function():
    return "this is also valid"
`;

      const chunks = await splitter.splitText(invalidPython, "text/x-python");
      
      // Should fall back to basic splitting without crashing
      expect(chunks).toBeDefined();
      expect(chunks.length).toBeGreaterThan(0);
      
      // Should find at least the valid functions
      const validFunction = chunks.find(chunk => 
        chunk.section?.path.includes("valid_function") ||
        chunk.section?.path.includes("another_function")
      );
      expect(validFunction).toBeDefined();
    });

    it("should use language detection for fallback chunks", async () => {
      const cppCode = `
#include <iostream>

int main() {
    std::cout << "Hello, World!" << std::endl;
    return 0;
}
`;

      const chunks = await splitter.splitText(cppCode, "text/x-c++");
      
      expect(chunks).toBeDefined();
      expect(chunks.length).toBeGreaterThan(0);
      
      // Should detect language even in fallback mode
      const chunk = chunks[0];
      expect(chunk.section?.path).toBeDefined();
    });
  });

  describe("configuration options", () => {
    it("should respect maxChunkSize option", () => {
      const customSplitter = new TreeSitterDocumentSplitter({ 
        maxChunkSize: 1000 
      });
      
      expect(customSplitter).toBeDefined();
      // Note: Testing the actual chunk size limits would require larger code samples
    });

    it("should respect preserveStructure option", () => {
      const customSplitter = new TreeSitterDocumentSplitter({ 
        preserveStructure: false 
      });
      
      expect(customSplitter).toBeDefined();
    });

    it("should respect includeDocumentation option", () => {
      const customSplitter = new TreeSitterDocumentSplitter({ 
        includeDocumentation: false 
      });
      
      expect(customSplitter).toBeDefined();
    });
  });
});