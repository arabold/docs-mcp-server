/**
 * Tests for SourceCodeDocumentSplitter
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SourceCodeDocumentSplitter } from "./SourceCodeDocumentSplitter";

vi.mock("../utils/logger");

describe("SourceCodeDocumentSplitter", () => {
  let splitter: SourceCodeDocumentSplitter;

  beforeEach(() => {
    splitter = new SourceCodeDocumentSplitter();
  });

  describe("basic functionality", () => {
    it("should handle empty content", async () => {
      const result = await splitter.splitText("", "text/typescript");
      expect(result).toEqual([]);
    });

    it("should handle whitespace-only content", async () => {
      const result = await splitter.splitText("   \n  \n  ", "text/typescript");
      expect(result).toEqual([]);
    });

    it("should fall back to TextSplitter for unsupported languages", async () => {
      const pythonCode = `
def hello_world():
    print("Hello, World!")
`;
      const result = await splitter.splitText(pythonCode, "text/python");
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].section.path).toContain("python-file");
    });
  });

  describe("simple class handling", () => {
    it("should split a simple class with one method", async () => {
      const code = `
class UserService {
  getUser(id: string) {
    return this.db.findById(id);
  }
}`;

      const result = await splitter.splitText(code, "text/typescript");

      expect(result.length).toBe(3); // opening, method, closing

      // Check opening chunk
      expect(result[0]).toEqual({
        types: ["code"],
        content: "class UserService {",
        section: {
          level: 2,
          path: ["typescript-file", "UserService"],
        },
      });

      // Check method chunk
      expect(result[1].content.trim()).toContain("getUser(id: string)");
      expect(result[1].section.path).toEqual([
        "typescript-file",
        "UserService",
        "getUser",
      ]);

      // Check closing chunk
      expect(result[2]).toEqual({
        types: ["code"],
        content: "}",
        section: {
          level: 2,
          path: ["typescript-file", "UserService"],
        },
      });
    });

    it("should handle exported classes", async () => {
      const code = `
export class ApiClient {
  constructor() {}
}`;

      const result = await splitter.splitText(code, "text/typescript");

      expect(result.length).toBe(3);
      expect(result[0].content).toBe("export class ApiClient {");
      expect(result[0].section.path).toEqual(["typescript-file", "ApiClient"]);
    });

    it("should handle abstract classes", async () => {
      const code = `
export abstract class BaseService {
  abstract process(): void;
}`;

      const result = await splitter.splitText(code, "text/typescript");

      expect(result.length).toBe(3);
      expect(result[0].content).toBe("export abstract class BaseService {");
      expect(result[0].section.path).toEqual(["typescript-file", "BaseService"]);
    });
  });

  describe("function handling", () => {
    it("should split standalone functions", async () => {
      const code = `
function calculateSum(a: number, b: number): number {
  return a + b;
}`;

      const result = await splitter.splitText(code, "text/typescript");

      expect(result.length).toBe(3);
      expect(result[0].content).toBe(
        "function calculateSum(a: number, b: number): number {",
      );
      expect(result[0].section.path).toEqual(["typescript-file", "calculateSum"]);
    });

    it("should handle exported functions", async () => {
      const code = `
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  return emailRegex.test(email);
}`;

      const result = await splitter.splitText(code, "text/typescript");

      expect(result.length).toBe(3);
      expect(result[0].content).toBe(
        "export function validateEmail(email: string): boolean {",
      );
      expect(result[0].section.path).toEqual(["typescript-file", "validateEmail"]);
    });

    it("should handle async functions", async () => {
      const code = `
export async function fetchUserData(id: string): Promise<User> {
  const response = await fetch(\`/api/users/\${id}\`);
  return response.json();
}`;

      const result = await splitter.splitText(code, "text/typescript");

      expect(result.length).toBe(3);
      expect(result[0].content).toBe(
        "export async function fetchUserData(id: string): Promise<User> {",
      );
      expect(result[0].section.path).toEqual(["typescript-file", "fetchUserData"]);
    });
  });

  describe("namespace handling", () => {
    it("should split namespaces", async () => {
      const code = `
namespace Utils {
  export function formatDate(date: Date): string {
    return date.toISOString();
  }
}`;

      const result = await splitter.splitText(code, "text/typescript");

      expect(result.length).toBe(3);
      expect(result[0].content).toBe("namespace Utils {");
      expect(result[0].section.path).toEqual(["typescript-file", "Utils"]);
    });

    it("should handle exported namespaces", async () => {
      const code = `
export namespace ApiTypes {
  export interface User {
    id: string;
    name: string;
  }
}`;

      const result = await splitter.splitText(code, "text/typescript");

      expect(result.length).toBe(3);
      expect(result[0].content).toBe("export namespace ApiTypes {");
      expect(result[0].section.path).toEqual(["typescript-file", "ApiTypes"]);
    });
  });

  describe("interface and type handling", () => {
    it("should split interfaces", async () => {
      const code = `
interface User {
  id: string;
  name: string;
  email: string;
}`;

      const result = await splitter.splitText(code, "text/typescript");

      expect(result.length).toBe(3);
      expect(result[0].content).toBe("interface User {");
      expect(result[0].section.path).toEqual(["typescript-file", "User"]);
    });

    it("should split type definitions", async () => {
      const code = `
export type Status = {
  code: number;
  message: string;
}`;

      const result = await splitter.splitText(code, "text/typescript");

      expect(result.length).toBe(3);
      expect(result[0].content).toBe("export type Status = {");
      expect(result[0].section.path).toEqual(["typescript-file", "Status"]);
    });
  });

  describe("mixed content handling", () => {
    it("should handle file with imports, class, and loose functions", async () => {
      const code = `
import { Database } from './database';
import { Logger } from './logger';

const logger = new Logger();

export class UserService {
  constructor(private db: Database) {}
  
  async getUser(id: string) {
    logger.info('Getting user', id);
    return this.db.findById(id);
  }
}

export function createUserService(): UserService {
  return new UserService(new Database());
}`;

      const result = await splitter.splitText(code, "text/typescript");

      // Should have content section for imports/constants, then class, then function
      expect(result.length).toBeGreaterThan(5);

      // Find the class chunks
      const classOpeningChunk = result.find(
        (chunk) =>
          chunk.section.path.includes("UserService") &&
          chunk.content.includes("export class UserService"),
      );
      expect(classOpeningChunk).toBeDefined();
      expect(classOpeningChunk?.content).toBe("export class UserService {");

      // Find the function chunks
      const functionOpeningChunk = result.find(
        (chunk) =>
          chunk.section.path.includes("createUserService") &&
          chunk.content.includes("export function createUserService"),
      );
      expect(functionOpeningChunk).toBeDefined();
      expect(functionOpeningChunk?.content).toBe(
        "export function createUserService(): UserService {",
      );
    });

    it("should handle complex nested class with multiple methods", async () => {
      const code = `
export class ApiClient {
  private baseUrl: string;
  
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }
  
  async get(endpoint: string): Promise<any> {
    const response = await fetch(\`\${this.baseUrl}\${endpoint}\`);
    if (!response.ok) {
      throw new Error('Request failed');
    }
    return response.json();
  }
  
  async post(endpoint: string, data: any): Promise<any> {
    const response = await fetch(\`\${this.baseUrl}\${endpoint}\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return response.json();
  }
}`;

      const result = await splitter.splitText(code, "text/typescript");

      expect(result.length).toBe(6); // opening, constructor, get, post, properties, closing

      const openingChunk = result[0];
      expect(openingChunk.content).toBe("export class ApiClient {");
      expect(openingChunk.section.path).toEqual(["typescript-file", "ApiClient"]);

      // Find constructor chunk
      const constructorChunk = result.find((chunk) =>
        chunk.section.path.includes("constructor"),
      );
      expect(constructorChunk).toBeDefined();
      expect(constructorChunk!.content).toContain("constructor(baseUrl: string)");

      // Find method chunks
      const getChunk = result.find((chunk) => chunk.section.path.includes("get"));
      expect(getChunk).toBeDefined();
      expect(getChunk!.content).toContain("async get(endpoint: string)");

      const postChunk = result.find((chunk) => chunk.section.path.includes("post"));
      expect(postChunk).toBeDefined();
      expect(postChunk!.content).toContain("async post(endpoint: string, data: any)");

      const closingChunk = result[result.length - 1];
      expect(closingChunk.content).toBe("}");
      expect(closingChunk.section.path).toEqual(["typescript-file", "ApiClient"]);
    });
  });

  describe("JavaScript support", () => {
    it("should handle JavaScript classes", async () => {
      const code = `
class Calculator {
  add(a, b) {
    return a + b;
  }
  
  subtract(a, b) {
    return a - b;
  }
}`;

      const result = await splitter.splitText(code, "text/javascript");

      expect(result.length).toBe(4); // opening, add method, subtract method, closing
      expect(result[0].content).toBe("class Calculator {");
      expect(result[0].section.path).toEqual(["javascript-file", "Calculator"]);

      // Find method chunks
      const addChunk = result.find((chunk) => chunk.section.path.includes("add"));
      expect(addChunk).toBeDefined();
      expect(addChunk!.content).toContain("add(a, b)");

      const subtractChunk = result.find((chunk) =>
        chunk.section.path.includes("subtract"),
      );
      expect(subtractChunk).toBeDefined();
      expect(subtractChunk!.content).toContain("subtract(a, b)");

      const closingChunk = result[result.length - 1];
      expect(closingChunk.content).toBe("}");
    });

    it("should handle JavaScript functions", async () => {
      const code = `
function greet(name) {
  console.log('Hello, ' + name + '!');
}`;

      const result = await splitter.splitText(code, "text/javascript");

      expect(result.length).toBe(3);
      expect(result[0].content).toBe("function greet(name) {");
      expect(result[0].section.path).toEqual(["javascript-file", "greet"]);
    });
  });

  describe("edge cases and error handling", () => {
    it("should handle malformed code gracefully", async () => {
      const malformedCode = `
class BrokenClass {
  method() {
    // Missing closing brace
`;

      const result = await splitter.splitText(malformedCode, "text/typescript");

      // Should fall back to TextDocumentSplitter
      expect(result.length).toBeGreaterThan(0);
      // Should still be able to process content
      expect(result[0].content).toContain("class BrokenClass");
    });

    it("should handle code with string literals containing braces", async () => {
      const code = `
class StringHandler {
  process() {
    const template = "Hello {name}! Welcome to {place}.";
    const json = '{"key": "value", "nested": {"inner": true}}';
    return template + json;
  }
}`;

      const result = await splitter.splitText(code, "text/typescript");

      expect(result.length).toBe(3);
      expect(result[0].content).toBe("class StringHandler {");
      expect(result[1].content).toContain(
        'const template = "Hello {name}! Welcome to {place}."',
      );
      expect(result[1].content).toContain(
        '\'{"key": "value", "nested": {"inner": true}}\'',
      );
    });

    it("should handle code with comments containing braces", async () => {
      const code = `
class CommentHandler {
  // This method handles objects like { key: value }
  process() {
    /* 
     * Another comment with braces: { example: true }
     */
    return true;
  }
}`;

      const result = await splitter.splitText(code, "text/typescript");

      expect(result.length).toBe(4); // opening, process method, properties (line comment), closing

      // Find method chunk
      const processChunk = result.find((chunk) => chunk.section.path.includes("process"));
      expect(processChunk).toBeDefined();
      expect(processChunk!.content).toContain(
        "Another comment with braces: { example: true }",
      );

      // Find properties chunk (line comment)
      const propertiesChunk = result.find((chunk) =>
        chunk.section.path.includes("properties"),
      );
      expect(propertiesChunk).toBeDefined();
      expect(propertiesChunk!.content).toContain(
        "This method handles objects like { key: value }",
      );
    });

    it("should preserve indentation and formatting", async () => {
      const code = `
  class IndentedClass {
    method() {
      if (true) {
        console.log('nested code');
      }
    }
  }`;

      const result = await splitter.splitText(code, "text/typescript");

      expect(result.length).toBe(3); // opening, method, closing
      expect(result[0].content).toBe("  class IndentedClass {");

      // Find method chunk
      const methodChunk = result.find((chunk) => chunk.section.path.includes("method"));
      expect(methodChunk).toBeDefined();
      expect(methodChunk!.content).toContain("method() {");
      expect(methodChunk!.content).toContain("if (true) {");
      expect(methodChunk!.content).toContain("console.log('nested code');");

      expect(result[2].content).toBe("  }");
    });
  });

  describe("concatenability", () => {
    it("should produce chunks that can be concatenated to recreate original code", async () => {
      const originalCode = `
export class TestClass {
  private value: number = 0;
  
  getValue(): number {
    return this.value;
  }
  
  setValue(newValue: number): void {
    this.value = newValue;
  }
}`;

      const result = await splitter.splitText(originalCode, "text/typescript");

      expect(result.length).toBe(5); // opening, getValue, setValue, properties, closing

      // Concatenate all chunks
      const reconstructed = result.map((chunk) => chunk.content).join("\n");

      // Verify all expected content is present (order may differ)
      expect(reconstructed).toContain("export class TestClass");
      expect(reconstructed).toContain("private value: number = 0");
      expect(reconstructed).toContain("getValue(): number");
      expect(reconstructed).toContain("setValue(newValue: number): void");
      expect(reconstructed).toContain("return this.value");
      expect(reconstructed).toContain("this.value = newValue");
    });
  });
});
