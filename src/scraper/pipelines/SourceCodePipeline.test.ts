import { beforeEach, describe, expect, it } from "vitest";
import { FetchStatus, type RawContent } from "../fetcher/types";
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
      expect(pipeline.canProcess("text/javascript")).toBe(true);
      expect(pipeline.canProcess("application/javascript")).toBe(true);
    });

    it("should accept TypeScript content types", () => {
      expect(pipeline.canProcess("text/x-typescript")).toBe(true);
      expect(pipeline.canProcess("text/x-tsx")).toBe(true);
    });

    it("should accept JSX content types", () => {
      expect(pipeline.canProcess("text/x-jsx")).toBe(true);
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
        expect(pipeline.canProcess(mimeType)).toBe(false);
      }
    });

    it("should reject content without mime type", () => {
      expect(pipeline.canProcess("")).toBe(false);
      expect(pipeline.canProcess(undefined as any)).toBe(false);
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
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(jsContent, baseOptions);

      expect(result.textContent).toBe(jsContent.content);
      // expect(result.metadata.language).toBe("javascript");
      // expect(result.metadata.isSourceCode).toBe(true);
      expect(result.links).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(result.chunks).toBeDefined();
      expect(Array.isArray(result.chunks)).toBe(true);
      expect(result.chunks?.length).toBeGreaterThan(0);

      // All chunks should be marked as code
      result.chunks?.forEach((chunk) => {
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
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(tsContent, baseOptions);

      expect(result.textContent).toBe(tsContent.content);
      // expect(result.metadata.language).toBe("typescript");
      // expect(result.metadata.isSourceCode).toBe(true);
      expect(result.chunks?.length).toBeGreaterThan(0);

      // Should have at least one chunk with method-level hierarchy
      const methodChunk = result.chunks?.find(
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
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(bufferContent, baseOptions);

      expect(result.textContent).toBe(codeString);
      // expect(result.metadata.language).toBe("javascript");
      // expect(result.metadata.isSourceCode).toBe(true);
    });

    it("should reject unknown programming language", async () => {
      // Unknown MIME type should be rejected by canProcess
      expect(pipeline.canProcess("text/x-unknown")).toBe(false);
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
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(tsContent, baseOptions);

      // expect(result.metadata.language).toBe("typescript");
      expect(result.chunks?.length).toBeGreaterThan(0);

      // Should preserve TypeScript structure
      const hasUserRepositoryContent = result.chunks?.some((chunk) =>
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
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(jsContent, baseOptions);

      // expect(result.metadata.language).toBe("javascript");
      expect(result.chunks?.length).toBeGreaterThan(0);

      // Should preserve JavaScript structure
      const hasApiClientContent = result.chunks?.some((chunk) =>
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
