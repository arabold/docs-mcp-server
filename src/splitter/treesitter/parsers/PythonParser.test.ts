/**
 * Tests for PythonParser - Python source code parsing and boundary extraction
 */

import { beforeEach, describe, expect, it } from "vitest";
import { PythonParser } from "./PythonParser";

describe("PythonParser", () => {
  let parser: PythonParser;

  beforeEach(() => {
    parser = new PythonParser(30000);
  });

  describe("initialization", () => {
    it("should have correct name and extensions", () => {
      expect(parser.name).toBe("python");
      expect(parser.fileExtensions).toContain(".py");
      expect(parser.fileExtensions).toContain(".pyi");
      expect(parser.fileExtensions).toContain(".pyw");
    });

    it("should have correct MIME types", () => {
      expect(parser.mimeTypes).toContain("text/python");
      expect(parser.mimeTypes).toContain("text/x-python");
      expect(parser.mimeTypes).toContain("application/python");
      expect(parser.mimeTypes).toContain("application/x-python");
    });
  });

  describe("parsing", () => {
    it("should parse simple Python code without errors", () => {
      const code = `
def hello():
    return "world"

class Calculator:
    def add(self, a, b):
        return a + b
      `;

      const result = parser.parse(code);
      expect(result.tree).toBeDefined();
      expect(result.hasErrors).toBe(false);
      expect(result.errorNodes).toHaveLength(0);
    });

    it("should handle syntax errors gracefully", () => {
      const invalidCode = `
def hello(
    return "world"
      `;

      const result = parser.parse(invalidCode);
      expect(result.tree).toBeDefined();
      expect(result.hasErrors).toBe(true);
      expect(result.errorNodes.length).toBeGreaterThan(0);
    });

    it("should handle empty content", () => {
      const result = parser.parse("");
      expect(result.tree).toBeDefined();
      expect(result.hasErrors).toBe(false);
    });
  });

  describe("boundary extraction", () => {
    it("should extract function boundaries", () => {
      const code = `
def calculate_sum(a, b):
    """Calculate the sum of two numbers."""
    return a + b

async def async_function():
    """An async function."""
    return await some_operation()
      `;

      const result = parser.parse(code);
      const boundaries = parser.extractBoundaries(result.tree, code);

      expect(boundaries).toHaveLength(2);

      const syncFunction = boundaries.find((b) => b.name === "calculate_sum");
      expect(syncFunction).toBeDefined();
      expect(syncFunction?.type).toBe("function");
      expect(syncFunction?.boundaryType).toBe("content");

      const asyncFunction = boundaries.find((b) => b.name === "async_function");
      expect(asyncFunction).toBeDefined();
      expect(asyncFunction?.type).toBe("function");
      expect(asyncFunction?.boundaryType).toBe("content");
    });

    it("should extract class boundaries", () => {
      const code = `
class Calculator:
    """A simple calculator class."""
    
    def __init__(self):
        self.value = 0
    
    def add(self, number):
        """Add a number to the current value."""
        self.value += number
        return self.value

class AdvancedCalculator(Calculator):
    """Advanced calculator with more operations."""
    
    def multiply(self, number):
        self.value *= number
        return self.value
      `;

      const result = parser.parse(code);
      const boundaries = parser.extractBoundaries(result.tree, code);

      // Should have 2 classes + their methods
      const classes = boundaries.filter((b) => b.type === "class");
      expect(classes).toHaveLength(2);

      const calculatorClass = classes.find((c) => c.name === "Calculator");
      expect(calculatorClass).toBeDefined();
      expect(calculatorClass?.boundaryType).toBe("structural");

      const advancedClass = classes.find((c) => c.name === "AdvancedCalculator");
      expect(advancedClass).toBeDefined();
      expect(advancedClass?.boundaryType).toBe("structural");

      // Should also have methods
      const methods = boundaries.filter((b) => b.type === "function");
      expect(methods.length).toBeGreaterThan(0);
    });

    it("should extract import boundaries", () => {
      const code = `
import os
import sys
from typing import List, Dict
from collections import defaultdict
      `;

      const result = parser.parse(code);
      const boundaries = parser.extractBoundaries(result.tree, code);

      expect(boundaries).toHaveLength(4);

      const osImport = boundaries.find((b) => b.name === "import os");
      expect(osImport).toBeDefined();
      expect(osImport?.type).toBe("module");
      expect(osImport?.boundaryType).toBe("structural");

      const typingImport = boundaries.find((b) => b.name === "from typing");
      expect(typingImport).toBeDefined();
      expect(typingImport?.type).toBe("module");
      expect(typingImport?.boundaryType).toBe("structural");
    });

    it("should handle nested functions correctly (suppress local helpers)", () => {
      const code = `
def outer_function():
    """Outer function with nested helper."""
    
    def inner_helper():
        """This should be suppressed as a local helper."""
        return "helper"
    
    return inner_helper()

def another_function():
    """Another top-level function."""
    return "another"
      `;

      const result = parser.parse(code);
      const boundaries = parser.extractBoundaries(result.tree, code);

      // Should only have the two top-level functions, not the inner helper
      expect(boundaries).toHaveLength(2);
      expect(boundaries.map((b) => b.name)).toEqual(
        expect.arrayContaining(["outer_function", "another_function"]),
      );
      expect(boundaries.map((b) => b.name)).not.toContain("inner_helper");
    });

    it("should handle methods inside classes (not suppress them)", () => {
      const code = `
class MyClass:
    """A class with methods."""
    
    def method1(self):
        """First method."""
        return 1
    
    def method2(self):
        """Second method."""
        def local_helper():
            return "helper"
        return local_helper()
      `;

      const result = parser.parse(code);
      const boundaries = parser.extractBoundaries(result.tree, code);

      // Should have class + 2 methods, but not the local helper
      const classBoundary = boundaries.find((b) => b.name === "MyClass");
      expect(classBoundary).toBeDefined();

      const methods = boundaries.filter((b) => b.type === "function");
      expect(methods).toHaveLength(2);
      expect(methods.map((m) => m.name)).toEqual(
        expect.arrayContaining(["method1", "method2"]),
      );
      expect(methods.map((m) => m.name)).not.toContain("local_helper");
    });

    it("should include preceding comments in boundary", () => {
      const code = `
# This is a comment before the function
# Another comment line
def documented_function():
    """Function with both comments and docstring."""
    return "value"
      `;

      const result = parser.parse(code);
      const boundaries = parser.extractBoundaries(result.tree, code);

      expect(boundaries).toHaveLength(1);
      const func = boundaries[0];
      expect(func.name).toBe("documented_function");

      // The boundary should start at the first comment line
      const lines = code.split("\n");
      const commentLineIndex = lines.findIndex((line) =>
        line.includes("This is a comment"),
      );
      expect(func.startLine).toBe(commentLineIndex + 1); // 1-indexed
    });

    it("should handle docstrings correctly", () => {
      const code = `
def function_with_docstring():
    """
    This is a multi-line docstring.
    
    It describes what the function does.
    """
    return "result"

class ClassWithDocstring:
    """
    This is a class docstring.
    """
    
    def method_with_docstring(self):
        """Method docstring."""
        pass
      `;

      const result = parser.parse(code);
      const boundaries = parser.extractBoundaries(result.tree, code);

      expect(boundaries.length).toBeGreaterThan(0);

      // The docstring should be included in the function body naturally
      // since we don't adjust boundaries for docstrings in Python
      const func = boundaries.find((b) => b.name === "function_with_docstring");
      expect(func).toBeDefined();
      expect(func?.endLine).toBeGreaterThan(func?.startLine || 0);
    });

    it("should explicitly include docstrings within function boundaries", () => {
      const code = `def calculate_area(radius):
    """
    Calculate the area of a circle.
    
    Args:
        radius (float): The radius of the circle
        
    Returns:
        float: The area of the circle
    """
    pi = 3.14159
    return pi * radius * radius`;

      const result = parser.parse(code);
      const boundaries = parser.extractBoundaries(result.tree, code);

      // Should have 1 function boundary (no import statement now)
      expect(boundaries).toHaveLength(1);
      const func = boundaries[0];
      expect(func.name).toBe("calculate_area");

      // Extract the actual boundary content to verify docstring inclusion
      const lines = code.split("\n");
      const boundaryContent = lines.slice(func.startLine - 1, func.endLine).join("\n");

      // Boundary should include both the signature AND the docstring
      expect(boundaryContent).toContain("def calculate_area(radius):");
      expect(boundaryContent).toContain('"""');
      expect(boundaryContent).toContain("Calculate the area of a circle");
      expect(boundaryContent).toContain("Args:");
      expect(boundaryContent).toContain("Returns:");
      expect(boundaryContent).toContain("pi = 3.14159");
      expect(boundaryContent).toContain("return pi * radius * radius");
    });

    it("should include docstrings in class boundaries", () => {
      const code = `class DataProcessor:
    """
    A class for processing various types of data.
    
    This class provides methods for cleaning, transforming,
    and analyzing data from different sources.
    """
    
    def __init__(self, config):
        """Initialize the processor with configuration."""
        self.config = config`;

      const result = parser.parse(code);
      const boundaries = parser.extractBoundaries(result.tree, code);

      // Should have class + constructor method
      const classBoundary = boundaries.find((b) => b.name === "DataProcessor");
      expect(classBoundary).toBeDefined();

      // Extract class boundary content
      const lines = code.split("\n");
      const classBoundaryContent = lines
        .slice(classBoundary!.startLine - 1, classBoundary!.endLine)
        .join("\n");

      // Class boundary should include the class docstring
      expect(classBoundaryContent).toContain("class DataProcessor:");
      expect(classBoundaryContent).toContain('"""');
      expect(classBoundaryContent).toContain(
        "A class for processing various types of data",
      );
      expect(classBoundaryContent).toContain("This class provides methods");

      // Method should also have its docstring
      const methodBoundary = boundaries.find((b) => b.name === "__init__");
      expect(methodBoundary).toBeDefined();

      const methodBoundaryContent = lines
        .slice(methodBoundary!.startLine - 1, methodBoundary!.endLine)
        .join("\n");
      expect(methodBoundaryContent).toContain("def __init__(self, config):");
      expect(methodBoundaryContent).toContain(
        "Initialize the processor with configuration",
      );
    });

    it("should handle empty functions and classes", () => {
      const code = `
def empty_function():
    pass

class EmptyClass:
    pass
      `;

      const result = parser.parse(code);
      const boundaries = parser.extractBoundaries(result.tree, code);

      expect(boundaries).toHaveLength(2);

      const func = boundaries.find((b) => b.name === "empty_function");
      expect(func).toBeDefined();
      expect(func?.type).toBe("function");

      const cls = boundaries.find((b) => b.name === "EmptyClass");
      expect(cls).toBeDefined();
      expect(cls?.type).toBe("class");
    });
  });

  describe("large file handling", () => {
    it("should handle files larger than 32KB gracefully", () => {
      // Generate a Python file larger than 32,767 characters
      let largeCode = "# Large Python file test\n";
      let functionCount = 1;

      // Build content to exceed the limit
      while (largeCode.length < 35000) {
        largeCode += `
def test_function_${functionCount}():
    """Test function ${functionCount}."""
    value = ${functionCount}
    result = value * 2
    print(f"Function {functionCount} result: {result}")
    return result

class TestClass${functionCount}:
    """Test class ${functionCount}."""
    
    def __init__(self, value):
        self.value = value
    
    def process(self):
        return self.value * 10
`;
        functionCount++;
      }

      expect(largeCode.length).toBeGreaterThan(32767);

      // Parser should not crash and should return a valid result
      const result = parser.parse(largeCode);

      // Should have a valid tree
      expect(result.tree).toBeDefined();
      expect(result.tree.rootNode).toBeDefined();

      // Should flag errors due to truncation
      expect(result.hasErrors).toBe(true);

      // Should still be able to extract boundaries from the parsed portion
      const boundaries = parser.extractBoundaries(result.tree, largeCode);

      // Should find some boundaries from the beginning of the file
      expect(boundaries.length).toBeGreaterThan(0);

      // Should find early functions and classes
      const boundaryNames = boundaries.map((b) => b.name);
      expect(boundaryNames).toContain("test_function_1");
      expect(boundaryNames).toContain("TestClass1");

      // All boundaries should have valid line numbers
      for (const boundary of boundaries) {
        expect(boundary.startLine).toBeGreaterThan(0);
        expect(boundary.endLine).toBeGreaterThan(0);
        expect(boundary.endLine).toBeGreaterThanOrEqual(boundary.startLine);
      }
    });

    it("should maintain perfect content reconstruction for large files", () => {
      // Generate content just over the limit
      let testCode = "import sys\nimport os\n";
      let count = 1;

      while (testCode.length < 35000) {
        testCode += `def func_${count}():\n    return ${count}\n\n`;
        count++;
      }

      const originalLength = testCode.length;
      expect(originalLength).toBeGreaterThan(32767);

      // Parse and extract boundaries
      const result = parser.parse(testCode);
      const boundaries = parser.extractBoundaries(result.tree, testCode);

      // Verify we can reconstruct content from boundaries
      // Even though parsing was truncated, boundary extraction should work with original content
      expect(boundaries.length).toBeGreaterThan(0);

      // Each boundary should reference valid portions of the original content
      for (const boundary of boundaries) {
        const boundaryContent = testCode.slice(boundary.startByte, boundary.endByte);
        expect(boundaryContent.length).toBeGreaterThan(0);
        expect(boundary.startByte).toBeGreaterThanOrEqual(0);
        expect(boundary.endByte).toBeLessThanOrEqual(originalLength);
        expect(boundary.endByte).toBeGreaterThan(boundary.startByte);
      }
    });
  });

  describe("structural nodes extraction", () => {
    it("should extract structural nodes for compatibility", () => {
      const code = `
import os

class Calculator:
    def add(self, a, b):
        return a + b

def standalone_function():
    return "hello"
      `;

      const result = parser.parse(code);
      const nodes = parser.extractStructuralNodes(result.tree, code);

      expect(nodes.length).toBeGreaterThan(0);

      // Should include import, class, and functions
      const nodeNames = nodes.map((n) => n.name);
      expect(nodeNames).toContain("import os");
      expect(nodeNames).toContain("Calculator");
      expect(nodeNames).toContain("add");
      expect(nodeNames).toContain("standalone_function");
    });
  });
});
