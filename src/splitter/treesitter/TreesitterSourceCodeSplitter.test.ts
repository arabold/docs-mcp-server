/**
 * Tests for TreesitterSourceCodeSplitter - Main splitter functionality
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { SplitterConfig } from "../types";
import { TreesitterSourceCodeSplitter } from "./TreesitterSourceCodeSplitter";

const mockConfig: SplitterConfig = {
  minChunkSize: 100,
  preferredChunkSize: 500,
  maxChunkSize: 1000,
};

describe("TreesitterSourceCodeSplitter", () => {
  let splitter: TreesitterSourceCodeSplitter;

  beforeEach(() => {
    splitter = new TreesitterSourceCodeSplitter(mockConfig);
  });

  describe("text splitting", () => {
    it("returns no chunks for empty or whitespace-only content", async () => {
      const cases: Array<[label: string, content: string]> = [
        ["empty", ""],
        ["whitespace only", "   \n  \t  \n  "],
      ];

      for (const [label, content] of cases) {
        expect.soft(await splitter.splitText(content), label).toEqual([]);
      }
    });

    it("picks a tree-sitter parser by content type and falls back to size-based splitting", async () => {
      const javascript = 'function hello() {\n  return "world";\n}\n';
      const python = 'def hello():\n    return "world"\n';
      // A parsed file yields a chunk for the `hello` declaration; the fallback keeps the
      // whole file in one root-level chunk. Fallback rows use JavaScript, which the
      // TypeScript parser would split if the content type reached it.
      const parsed = [{ level: 1, path: ["hello"] }];
      const fallback = [{ level: 0, path: [] }];
      const cases: Array<
        [contentType: string | undefined, code: string, expected: typeof parsed]
      > = [
        ["text/javascript", javascript, parsed],
        ["application/javascript", javascript, parsed],
        ["text/jsx", javascript, parsed],
        ["application/jsx", javascript, parsed],
        ["text/x-jsx", javascript, parsed],
        ["text/x-typescript", javascript, parsed],
        ["text/x-tsx", javascript, parsed],
        // MIME lookups ignore case.
        ["TEXT/JAVASCRIPT", javascript, parsed],
        // Not registered, but named after the language.
        ["application/x-javascript", javascript, parsed],
        ["text/python", python, parsed],
        ["text/x-python", python, parsed],
        ["application/python", python, parsed],
        ["application/x-python", python, parsed],
        ["TEXT/PYTHON", python, parsed],
        // A content type ending in a file extension picks the parser by extension.
        ["foo.py", python, parsed],
        ["text/ruby", javascript, fallback],
        ["text/plain", javascript, fallback],
        [undefined, javascript, fallback],
      ];

      for (const [contentType, code, expected] of cases) {
        const chunks = await splitter.splitText(code, contentType);
        expect
          .soft(
            chunks.map((c) => ({ level: c.section.level, path: c.section.path })),
            String(contentType),
          )
          .toEqual(expected);
      }
    });

    it("should handle parse errors gracefully", async () => {
      const invalidCode = `
        function hello( {
          return "world";
        }
      `;

      const chunks = await splitter.splitText(invalidCode, "text/javascript");
      expect(chunks.length).toBeGreaterThan(0);
    });

    it("should create semantic chunks at function boundaries", async () => {
      const code = `
        // Utility functions
        
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

      const chunks = await splitter.splitText(code, "text/javascript");

      // Should create multiple chunks for semantic boundaries
      expect(chunks.length).toBeGreaterThanOrEqual(3);

      // Should have semantic hierarchical paths
      const pathStrings = chunks.map((chunk) => chunk.section.path.join(" > "));
      expect(pathStrings.some((path) => path.includes("calculateSum"))).toBe(true);
      expect(pathStrings.some((path) => path.includes("Calculator"))).toBe(true);
      expect(pathStrings.some((path) => path.includes("divide"))).toBe(true);

      // All chunks should be marked as code
      chunks.forEach((chunk) => {
        expect(chunk.types).toContain("code");
      });

      // Function chunks should contain complete function definitions
      const funcChunk = chunks.find((chunk) =>
        chunk.section.path.some((p) => p.includes("calculateSum")),
      );
      expect(funcChunk?.content).toContain("function calculateSum");
      expect(funcChunk?.content).toContain("return a + b");
    });
  });

  describe("hierarchical structure", () => {
    it("should create correct hierarchy levels", async () => {
      const code = `
        class UserService {
          constructor(apiKey) {
            this.apiKey = apiKey;
          }
          
          getUser(id) {
            return this.fetch(id);
          }
        }
        
        function globalFunction() {
          return "global";
        }
      `;

      const chunks = await splitter.splitText(code, "text/javascript");

      // Find specific chunks
      const classChunks = chunks.filter(
        (chunk) =>
          chunk.section.path.length === 1 && chunk.section.path[0] === "UserService",
      );
      const constructorChunk = chunks.find(
        (chunk) =>
          chunk.section.path.length === 2 &&
          chunk.section.path[0] === "UserService" &&
          chunk.section.path[1] === "constructor",
      );
      const methodChunk = chunks.find(
        (chunk) =>
          chunk.section.path.length === 2 &&
          chunk.section.path[0] === "UserService" &&
          chunk.section.path[1] === "getUser",
      );
      const globalFunctionChunk = chunks.find(
        (chunk) =>
          chunk.section.path.length === 1 && chunk.section.path[0] === "globalFunction",
      );

      // Verify hierarchy levels
      expect(classChunks.length).toBeGreaterThan(0);
      classChunks.forEach((chunk) => {
        expect(chunk.section.level).toBe(1); // Class is level 1
        expect(chunk.section.path).toEqual(["UserService"]);
      });
      // The class chunk holds the declaration; each method gets its own chunk.
      expect(classChunks[0].content).toContain("class UserService");

      expect(constructorChunk?.section.level).toBe(2); // Method is level 2
      expect(constructorChunk?.section.path).toEqual(["UserService", "constructor"]);

      expect(methodChunk?.section.level).toBe(2); // Method is level 2
      expect(methodChunk?.section.path).toEqual(["UserService", "getUser"]);
      expect(methodChunk?.content).toContain("getUser(id)");

      expect(globalFunctionChunk?.section.level).toBe(1); // Global function is level 1
      expect(globalFunctionChunk?.section.path).toEqual(["globalFunction"]);
    });

    it("should handle inline documentation with functions and methods", async () => {
      const code = `
        /**
         * Calculates the sum of two numbers
         * @param {number} a First number
         * @param {number} b Second number
         * @returns {number} Sum of a and b
         */
        function calculateSum(a, b) {
          return a + b;
        }
        
        class Calculator {
          /**
           * Multiplies two numbers
           * @param {number} x First factor
           * @param {number} y Second factor
           */
          multiply(x, y) {
            return x * y;
          }
        }
      `;

      const chunks = await splitter.splitText(code, "text/javascript");

      // Find function chunk with JSDoc
      const functionChunk = chunks.find((chunk) =>
        chunk.section.path.includes("calculateSum"),
      );
      expect(functionChunk).toBeDefined();
      expect(functionChunk!.content).toContain("/**");
      expect(functionChunk!.content).toContain("Calculates the sum");
      expect(functionChunk!.content).toContain("@param");
      expect(functionChunk!.content).toContain("function calculateSum");

      // Find method chunk with JSDoc
      const methodChunk = chunks.find(
        (chunk) =>
          chunk.section.path.length === 2 &&
          chunk.section.path[0] === "Calculator" &&
          chunk.section.path[1] === "multiply",
      );
      expect(methodChunk).toBeDefined();
      expect(methodChunk!.content).toContain("/**");
      expect(methodChunk!.content).toContain("Multiplies two numbers");
      expect(methodChunk!.content).toContain("multiply(x, y)");
    });

    it("should handle global code and variables", async () => {
      const code = `
        import { Logger } from './logger';
        import fs from 'fs';
        
        const API_KEY = process.env.API_KEY;
        let globalCounter = 0;
        
        class Service {
          process() {
            return "processed";
          }
        }
        
        function helper() {
          return "help";
        }
        
        // Global initialization code
        console.log("Application starting...");
        globalCounter++;
      `;

      const chunks = await splitter.splitText(code, "text/javascript");

      // Should have global code chunks (at root level)
      const globalChunks = chunks.filter(
        (chunk) => chunk.section.level === 0 && chunk.section.path.length === 0,
      );
      expect(globalChunks.length).toBeGreaterThan(0);

      // Check that imports are captured
      const hasImports = chunks.some(
        (chunk) =>
          chunk.content.includes("import { Logger }") ||
          chunk.content.includes("import fs"),
      );
      expect(hasImports).toBe(true);

      // Check that global variables are captured
      const hasGlobalVars = chunks.some(
        (chunk) =>
          chunk.content.includes("const API_KEY") ||
          chunk.content.includes("let globalCounter"),
      );
      expect(hasGlobalVars).toBe(true);

      // Check that global code at end is captured
      const hasGlobalCode = chunks.some(
        (chunk) =>
          chunk.section.level === 0 &&
          (chunk.content.includes("console.log") ||
            chunk.content.includes("globalCounter++")),
      );
      expect(hasGlobalCode).toBe(true);

      // Verify semantic boundaries still work
      const serviceChunk = chunks.find((chunk) => chunk.section.path.includes("Service"));
      expect(serviceChunk).toBeDefined();

      const helperChunk = chunks.find((chunk) => chunk.section.path.includes("helper"));
      expect(helperChunk).toBeDefined();
    });

    it("should enable perfect reconstruction of complex code", async () => {
      const complexCode = `import React from 'react';
import { useState, useEffect } from 'react';

const API_URL = process.env.REACT_APP_API_URL;

/**
 * User management service
 */
class UserService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.cache = new Map();
  }

  /**
   * Fetches user by ID
   */
  async getUser(id) {
    if (this.cache.has(id)) {
      return this.cache.get(id);
    }
    
    const user = await fetch(\`\${API_URL}/users/\${id}\`);
    this.cache.set(id, user);
    return user;
  }

  clearCache() {
    this.cache.clear();
  }
}

/**
 * Utility function for data processing
 */
function processUserData(data) {
  return data.map(user => ({
    id: user.id,
    name: user.fullName,
    active: user.status === 'active'
  }));
}

// Global service instance
const userService = new UserService(API_URL);

export default userService;
export { processUserData };`;

      const chunks = await splitter.splitText(complexCode, "text/javascript");

      // CRITICAL TEST: Perfect reconstruction
      const reconstructed = chunks.map((chunk) => chunk.content).join("");

      expect(reconstructed).toBe(complexCode);

      // Verify we have comprehensive coverage
      expect(chunks.length).toBeGreaterThan(5); // Should have multiple semantic chunks

      // Verify hierarchical structure is preserved
      const hasClassLevel1 = chunks.some(
        (chunk) =>
          chunk.section.level === 1 && chunk.section.path.includes("UserService"),
      );
      const hasMethodsLevel2 = chunks.some(
        (chunk) =>
          chunk.section.level === 2 &&
          chunk.section.path.length === 2 &&
          chunk.section.path[0] === "UserService",
      );
      const hasGlobalFunction = chunks.some(
        (chunk) =>
          chunk.section.level === 1 && chunk.section.path.includes("processUserData"),
      );
      const hasGlobalCode = chunks.some(
        (chunk) => chunk.section.level === 0 && chunk.section.path.length === 0,
      );

      expect(hasClassLevel1).toBe(true);
      expect(hasMethodsLevel2).toBe(true);
      expect(hasGlobalFunction).toBe(true);
      expect(hasGlobalCode).toBe(true);
    });

    it("should handle leading whitespace and newlines correctly", async () => {
      const codeWithLeadingWhitespace = `

  
  /** Leading whitespace and newlines above */
  class TestClass {
    method() {
      return "test";
    }
  }`;

      const chunks = await splitter.splitText(
        codeWithLeadingWhitespace,
        "text/javascript",
      );

      // Should not create a separate whitespace chunk at level 0
      const whitespaceOnlyChunks = chunks.filter(
        (chunk) =>
          chunk.section.level === 0 &&
          chunk.section.path.length === 0 &&
          chunk.content.trim() === "",
      );
      expect(whitespaceOnlyChunks).toHaveLength(0);

      // Class chunk should exist and be at proper level 1
      const classChunk = chunks.find((chunk) => chunk.section.path.includes("TestClass"));
      expect(classChunk).toBeDefined();
      expect(classChunk!.section.level).toBe(1);
      expect(classChunk!.section.path).toEqual(["TestClass"]);

      // Method chunk should exist and be at level 2
      const methodChunk = chunks.find(
        (chunk) =>
          chunk.section.path.length === 2 &&
          chunk.section.path[0] === "TestClass" &&
          chunk.section.path[1] === "method",
      );
      expect(methodChunk).toBeDefined();
      expect(methodChunk!.section.level).toBe(2);

      // Leading whitespace should be included in the first semantic chunk
      expect(classChunk!.content).toMatch(/^\s*\/\*\*/);

      // Minimum level should be 1 (not degraded to 0 by GreedySplitter)
      const minLevel = Math.min(...chunks.map((c) => c.section.level));
      expect(minLevel).toBe(1);
    });

    it("does not over-fragment method bodies into micro-chunks (TypeScript)", async () => {
      const tsCode = `
        export class DocumentRetrieverService {
          private documentStore: any;

          constructor(documentStore: any) {
            this.documentStore = documentStore;
          }

          private async getRelatedChunkIds(
            library: string,
            version: string,
            doc: any,
            siblingLimit = 2,
            childLimit = 5,
          ): Promise<{
            url: string;
            hitId: string;
            relatedIds: Set<string>;
            score: number;
          }> {
            const id = doc.id as string;
            for (let i = 0; i < 3; i++) {
              // loop body
              if (i === 2) {
                // inner branch
              }
            }
            return { url: "", hitId: id, relatedIds: new Set(), score: 1 };
          }

          async search(
            library: string,
            version: string | null | undefined,
            query: string,
            limit?: number,
          ): Promise<any[]> {
            return [];
          }
        }
      `;

      const tsSplitter = new TreesitterSourceCodeSplitter(mockConfig);
      const chunks = await tsSplitter.splitText(tsCode, "text/x-typescript");

      const methodChunks = chunks.filter(
        (c) => c.section.path.join("/") === "DocumentRetrieverService/getRelatedChunkIds",
      );
      expect(methodChunks.length).toBe(1);

      const nestedUnderMethod = chunks.filter(
        (c) =>
          c.section.path.length > 2 &&
          c.section.path[0] === "DocumentRetrieverService" &&
          c.section.path[1] === "getRelatedChunkIds",
      );
      expect(nestedUnderMethod.length).toBe(0);

      const classChunk2 = chunks.find(
        (c) =>
          c.section.path.length === 1 && c.section.path[0] === "DocumentRetrieverService",
      );
      expect(classChunk2).toBeDefined();
      const constructorChunk = chunks.find(
        (c) => c.section.path.join("/") === "DocumentRetrieverService/constructor",
      );
      expect(constructorChunk).toBeDefined();
      const searchChunks = chunks.filter(
        (c) => c.section.path.join("/") === "DocumentRetrieverService/search",
      );
      expect(searchChunks.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle Python code with proper hierarchical structure", async () => {
      const pythonCode = `import os
import sys
from typing import List, Dict

# Global configuration
DEBUG = True
CONFIG_FILE = "settings.json"

# Helper comment before function
def load_config(filename: str) -> Dict:
    """
    Load configuration from a JSON file.
    
    Args:
        filename: Path to the config file
        
    Returns:
        Configuration dictionary
    """
    with open(filename, 'r') as f:
        return json.load(f)

class DataProcessor:
    """A class for processing data with various methods."""
    
    def __init__(self, config_path: str):
        """Initialize the processor with configuration."""
        self.config = load_config(config_path)
        self.processed_count = 0
    
    def process_item(self, item: Dict) -> Dict:
        """Process a single data item."""
        def local_helper():
            # This should be suppressed
            return "helper"
        
        # Process the item
        result = {
            'id': item.get('id'),
            'processed': True,
            'timestamp': time.now()
        }
        self.processed_count += 1
        return result
    
    async def process_batch(self, items: List[Dict]) -> List[Dict]:
        """Process a batch of items asynchronously."""
        results = []
        for item in items:
            result = self.process_item(item)
            results.append(result)
        return results

# Global instance
processor = DataProcessor(CONFIG_FILE)`;

      const chunks = await splitter.splitText(pythonCode, "text/python");

      // CRITICAL: Perfect reconstruction test
      const reconstructed = chunks.map((chunk) => chunk.content).join("");
      expect(reconstructed).toBe(pythonCode);

      // Should have multiple chunks for different semantic boundaries
      expect(chunks.length).toBeGreaterThan(5);

      // Check import statements
      const importChunks = chunks.filter((c) =>
        c.section.path.some((p) => p.includes("import")),
      );
      expect(importChunks.length).toBeGreaterThan(0);

      // Check function boundary
      const loadConfigChunks = chunks.filter((c) =>
        c.section.path.includes("load_config"),
      );
      expect(loadConfigChunks.length).toBe(1);
      expect(loadConfigChunks[0].section.level).toBe(1);
      expect(loadConfigChunks[0].content).toContain("# Helper comment before function");
      expect(loadConfigChunks[0].content).toContain('"""');
      expect(loadConfigChunks[0].content).toContain(
        "Load configuration from a JSON file",
      );

      // Check class boundary
      const classChunks = chunks.filter((c) => c.section.path.includes("DataProcessor"));
      expect(classChunks.length).toBeGreaterThan(0);
      const mainClassChunk = classChunks.find((c) => c.section.path.length === 1);
      expect(mainClassChunk).toBeDefined();
      expect(mainClassChunk!.section.level).toBe(1);
      expect(mainClassChunk!.types).toContain("structural");

      // Check method boundaries
      const methodChunks = chunks.filter(
        (c) => c.section.path.length === 2 && c.section.path[0] === "DataProcessor",
      );
      expect(methodChunks.length).toBeGreaterThanOrEqual(3); // __init__, process_item, process_batch

      const initMethod = methodChunks.find((c) => c.section.path[1] === "__init__");
      expect(initMethod).toBeDefined();
      expect(initMethod!.section.level).toBe(2);
      expect(initMethod!.types).toContain("code");

      const processMethod = methodChunks.find(
        (c) => c.section.path[1] === "process_item",
      );
      expect(processMethod).toBeDefined();
      expect(processMethod!.section.level).toBe(2);
      // Should NOT have local_helper as separate chunk (suppressed)
      const localHelperChunks = chunks.filter((c) =>
        c.section.path.some((p) => p.includes("local_helper")),
      );
      expect(localHelperChunks.length).toBe(0);

      const asyncMethod = methodChunks.find((c) => c.section.path[1] === "process_batch");
      expect(asyncMethod).toBeDefined();
      expect(asyncMethod!.section.level).toBe(2);
      expect(asyncMethod!.content).toContain("async def process_batch");

      // Check global code chunks
      const globalChunks = chunks.filter(
        (c) => c.section.level === 0 && c.section.path.length === 0,
      );
      expect(globalChunks.length).toBeGreaterThan(0);

      // Verify we have both structural and content boundaries
      const structuralChunks = chunks.filter((c) => c.types.includes("structural"));
      const codeChunks = chunks.filter((c) => c.types.includes("code"));
      expect(structuralChunks.length).toBeGreaterThan(0); // imports + class
      expect(codeChunks.length).toBeGreaterThan(0); // functions + methods
    });
  });
});
