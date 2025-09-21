/**
 * Tests for TreesitterSourceCodeSplitter - Main splitter functionality
 */

import { beforeEach, describe, expect, it } from "vitest";
import { TreesitterSourceCodeSplitter } from "./TreesitterSourceCodeSplitter";

describe("TreesitterSourceCodeSplitter", () => {
  let splitter: TreesitterSourceCodeSplitter;

  beforeEach(() => {
    splitter = new TreesitterSourceCodeSplitter();
  });

  describe("initialization", () => {
    it("should initialize with default options", () => {
      expect(splitter).toBeDefined();
    });

    it("should accept custom options", () => {
      const customSplitter = new TreesitterSourceCodeSplitter({
        maxChunkSize: 1000,
      });
      expect(customSplitter).toBeDefined();
    });
  });

  describe("supported content types", () => {
    it("should support JavaScript MIME types", () => {
      expect(splitter.isSupportedContentType("text/javascript")).toBe(true);
      expect(splitter.isSupportedContentType("application/javascript")).toBe(true);
    });

    it("should support JSX MIME types", () => {
      expect(splitter.isSupportedContentType("text/jsx")).toBe(true);
      expect(splitter.isSupportedContentType("application/jsx")).toBe(true);
    });

    it("should support Python MIME types", () => {
      expect(splitter.isSupportedContentType("text/python")).toBe(true);
      expect(splitter.isSupportedContentType("text/x-python")).toBe(true);
      expect(splitter.isSupportedContentType("application/python")).toBe(true);
      expect(splitter.isSupportedContentType("application/x-python")).toBe(true);
    });

    it("should not support unsupported types", () => {
      expect(splitter.isSupportedContentType("text/ruby")).toBe(false);
      expect(splitter.isSupportedContentType("text/plain")).toBe(false);
    });

    it("should handle content type patterns", () => {
      // Note: These test the pattern matching in getParserForContent
      // Currently only supports exact MIME types, not file extensions in content type
      expect(splitter.isSupportedContentType("text/javascript")).toBe(true);
      expect(splitter.isSupportedContentType("application/jsx")).toBe(true);
      expect(splitter.isSupportedContentType("text/python")).toBe(true);
    });
  });

  describe("text splitting", () => {
    it("should handle empty content", async () => {
      const chunks = await splitter.splitText("");
      expect(chunks).toHaveLength(0);
    });

    it("should handle whitespace-only content", async () => {
      const chunks = await splitter.splitText("   \n  \t  \n  ");
      expect(chunks).toHaveLength(0);
    });

    it("should split JavaScript code", async () => {
      const code = `
        function hello() {
          return "world";
        }
        
        const arrow = () => {
          console.log("arrow function");
        };
      `;

      const chunks = await splitter.splitText(code, "text/javascript");
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].types).toContain("code");
    });

    it("should split Python code", async () => {
      const pythonCode = `
def hello():
    return "world"

class Calculator:
    def add(self, a, b):
        return a + b
      `;

      const chunks = await splitter.splitText(pythonCode, "text/python");
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].types).toContain("code");

      // Should have semantic boundaries for function and class
      const pathStrings = chunks.map((chunk) => chunk.section.path.join(" > "));
      expect(pathStrings.some((path) => path.includes("hello"))).toBe(true);
      expect(pathStrings.some((path) => path.includes("Calculator"))).toBe(true);
    });

    it("should fall back to TextSplitter for unsupported content", async () => {
      const rubyCode = `
def hello
  return "world"
end
      `;

      const chunks = await splitter.splitText(rubyCode, "text/ruby");
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].types).toContain("code");
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

    it("should preserve hierarchical structure with class methods", async () => {
      const code = `
        class MathUtils {
          add(a, b) {
            return a + b;
          }

          subtract(a, b) {
            return a - b;
          }
        }
      `;

      const chunks = await splitter.splitText(code, "text/javascript");

      // Should create semantic chunks
      expect(chunks.length).toBeGreaterThan(0);

      // Should have class in the hierarchy
      const classChunk = chunks.find((chunk) =>
        chunk.section.path.some((p) => p.includes("MathUtils")),
      );
      expect(classChunk).toBeDefined();

      // With the new granular parser, we get separate chunks for class and methods
      // The class chunk should contain the class declaration (but not necessarily the full body)
      expect(classChunk?.content).toContain("class MathUtils");

      // Should have method chunks at level 2
      const methodChunks = chunks.filter(
        (chunk) =>
          chunk.section.path.length === 2 &&
          chunk.section.path[0] === "MathUtils" &&
          (chunk.section.path[1] === "add" || chunk.section.path[1] === "subtract"),
      );
      expect(methodChunks.length).toBeGreaterThan(0);

      // Each method should be in its own chunk
      const addMethod = methodChunks.find((chunk) => chunk.section.path[1] === "add");
      expect(addMethod).toBeDefined();
      expect(addMethod?.content).toContain("add(a, b)");
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

      expect(constructorChunk).toBeDefined();
      expect(constructorChunk!.section.level).toBe(2); // Method is level 2
      expect(constructorChunk!.section.path).toEqual(["UserService", "constructor"]);

      expect(methodChunk).toBeDefined();
      expect(methodChunk!.section.level).toBe(2); // Method is level 2
      expect(methodChunk!.section.path).toEqual(["UserService", "getUser"]);

      expect(globalFunctionChunk).toBeDefined();
      expect(globalFunctionChunk!.section.level).toBe(1); // Global function is level 1
      expect(globalFunctionChunk!.section.path).toEqual(["globalFunction"]);
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

      const tsSplitter = new TreesitterSourceCodeSplitter();
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

  describe("language support", () => {
    it("should return list of supported languages", () => {
      const languages = splitter.getSupportedLanguages();
      expect(languages).toContain("javascript");
      expect(Array.isArray(languages)).toBe(true);
    });

    it("should return list of supported extensions", () => {
      const extensions = splitter.getSupportedExtensions();
      expect(extensions).toContain(".js");
      expect(extensions).toContain(".jsx");
      expect(Array.isArray(extensions)).toBe(true);
    });

    it("should return list of supported MIME types", () => {
      const mimeTypes = splitter.getSupportedMimeTypes();
      expect(mimeTypes).toContain("text/javascript");
      expect(mimeTypes).toContain("application/javascript");
      expect(Array.isArray(mimeTypes)).toBe(true);
    });
  });
});
