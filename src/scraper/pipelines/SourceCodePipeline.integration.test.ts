/**
 * Integration test for SourceCodePipeline with Python TreeSitter support
 */

import { describe, expect, it } from "vitest";
import { SourceCodePipeline } from "./SourceCodePipeline";

describe("SourceCodePipeline with TreeSitter", () => {
  it("should use TreeSitter for Python files", async () => {
    const pipeline = new SourceCodePipeline();
    
    const pythonContent = `
def hello_world():
    """Print hello world message."""
    print("Hello, World!")

class Calculator:
    """Simple calculator class."""
    
    def add(self, a, b):
        """Add two numbers."""
        return a + b
    
    def multiply(self, a, b):
        """Multiply two numbers."""
        return a * b
`;

    const rawContent = {
      content: Buffer.from(pythonContent),
      mimeType: "text/x-python",
      source: { type: "file" as const, filePath: "/test/example.py" },
      charset: "utf-8",
    };

    const options = {
      url: "file:///test/example.py",
      library: "test",
      version: "1.0.0",
    };

    // Test that it can process Python files
    expect(pipeline.canProcess(rawContent)).toBe(true);

    // Process the content
    const result = await pipeline.process(rawContent, options);
    
    expect(result).toBeDefined();
    expect(result.chunks).toBeDefined();
    expect(result.chunks.length).toBeGreaterThan(0);
    
    // Check for hierarchical structure
    const calculatorChunk = result.chunks.find(chunk => 
      chunk.section?.path.includes("Calculator")
    );
    expect(calculatorChunk).toBeDefined();
    
    const addMethodChunk = result.chunks.find(chunk => 
      chunk.section?.path.includes("add")
    );
    expect(addMethodChunk).toBeDefined();
    
    // Verify hierarchical levels
    expect(calculatorChunk?.section?.level).toBe(1);
    expect(addMethodChunk?.section?.level).toBe(2);
    
    // Verify docstrings are included
    expect(calculatorChunk?.content).toContain("Simple calculator class");
    expect(addMethodChunk?.content).toContain("Add two numbers");
  });

  it("should fallback to TextDocumentSplitter for unsupported languages", async () => {
    const pipeline = new SourceCodePipeline();
    
    const cppContent = `
#include <iostream>

int main() {
    std::cout << "Hello, World!" << std::endl;
    return 0;
}
`;

    const rawContent = {
      content: Buffer.from(cppContent),
      mimeType: "text/x-c++",
      source: { type: "file" as const, filePath: "/test/example.cpp" },
      charset: "utf-8",
    };

    const options = {
      url: "file:///test/example.cpp",
      library: "test", 
      version: "1.0.0",
    };

    // Test that it can process C++ files
    expect(pipeline.canProcess(rawContent)).toBe(true);

    // Process the content (should use fallback)
    const result = await pipeline.process(rawContent, options);
    
    expect(result).toBeDefined();
    expect(result.chunks).toBeDefined();
    expect(result.chunks.length).toBeGreaterThan(0);
    
    // Should have basic chunks but not TreeSitter structure
    expect(result.chunks[0].section?.path).toContain("cpp-file");
  });
});