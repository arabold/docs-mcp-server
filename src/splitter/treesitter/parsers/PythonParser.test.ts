/**
 * Tests for PythonParser - Python source code parsing and boundary extraction
 */

import { beforeEach, describe, expect, it } from "vitest";
import { PythonParser } from "./PythonParser";
import type { CodeBoundary } from "./types";

describe("PythonParser", () => {
  let parser: PythonParser;

  beforeEach(() => {
    parser = new PythonParser(30000);
  });

  /** The boundaries the parser finds in `code`. */
  const boundariesOf = (code: string) =>
    parser.extractBoundaries(parser.parse(code).tree, code);

  /** The source lines a boundary spans. */
  const textOf = (code: string, b: { startLine: number; endLine: number }) =>
    code
      .split("\n")
      .slice(b.startLine - 1, b.endLine)
      .join("\n");

  it("parses Python and flags syntax errors", () => {
    const cases: Array<[label: string, code: string, hasErrors: boolean]> = [
      [
        "valid code",
        `
def hello():
    return "world"

class Calculator:
    def add(self, a, b):
        return a + b
      `,
        false,
      ],
      ["syntax error", `\ndef hello(\n    return "world"\n      `, true],
      ["empty", "", false],
    ];

    for (const [label, code, hasErrors] of cases) {
      const result = parser.parse(code);
      expect.soft(result.hasErrors, `${label}: hasErrors`).toBe(hasErrors);
      expect.soft(result.errorNodes.length > 0, `${label}: error nodes`).toBe(hasErrors);
    }
  });

  it("extracts functions as content and classes as structural boundaries", () => {
    const cases: Array<
      [
        label: string,
        code: string,
        expected: Array<Pick<CodeBoundary, "name" | "type" | "boundaryType">>,
      ]
    > = [
      [
        "sync and async functions",
        `
def calculate_sum(a, b):
    """Calculate the sum of two numbers."""
    return a + b

async def async_function():
    """An async function."""
    return await some_operation()
      `,
        [
          { name: "calculate_sum", type: "function", boundaryType: "content" },
          { name: "async_function", type: "function", boundaryType: "content" },
        ],
      ],
      [
        "classes and their methods",
        `
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
      `,
        [
          { name: "Calculator", type: "class", boundaryType: "structural" },
          { name: "__init__", type: "function", boundaryType: "content" },
          { name: "add", type: "function", boundaryType: "content" },
          { name: "AdvancedCalculator", type: "class", boundaryType: "structural" },
          { name: "multiply", type: "function", boundaryType: "content" },
        ],
      ],
      [
        "empty function and class",
        `
def empty_function():
    pass

class EmptyClass:
    pass
      `,
        [
          { name: "empty_function", type: "function", boundaryType: "content" },
          { name: "EmptyClass", type: "class", boundaryType: "structural" },
        ],
      ],
    ];

    for (const [label, code, expected] of cases) {
      const found = boundariesOf(code).map(({ name, type, boundaryType }) => ({
        name,
        type,
        boundaryType,
      }));
      expect.soft(found, label).toEqual(expected);
    }
  });

  it("should extract import boundaries", () => {
    const code = `
import os
import sys
from typing import List, Dict
from collections import defaultdict
      `;

    const boundaries = boundariesOf(code);

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

  it("suppresses local helpers in functions and methods, but keeps the methods", () => {
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

    expect(boundariesOf(code).map((b) => b.name)).toEqual([
      "outer_function",
      "another_function",
      "MyClass",
      "method1",
      "method2",
    ]);
  });

  it("should include preceding comments in boundary", () => {
    const code = `
# This is a comment before the function
# Another comment line
def documented_function():
    """Function with both comments and docstring."""
    return "value"
      `;

    const boundaries = boundariesOf(code);

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

  it("includes docstrings within function, class and method boundaries", () => {
    const code = `def calculate_area(radius):
    """
    Calculate the area of a circle.
    
    Args:
        radius (float): The radius of the circle
        
    Returns:
        float: The area of the circle
    """
    pi = 3.14159
    return pi * radius * radius

class DataProcessor:
    """
    A class for processing various types of data.
    
    This class provides methods for cleaning, transforming,
    and analyzing data from different sources.
    """
    
    def __init__(self, config):
        """Initialize the processor with configuration."""
        self.config = config`;

    const boundaries = boundariesOf(code);
    const byName = new Map(boundaries.map((b) => [b.name, b]));
    const expectations: Array<[name: string, contains: string[]]> = [
      [
        "calculate_area",
        [
          "def calculate_area(radius):",
          "Calculate the area of a circle",
          "Args:",
          "Returns:",
          "pi = 3.14159",
          "return pi * radius * radius",
        ],
      ],
      [
        "DataProcessor",
        [
          "class DataProcessor:",
          "A class for processing various types of data",
          "This class provides methods",
        ],
      ],
      [
        "__init__",
        ["def __init__(self, config):", "Initialize the processor with configuration"],
      ],
    ];

    for (const [name, contains] of expectations) {
      const boundary = byName.get(name);
      expect.soft(boundary, `${name}: boundary`).toBeDefined();
      const text = boundary ? textOf(code, boundary) : "";
      for (const fragment of contains) {
        expect.soft(text, name).toContain(fragment);
      }
    }
  });

  it("extracts valid boundaries from the parsed part of a file larger than 32KB", () => {
    // Generate a Python file larger than 32,767 characters
    let largeCode = "# Large Python file test\n";
    let functionCount = 1;
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

    const result = parser.parse(largeCode);
    // Should flag errors due to truncation
    expect(result.hasErrors).toBe(true);

    // Boundaries from the beginning of the file are still found
    const boundaries = parser.extractBoundaries(result.tree, largeCode);
    const boundaryNames = boundaries.map((b) => b.name);
    expect(boundaryNames).toContain("test_function_1");
    expect(boundaryNames).toContain("TestClass1");

    // Every boundary points at a valid, non-empty part of the original content
    for (const boundary of boundaries) {
      expect(boundary.startLine).toBeGreaterThan(0);
      expect(boundary.endLine).toBeGreaterThanOrEqual(boundary.startLine);
      expect(boundary.startByte).toBeGreaterThanOrEqual(0);
      expect(boundary.endByte).toBeGreaterThan(boundary.startByte);
      expect(boundary.endByte).toBeLessThanOrEqual(largeCode.length);
    }
  });
});
