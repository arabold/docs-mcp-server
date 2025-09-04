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
        maxLinesBeforeDelegation: 25,
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

    it("should not support unsupported types", () => {
      expect(splitter.isSupportedContentType("text/python")).toBe(false);
      expect(splitter.isSupportedContentType("text/plain")).toBe(false);
    });

    it("should handle content type patterns", () => {
      // Note: These test the pattern matching in getParserForContent
      // Currently only supports exact MIME types, not file extensions in content type
      expect(splitter.isSupportedContentType("text/javascript")).toBe(true);
      expect(splitter.isSupportedContentType("application/jsx")).toBe(true);
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

    it("should fall back to TextSplitter for unsupported content", async () => {
      const pythonCode = `
def hello():
    return "world"
      `;

      const chunks = await splitter.splitText(pythonCode, "text/python");
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
      expect(classChunk?.content).toContain("class MathUtils");
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

      // Should have global code chunks
      const globalChunks = chunks.filter((chunk) =>
        chunk.section.path.includes("global"),
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
          chunk.content.includes("console.log") ||
          chunk.content.includes("globalCounter++"),
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
      const hasGlobalCode = chunks.some((chunk) => chunk.section.path.includes("global"));

      expect(hasClassLevel1).toBe(true);
      expect(hasMethodsLevel2).toBe(true);
      expect(hasGlobalFunction).toBe(true);
      expect(hasGlobalCode).toBe(true);
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
