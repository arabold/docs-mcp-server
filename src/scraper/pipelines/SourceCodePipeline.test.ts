import { describe, expect, it } from "vitest";
import { loadConfig } from "../../utils/config";
import { FetchStatus } from "../fetcher/types";
import type { ScraperOptions } from "../types";
import { ScrapeMode } from "../types";
import { SourceCodePipeline } from "./SourceCodePipeline";

describe("SourceCodePipeline", () => {
  const appConfig = loadConfig();
  const pipeline = new SourceCodePipeline(appConfig);
  const baseOptions: ScraperOptions = {
    url: "http://example.com",
    library: "test-lib",
    version: "1.0.0",
    maxDepth: 1,
    maxPages: 10,
    scrapeMode: ScrapeMode.Auto,
  };

  it("should accept source code types of known languages only", () => {
    const cases: Array<[mimeType: string, expected: boolean]> = [
      ["text/javascript", true],
      ["application/javascript", true],
      ["text/x-typescript", true],
      ["text/x-tsx", true],
      ["text/x-jsx", true],
      ["text/plain", false],
      ["text/markdown", false],
      ["text/html", false],
      ["image/png", false],
      ["video/mp4", false],
      ["application/pdf", false],
      // An unknown language is rejected.
      ["text/x-unknown", false],
      ["", false],
    ];

    for (const [mimeType, expected] of cases) {
      expect.soft(pipeline.canProcess(mimeType), mimeType).toBe(expected);
    }
  });

  it("should split JavaScript into code chunks that carry the class in their path", async () => {
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

    const result = await pipeline.process(
      {
        content: Buffer.from(jsCode, "utf-8"),
        mimeType: "text/javascript",
        charset: "utf-8",
        source: "api-client.js",
        status: FetchStatus.SUCCESS,
      },
      baseOptions,
    );

    expect(result.textContent).toBe(jsCode);
    expect(result.links).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.chunks?.length).toBeGreaterThan(0);
    for (const chunk of result.chunks ?? []) {
      expect(chunk.types).toContain("code");
    }
    expect(result.chunks?.some((chunk) => chunk.section.path.includes("ApiClient"))).toBe(
      true,
    );
  });

  it("should split TypeScript into chunks that carry the class in their path", async () => {
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

    const result = await pipeline.process(
      {
        content: tsCode,
        mimeType: "text/x-typescript",
        source: "user-repository.ts",
        status: FetchStatus.SUCCESS,
      },
      baseOptions,
    );

    expect(result.textContent).toBe(tsCode);
    expect(result.chunks?.length).toBeGreaterThan(0);
    expect(
      result.chunks?.some((chunk) => chunk.section.path.includes("UserRepository")),
    ).toBe(true);
  });
});
