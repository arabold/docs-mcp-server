/**
 * Tests for JavaScriptParser - Basic functionality and node extraction
 */

import { beforeEach, describe, expect, it } from "vitest";
import { JavaScriptParser } from "./JavaScriptParser";

describe("JavaScriptParser", () => {
  let parser: JavaScriptParser;

  beforeEach(() => {
    parser = new JavaScriptParser();
  });

  describe("basic properties", () => {
    it("should have correct name", () => {
      expect(parser.name).toBe("javascript");
    });

    it("should have correct file extensions", () => {
      expect(parser.fileExtensions).toContain(".js");
      expect(parser.fileExtensions).toContain(".jsx");
      expect(parser.fileExtensions).toContain(".mjs");
      expect(parser.fileExtensions).toContain(".cjs");
    });

    it("should have correct MIME types", () => {
      expect(parser.mimeTypes).toContain("text/javascript");
      expect(parser.mimeTypes).toContain("application/javascript");
      expect(parser.mimeTypes).toContain("text/jsx");
      expect(parser.mimeTypes).toContain("application/jsx");
    });
  });

  describe("parsing", () => {
    it("should parse valid JavaScript code", () => {
      const code = `
        function hello() {
          return "world";
        }
      `;

      const result = parser.parse(code);
      expect(result.tree).toBeDefined();
      expect(result.hasErrors).toBe(false);
      expect(result.errorNodes).toHaveLength(0);
    });

    it("should handle syntax errors gracefully", () => {
      const code = `
        function hello( {
          return "world";
        }
      `;

      const result = parser.parse(code);
      expect(result.tree).toBeDefined();
      expect(result.hasErrors).toBe(true);
      expect(result.errorNodes.length).toBeGreaterThan(0);
    });
  });

  describe("structural node extraction", () => {
    it("should extract function declarations", () => {
      const code = `
        function hello() {
          return "world";
        }
        
        function goodbye(name) {
          return "bye " + name;
        }
      `;

      const result = parser.parse(code);
      const nodes = parser.extractStructuralNodes(result.tree);

      expect(nodes).toHaveLength(2);
      expect(nodes[0].name).toBe("hello");
      expect(nodes[0].type).toBe("function_declaration");
      expect(nodes[1].name).toBe("goodbye");
      expect(nodes[1].type).toBe("function_declaration");
    });

    it("should extract class declarations", () => {
      const code = `
        class MyComponent {
          constructor() {
            this.name = "test";
          }
          
          render() {
            return "hello";
          }
        }
      `;

      const result = parser.parse(code);
      const nodes = parser.extractStructuralNodes(result.tree);

      // Should extract the class and its methods
      expect(nodes).toHaveLength(3); // class + constructor + render method

      // Check class
      const classNode = nodes.find((n) => n.type === "class_declaration");
      expect(classNode).toBeDefined();
      expect(classNode?.name).toBe("MyComponent");

      // Check constructor
      const constructorNode = nodes.find(
        (n) => n.type === "method_definition" && n.name === "constructor",
      );
      expect(constructorNode).toBeDefined();

      // Check render method
      const renderNode = nodes.find(
        (n) => n.type === "method_definition" && n.name === "render",
      );
      expect(renderNode).toBeDefined();
    });

    it("should extract arrow functions assigned to variables", () => {
      const code = `
        const myFunction = () => {
          return "hello";
        };
        
        export const anotherFunc = (param) => param * 2;
      `;

      const result = parser.parse(code);
      const nodes = parser.extractStructuralNodes(result.tree);

      // Should extract arrow functions
      const arrowFunctions = nodes.filter((n) => n.type === "arrow_function");
      expect(arrowFunctions.length).toBeGreaterThan(0);
      expect(arrowFunctions[0].name).toBe("myFunction");
    });

    it("should handle JSX elements", () => {
      const code = `
        function MyComponent() {
          return <div>Hello World</div>;
        }
        
        const element = <span>Test</span>;
      `;

      const result = parser.parse(code);
      const nodes = parser.extractStructuralNodes(result.tree);

      const functionNode = nodes.find((n) => n.type === "function_declaration");
      expect(functionNode?.name).toBe("MyComponent");

      // JSX elements should be extracted as structural nodes
      const jsxNodes = nodes.filter((n) => n.type === "jsx_element");
      expect(jsxNodes.length).toBeGreaterThan(0);
    });
  });

  describe("node text extraction", () => {
    it("should extract correct text from nodes", () => {
      const code = `function test() { return 42; }`;
      const result = parser.parse(code);
      const functionNode = result.tree.rootNode.children.find(
        (child) => child.type === "function_declaration",
      );

      expect(functionNode).toBeDefined();
      if (functionNode) {
        const text = parser.getNodeText(functionNode, code);
        expect(text).toBe("function test() { return 42; }");
      }
    });

    it("should extract correct line ranges", () => {
      const code = `
function test() {
  return 42;
}`;
      const result = parser.parse(code);
      const functionNode = result.tree.rootNode.children.find(
        (child) => child.type === "function_declaration",
      );

      expect(functionNode).toBeDefined();
      if (functionNode) {
        const lines = parser.getNodeLines(functionNode, code);
        expect(lines.startLine).toBe(2); // 1-indexed
        expect(lines.endLine).toBe(4);
      }
    });
  });

  describe("boundary extraction", () => {
    it("should extract boundaries for functions and classes", () => {
      const code = `
function calculateSum(a, b) {
  return a + b;
}

class Calculator {
  multiply(x, y) {
    return x * y;
  }
}

const divide = (a, b) => {
  return a / b;
};
`;

      const result = parser.parse(code);
      expect(result.hasErrors).toBe(false);

      const boundaries = parser.extractBoundaries(result.tree, code);

      // Should find 4 boundaries: function, class, class method, arrow function
      expect(boundaries).toHaveLength(4);

      // Check function boundary
      const functionBoundary = boundaries.find((b) => b.name === "calculateSum");
      expect(functionBoundary).toBeDefined();
      expect(functionBoundary?.type).toBe("function");
      expect(functionBoundary?.startLine).toBe(2);
      expect(functionBoundary?.endLine).toBe(4);

      // Check class boundary
      const classBoundary = boundaries.find((b) => b.name === "Calculator");
      expect(classBoundary).toBeDefined();
      expect(classBoundary?.type).toBe("class");
      expect(classBoundary?.startLine).toBe(6);
      expect(classBoundary?.endLine).toBe(10);

      // Check class method boundary
      const methodBoundary = boundaries.find((b) => b.name === "multiply");
      expect(methodBoundary).toBeDefined();
      expect(methodBoundary?.type).toBe("function"); // Methods are classified as functions
      expect(methodBoundary?.startLine).toBe(7);
      expect(methodBoundary?.endLine).toBe(9);

      // Check arrow function boundary
      const arrowBoundary = boundaries.find((b) => b.name === "divide");
      expect(arrowBoundary).toBeDefined();
      expect(arrowBoundary?.type).toBe("function");
      expect(arrowBoundary?.startLine).toBe(12);
      expect(arrowBoundary?.endLine).toBe(14);
    });

    it("should handle empty code", () => {
      const result = parser.parse("");
      const boundaries = parser.extractBoundaries(result.tree, "");
      expect(boundaries).toHaveLength(0);
    });

    it("should handle code without semantic boundaries", () => {
      const code = `
// Just some comments and variables
const x = 5;
const y = 10;
console.log(x + y);
`;

      const result = parser.parse(code);
      const boundaries = parser.extractBoundaries(result.tree, code);

      // Might have variable declarations as boundaries, or none
      expect(Array.isArray(boundaries)).toBe(true);
    });
  });
});
