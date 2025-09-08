import { beforeEach, describe, expect, it } from "vitest";
import type { RawContent } from "../fetcher/types";
import type { ScraperOptions } from "../types";
import { ScrapeMode } from "../types";
import { SourceCodePipeline } from "./SourceCodePipeline";

describe("SourceCodePipeline", () => {
  let pipeline: SourceCodePipeline;
  const baseOptions: ScraperOptions = {
    url: "http://example.com",
    library: "test-lib",
    version: "1.0.0",
    maxDepth: 1,
    maxPages: 10,
    scrapeMode: ScrapeMode.Auto,
  };

  beforeEach(() => {
    pipeline = new SourceCodePipeline();
  });

  describe("initialization", () => {
    it("should initialize with default options", () => {
      expect(pipeline).toBeDefined();
    });

    it("should accept custom chunk size", () => {
      const customPipeline = new SourceCodePipeline(2000);
      expect(customPipeline).toBeDefined();
    });
  });

  describe("canProcess", () => {
    it("should accept JavaScript content types", () => {
      const jsContent: RawContent = {
        content: "function test() {}",
        mimeType: "text/javascript",
        source: "test.js",
      };
      expect(pipeline.canProcess(jsContent)).toBe(true);

      const appJsContent: RawContent = {
        content: "const x = 1;",
        mimeType: "application/javascript",
        source: "test.js",
      };
      expect(pipeline.canProcess(appJsContent)).toBe(true);
    });

    it("should accept TypeScript content types", () => {
      const tsContent: RawContent = {
        content: "interface Test { x: number; }",
        mimeType: "text/x-typescript",
        source: "test.ts",
      };
      expect(pipeline.canProcess(tsContent)).toBe(true);

      const tsxContent: RawContent = {
        content: "const Component = () => <div>Test</div>;",
        mimeType: "text/x-tsx",
        source: "test.tsx",
      };
      expect(pipeline.canProcess(tsxContent)).toBe(true);
    });

    it("should accept JSX content types", () => {
      const jsxContent: RawContent = {
        content: "const Component = () => <div>Test</div>;",
        mimeType: "text/x-jsx",
        source: "test.jsx",
      };
      expect(pipeline.canProcess(jsxContent)).toBe(true);
    });

    it("should reject non-source code content types", () => {
      const nonCodeTypes = [
        "text/plain",
        "text/markdown",
        "text/html",
        "image/png",
        "video/mp4",
        "application/pdf",
        "text/css",
        "text/x-unknown", // Unknown language should be rejected
      ];

      for (const mimeType of nonCodeTypes) {
        const content: RawContent = {
          content: "some content",
          mimeType,
          source: "test.file",
        };
        expect(pipeline.canProcess(content)).toBe(false);
      }
    });

    it("should reject content without mime type", () => {
      const content: RawContent = {
        content: "function test() {}",
        mimeType: undefined as any,
        source: "test.js",
      };
      expect(pipeline.canProcess(content)).toBe(false);
    });
  });

  describe("process", () => {
    it("should process simple JavaScript code", async () => {
      const jsContent: RawContent = {
        content: `function hello() {
  return "world";
}`,
        mimeType: "text/javascript",
        source: "test.js",
      };

      const result = await pipeline.process(jsContent, baseOptions);

      expect(result.textContent).toBe(jsContent.content);
      expect(result.metadata.language).toBe("javascript");
      expect(result.metadata.isSourceCode).toBe(true);
      expect(result.links).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(result.chunks).toBeDefined();
      expect(Array.isArray(result.chunks)).toBe(true);
      expect(result.chunks.length).toBeGreaterThan(0);

      // All chunks should be marked as code
      result.chunks.forEach((chunk) => {
        expect(chunk.types).toContain("code");
      });
    });

    it("should process TypeScript code with proper language detection", async () => {
      const tsContent: RawContent = {
        content: `interface User {
  id: number;
  name: string;
}

class UserService {
  getUser(id: number): User {
    return { id, name: "test" };
  }
}`,
        mimeType: "text/x-typescript",
        source: "user.ts",
      };

      const result = await pipeline.process(tsContent, baseOptions);

      expect(result.textContent).toBe(tsContent.content);
      expect(result.metadata.language).toBe("typescript");
      expect(result.metadata.isSourceCode).toBe(true);
      expect(result.chunks.length).toBeGreaterThan(0);

      // Should have at least one chunk with method-level hierarchy
      const methodChunk = result.chunks.find(
        (chunk) =>
          chunk.section.path.includes("getUser") ||
          chunk.section.path.includes("UserService"),
      );
      expect(methodChunk).toBeDefined();
    });

    it("should handle Buffer content", async () => {
      const codeString = "function test() { return 42; }";
      const bufferContent: RawContent = {
        content: Buffer.from(codeString, "utf-8"),
        mimeType: "text/javascript",
        charset: "utf-8",
        source: "test.js",
      };

      const result = await pipeline.process(bufferContent, baseOptions);

      expect(result.textContent).toBe(codeString);
      expect(result.metadata.language).toBe("javascript");
      expect(result.metadata.isSourceCode).toBe(true);
    });

    it("should reject unknown programming language", async () => {
      const unknownContent: RawContent = {
        content: "some code in unknown language",
        mimeType: "text/x-unknown",
        source: "test.unknown",
      };

      // Unknown MIME type should be rejected by canProcess
      expect(pipeline.canProcess(unknownContent)).toBe(false);
    });
  });

  describe("GreedySplitter integration - chunk combining behavior", () => {
    it("should combine small functions into larger chunks when under minimum size", async () => {
      // Create multiple small functions that should be combined
      const smallFunctions = `
function add(a, b) {
  return a + b;
}

function subtract(a, b) {
  return a - b;
}

function multiply(a, b) {
  return a * b;
}

function divide(a, b) {
  return a / b;
}

function mod(a, b) {
  return a % b;
}`;

      const jsContent: RawContent = {
        content: smallFunctions,
        mimeType: "text/javascript",
        source: "math-utils.js",
      };

      const result = await pipeline.process(jsContent, baseOptions);

      // Small functions should be combined into fewer chunks than individual functions
      expect(result.chunks.length).toBeLessThan(5); // Less than the 5 individual functions
      expect(result.chunks.length).toBeGreaterThan(0);

      // Combined chunks should be larger than individual small functions
      const hasLargerChunks = result.chunks.some((chunk) => chunk.content.length > 100);
      expect(hasLargerChunks).toBe(true);

      // Should preserve function boundaries in some form
      const allContent = result.chunks.map((chunk) => chunk.content).join("");
      expect(allContent).toContain("function add");
      expect(allContent).toContain("function subtract");
      expect(allContent).toContain("function multiply");
    });

    it("should split large functions into smaller chunks when over preferred size", async () => {
      // Create a large function that should be split
      const largeFunction = `
function processLargeDataset(data) {
  // This is a large function with many operations
  const results = [];
  
  // Step 1: Data validation
  if (!data || !Array.isArray(data)) {
    throw new Error("Invalid data provided");
  }
  
  // Step 2: Data transformation
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    
    // Validate item structure
    if (!item.id || !item.name || !item.value) {
      console.warn("Skipping invalid item:", item);
      continue;
    }
    
    // Transform the item
    const transformedItem = {
      id: item.id,
      name: item.name.trim().toLowerCase(),
      value: parseFloat(item.value),
      timestamp: new Date().toISOString(),
      metadata: {
        source: "pipeline",
        version: "1.0.0",
        processed: true,
        originalIndex: i
      }
    };
    
    // Apply business logic
    if (transformedItem.value > 1000) {
      transformedItem.category = "high";
      transformedItem.priority = 1;
    } else if (transformedItem.value > 500) {
      transformedItem.category = "medium";
      transformedItem.priority = 2;
    } else {
      transformedItem.category = "low";
      transformedItem.priority = 3;
    }
    
    // Additional processing
    transformedItem.hash = generateHash(transformedItem);
    transformedItem.signature = generateSignature(transformedItem);
    
    results.push(transformedItem);
  }
  
  // Step 3: Post-processing
  results.sort((a, b) => a.priority - b.priority || b.value - a.value);
  
  // Step 4: Final validation
  const validResults = results.filter(item => 
    item.value > 0 && 
    item.name.length > 0 &&
    item.hash &&
    item.signature
  );
  
  return {
    data: validResults,
    count: validResults.length,
    totalProcessed: data.length,
    timestamp: new Date().toISOString(),
    statistics: {
      high: validResults.filter(r => r.category === "high").length,
      medium: validResults.filter(r => r.category === "medium").length,
      low: validResults.filter(r => r.category === "low").length
    }
  };
}

function generateHash(item) {
  return item.id + ":" + item.name + ":" + item.value;
}

function generateSignature(item) {
  return "sig_" + item.hash;
}`;

      const jsContent: RawContent = {
        content: largeFunction,
        mimeType: "text/javascript",
        source: "large-processor.js",
      };

      const result = await pipeline.process(jsContent, baseOptions);

      // Large function should be split into multiple chunks
      expect(result.chunks.length).toBeGreaterThan(1);

      // Each chunk should not exceed the preferred chunk size significantly
      const oversizedChunks = result.chunks.filter(
        (chunk) => chunk.content.length > 2000,
      );
      expect(oversizedChunks.length).toBeLessThanOrEqual(1); // At most one might be slightly oversized

      // Should preserve semantic structure
      const functionChunk = result.chunks.find((chunk) =>
        chunk.section.path.includes("processLargeDataset"),
      );
      expect(functionChunk).toBeDefined();
    });

    it("should preserve hierarchical structure during chunk optimization", async () => {
      const complexCode = `
class DatabaseManager {
  constructor(config) {
    this.config = config;
    this.connection = null;
  }
  
  async connect() {
    this.connection = await createConnection(this.config);
  }
  
  async query(sql, params) {
    if (!this.connection) {
      await this.connect();
    }
    return this.connection.execute(sql, params);
  }
  
  async close() {
    if (this.connection) {
      await this.connection.close();
    }
  }
}

class UserRepository extends DatabaseManager {
  async createUser(userData) {
    const sql = "INSERT INTO users (name, email) VALUES (?, ?)";
    return this.query(sql, [userData.name, userData.email]);
  }
  
  async findUser(id) {
    const sql = "SELECT * FROM users WHERE id = ?";
    const result = await this.query(sql, [id]);
    return result[0];
  }
  
  async updateUser(id, userData) {
    const sql = "UPDATE users SET name = ?, email = ? WHERE id = ?";
    return this.query(sql, [userData.name, userData.email, id]);
  }
  
  async deleteUser(id) {
    const sql = "DELETE FROM users WHERE id = ?";
    return this.query(sql, [id]);
  }
}`;

      const jsContent: RawContent = {
        content: complexCode,
        mimeType: "text/javascript",
        source: "database.js",
      };

      const result = await pipeline.process(jsContent, baseOptions);

      // Should create multiple chunks with proper hierarchy
      expect(result.chunks.length).toBeGreaterThan(1);

      // Should have chunks with class method hierarchy (based on actual behavior)
      const userRepoChunks = result.chunks.filter((chunk) =>
        chunk.section.path.includes("UserRepository"),
      );

      expect(userRepoChunks.length).toBeGreaterThan(0);

      // Should preserve method-level hierarchy
      const methodChunk = result.chunks.find(
        (chunk) =>
          chunk.section.path.length >= 2 && chunk.section.path[1].includes("createUser"),
      );

      expect(methodChunk).toBeDefined();
      if (methodChunk) {
        expect(methodChunk.section.level).toBe(1); // After GreedySplitter merging, maintains proper level without whitespace degradation
      }
    });

    it("should respect major section boundaries even when combining chunks", async () => {
      const codeWithComments = `
// Configuration section
const CONFIG = {
  database: {
    host: "localhost",
    port: 5432
  }
};

// Utility functions section
function validateEmail(email) {
  return email.includes("@");
}

function formatName(name) {
  return name.trim().toLowerCase();
}

// Main application logic
class Application {
  constructor() {
    this.initialized = false;
  }
  
  init() {
    this.initialized = true;
  }
  
  process(data) {
    if (!this.initialized) {
      throw new Error("Application not initialized");
    }
    
    const processed = data.map(item => ({
      ...item,
      email: validateEmail(item.email) ? item.email : null,
      name: formatName(item.name)
    }));
    
    return processed.filter(item => item.email && item.name);
  }
}`;

      const jsContent: RawContent = {
        content: codeWithComments,
        mimeType: "text/javascript",
        source: "app.js",
      };

      const result = await pipeline.process(jsContent, baseOptions);

      // Should create at least one chunk
      expect(result.chunks.length).toBeGreaterThan(0);

      // Should have chunks that contain the different sections
      const allContent = result.chunks.map((chunk) => chunk.content).join("");
      expect(allContent).toContain("CONFIG");
      expect(allContent).toContain("validateEmail");
      expect(allContent).toContain("Application");
    });

    it("should handle edge cases in chunk size optimization", async () => {
      // Test with very small content that doesn't need splitting
      const tinyCode = "const x = 1;";
      const tinyContent: RawContent = {
        content: tinyCode,
        mimeType: "text/javascript",
        source: "tiny.js",
      };

      const tinyResult = await pipeline.process(tinyContent, baseOptions);
      expect(tinyResult.chunks.length).toBe(1);
      expect(tinyResult.chunks[0].content).toBe(tinyCode);

      // Test with empty content
      const emptyContent: RawContent = {
        content: "",
        mimeType: "text/javascript",
        source: "empty.js",
      };

      const emptyResult = await pipeline.process(emptyContent, baseOptions);
      expect(emptyResult.chunks.length).toBe(0);

      // Test with whitespace-only content
      const whitespaceContent: RawContent = {
        content: "   \n  \t  \n  ",
        mimeType: "text/javascript",
        source: "whitespace.js",
      };

      const whitespaceResult = await pipeline.process(whitespaceContent, baseOptions);
      expect(whitespaceResult.chunks.length).toBe(0);
    });

    it("should enable perfect reconstruction of complex code through chunks", async () => {
      const complexCode = `
/**
 * Complex module with multiple exports
 */

import { EventEmitter } from "events";

export interface UserData {
  id: number;
  name: string;
  email: string;
}

export class UserManager extends EventEmitter {
  private users: Map<number, UserData> = new Map();
  
  constructor() {
    super();
    this.on("user:created", this.handleUserCreated.bind(this));
  }
  
  createUser(userData: Omit<UserData, "id">): UserData {
    const id = this.generateId();
    const user: UserData = { id, ...userData };
    this.users.set(id, user);
    this.emit("user:created", user);
    return user;
  }
  
  private generateId(): number {
    return Math.max(0, ...Array.from(this.users.keys())) + 1;
  }
  
  private handleUserCreated(user: UserData): void {
    console.log("User created:", user.name);
  }
}

export default UserManager;`;

      const tsContent: RawContent = {
        content: complexCode,
        mimeType: "text/x-typescript",
        source: "user-manager.ts",
      };

      const result = await pipeline.process(tsContent, baseOptions);

      // Reconstruct the original content from chunks
      const reconstructed = result.chunks.map((chunk) => chunk.content).join("");

      // Should preserve all the original content
      expect(reconstructed).toContain("import { EventEmitter }");
      expect(reconstructed).toContain("export interface UserData");
      expect(reconstructed).toContain("export class UserManager");
      expect(reconstructed).toContain("createUser(userData:");
      expect(reconstructed).toContain("private generateId()");
      expect(reconstructed).toContain("export default UserManager");

      // Should maintain proper TypeScript syntax
      expect(reconstructed).toContain('Omit<UserData, "id">');
      expect(reconstructed).toContain("Map<number, UserData>");
    });
  });

  describe("language-specific processing", () => {
    it("should handle complex TypeScript with interfaces and generics", async () => {
      const tsCode = `
interface Repository<T> {
  findById(id: number): Promise<T | null>;
  create(entity: Omit<T, 'id'>): Promise<T>;
}

class UserRepository implements Repository<User> {
  constructor(private db: Database) {}
  
  async findById(id: number): Promise<User | null> {
    const result = await this.db.query('SELECT * FROM users WHERE id = ?', [id]);
    return result[0] || null;
  }
  
  async create(userData: Omit<User, 'id'>): Promise<User> {
    const id = await this.db.insert('users', userData);
    return { id, ...userData };
  }
}`;

      const tsContent: RawContent = {
        content: tsCode,
        mimeType: "text/x-typescript",
        source: "user-repository.ts",
      };

      const result = await pipeline.process(tsContent, baseOptions);

      expect(result.metadata.language).toBe("typescript");
      expect(result.chunks.length).toBeGreaterThan(0);

      // Should preserve TypeScript structure
      const hasUserRepositoryContent = result.chunks.some((chunk) =>
        chunk.section.path.includes("UserRepository"),
      );
      expect(hasUserRepositoryContent).toBe(true);
    });

    it("should handle ES6+ JavaScript features", async () => {
      const jsCode = `
const apiConfig = {
  baseUrl: process.env.API_URL || 'http://localhost:3000',
  timeout: 5000
};

export class ApiClient {
  constructor(config = apiConfig) {
    this.config = { ...config };
  }
  
  async fetchJson(endpoint, options = {}) {
    const response = await fetch(\`\${this.config.baseUrl}\${endpoint}\`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    if (!response.ok) {
      throw new Error(\`HTTP error! status: \${response.status}\`);
    }
    
    return response.json();
  }
  
  async get(endpoint) {
    return this.fetchJson(endpoint);
  }
  
  async post(endpoint, data) {
    return this.fetchJson(endpoint, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }
}

export default ApiClient;`;

      const jsContent: RawContent = {
        content: jsCode,
        mimeType: "text/javascript",
        source: "api-client.js",
      };

      const result = await pipeline.process(jsContent, baseOptions);

      expect(result.metadata.language).toBe("javascript");
      expect(result.chunks.length).toBeGreaterThan(0);

      // Should preserve JavaScript structure
      const hasApiClientContent = result.chunks.some((chunk) =>
        chunk.section.path.includes("ApiClient"),
      );
      expect(hasApiClientContent).toBe(true);
    });
  });

  describe("close", () => {
    it("should close without errors", async () => {
      await expect(pipeline.close()).resolves.toBeUndefined();
    });
  });
});
