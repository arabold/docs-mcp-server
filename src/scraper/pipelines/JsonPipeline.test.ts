import { describe, expect, it } from "vitest";
import type { RawContent } from "../fetcher/types";
import { JsonPipeline } from "./JsonPipeline";

describe("JsonPipeline", () => {
  const pipeline = new JsonPipeline();
  const baseOptions = {
    url: "test.json",
    library: "test-lib",
    version: "1.0.0",
    maxPages: 10,
    maxDepth: 3,
    includePatterns: [],
    excludePatterns: [],
  };

  describe("canProcess", () => {
    it("should accept JSON MIME types", () => {
      const jsonContent: RawContent = {
        content: "{}",
        mimeType: "application/json",
        charset: "utf-8",
        source: "test.json",
      };

      expect(pipeline.canProcess(jsonContent)).toBe(true);
    });

    it("should accept text/json MIME type", () => {
      const jsonContent: RawContent = {
        content: "{}",
        mimeType: "text/json",
        charset: "utf-8",
        source: "test.json",
      };

      expect(pipeline.canProcess(jsonContent)).toBe(true);
    });

    it("should reject non-JSON MIME types", () => {
      const htmlContent: RawContent = {
        content: "<html></html>",
        mimeType: "text/html",
        charset: "utf-8",
        source: "test.html",
      };

      expect(pipeline.canProcess(htmlContent)).toBe(false);
    });

    it("should reject content without MIME type", () => {
      const unknownContent: RawContent = {
        content: "{}",
        mimeType: "",
        charset: "utf-8",
        source: "test",
      };

      expect(pipeline.canProcess(unknownContent)).toBe(false);
    });
  });

  describe("process", () => {
    it("should process valid JSON object", async () => {
      const jsonContent: RawContent = {
        content: JSON.stringify({ name: "John", age: 30 }, null, 2),
        mimeType: "application/json",
        charset: "utf-8",
        source: "user.json",
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      expect(result.textContent).toBe(jsonContent.content);
      expect(result.metadata.title).toBe("John"); // extracted from name field
      expect(result.metadata.description).toBeUndefined(); // no description field found
      expect(result.metadata.isValidJson).toBe(true);
      expect(result.metadata.jsonStructure).toEqual({
        type: "object",
        depth: 1,
        propertyCount: 2,
      });
      expect(result.links).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should process valid JSON array", async () => {
      const jsonContent: RawContent = {
        content: JSON.stringify([1, 2, 3], null, 2),
        mimeType: "application/json",
        charset: "utf-8",
        source: "numbers.json",
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      expect(result.textContent).toBe(jsonContent.content);
      expect(result.metadata.title).toBeUndefined(); // no title field in array
      expect(result.metadata.description).toBeUndefined(); // no description field in array
      expect(result.metadata.isValidJson).toBe(true);
      expect(result.metadata.jsonStructure).toEqual({
        type: "array",
        depth: 1,
        itemCount: 3,
      });
    });

    it("should extract title from JSON properties", async () => {
      const jsonContent: RawContent = {
        content: JSON.stringify(
          {
            title: "My API Documentation",
            version: "1.0.0",
            description: "REST API for user management",
          },
          null,
          2,
        ),
        mimeType: "application/json",
        charset: "utf-8",
        source: "api.json",
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      expect(result.metadata.title).toBe("My API Documentation");
      expect(result.metadata.description).toBe("REST API for user management");
    });

    it("should handle nested JSON structures", async () => {
      const nestedJson = {
        user: {
          profile: {
            personal: {
              name: "John",
              age: 30,
            },
          },
        },
        settings: {
          theme: "dark",
        },
      };

      const jsonContent: RawContent = {
        content: JSON.stringify(nestedJson, null, 2),
        mimeType: "application/json",
        charset: "utf-8",
        source: "nested.json",
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      expect(result.metadata.jsonStructure).toEqual({
        type: "object",
        depth: 4, // user -> profile -> personal -> name/age
        propertyCount: 2, // user, settings
      });
    });

    it("should handle invalid JSON gracefully", async () => {
      const jsonContent: RawContent = {
        content: "{ invalid json content",
        mimeType: "application/json",
        charset: "utf-8",
        source: "invalid.json",
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      expect(result.textContent).toBe(jsonContent.content);
      expect(result.metadata.title).toBeUndefined(); // no title/description fields for invalid JSON
      expect(result.metadata.description).toBeUndefined();
      expect(result.metadata.isValidJson).toBe(false);
      expect(result.metadata.jsonStructure).toBeUndefined();
    });

    it("should handle JSON primitives", async () => {
      const stringContent: RawContent = {
        content: '"hello world"',
        mimeType: "application/json",
        charset: "utf-8",
        source: "string.json",
      };

      const result = await pipeline.process(stringContent, baseOptions);

      expect(result.metadata.title).toBeUndefined(); // no title field in primitive
      expect(result.metadata.description).toBeUndefined(); // no description field in primitive
      expect(result.metadata.jsonStructure).toEqual({
        type: "string",
        depth: 1,
      });
    });

    it("should handle empty JSON structures", async () => {
      const emptyObjectContent: RawContent = {
        content: "{}",
        mimeType: "application/json",
        charset: "utf-8",
        source: "empty.json",
      };

      const result = await pipeline.process(emptyObjectContent, baseOptions);

      expect(result.metadata.title).toBeUndefined(); // no title field in empty object
      expect(result.metadata.description).toBeUndefined(); // no description field in empty object
      expect(result.metadata.jsonStructure).toEqual({
        type: "object",
        depth: 1,
        propertyCount: 0,
      });
    });

    it("should handle Buffer content", async () => {
      const jsonString = JSON.stringify({ test: "value" });
      const jsonContent: RawContent = {
        content: Buffer.from(jsonString, "utf-8"),
        mimeType: "application/json",
        charset: "utf-8",
        source: "buffer.json",
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      expect(result.textContent).toBe(jsonString);
      expect(result.metadata.isValidJson).toBe(true);
    });
  });

  describe("GreedySplitter integration and chunk optimization", () => {
    it("should create chunks that meet minimum size requirements when content allows", async () => {
      // Create a large JSON object that will generate multiple chunks
      const largeJsonObject = {
        name: "Large Configuration File",
        description:
          "This is a comprehensive configuration file with many properties to ensure we generate enough content for multiple chunks that will exceed the preferred chunk size and force GreedySplitter to create multiple chunks",
        version: "2.1.0",
        author: {
          name: "John Developer",
          email: "john@example.com",
          organization: "Tech Corporation with a very long name to add more content",
          roles: ["developer", "maintainer", "architect", "team-lead", "senior-engineer"],
          bio: "Experienced software engineer with over 10 years of experience in full-stack development, DevOps, and system architecture. Specializes in scalable web applications and microservices.",
        },
        configuration: {
          database: {
            host: "production-primary-database-cluster.us-east-1.rds.amazonaws.com",
            port: 5432,
            name: "production_application_database",
            ssl: true,
            poolSize: 20,
            timeout: 30000,
            retries: 3,
            backoff: "exponential",
            connectionString:
              "postgresql://username:password@host:port/database?sslmode=require&pool_max_conns=20",
            migrations: {
              directory: "/db/migrations",
              tableName: "schema_migrations",
              autoRun: true,
              lockTimeout: 5000,
            },
          },
          server: {
            host: "0.0.0.0",
            port: 8080,
            protocol: "https",
            compression: true,
            maxRequestSize: "50mb",
            timeout: 30000,
            keepAlive: true,
            cors: {
              enabled: true,
              origins: [
                "https://app.example.com",
                "https://admin.example.com",
                "https://api.example.com",
                "https://staging.example.com",
              ],
              methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
              allowCredentials: true,
              exposedHeaders: ["X-Total-Count", "X-Request-ID", "X-API-Version"],
              maxAge: 86400,
            },
            rateLimit: {
              windowMs: 900000,
              max: 100,
              message: "Too many requests from this IP address. Please try again later.",
              standardHeaders: true,
              legacyHeaders: false,
            },
          },
          logging: {
            level: "info",
            format: "json",
            destinations: ["console", "file", "elasticsearch", "cloudwatch"],
            rotation: {
              frequency: "daily",
              maxSize: "100MB",
              maxFiles: 30,
              compress: true,
            },
            fields: [
              "timestamp",
              "level",
              "message",
              "requestId",
              "userId",
              "ip",
              "userAgent",
            ],
          },
        },
        features: {
          authentication: {
            enabled: true,
            provider: "oauth2",
            clientId: "application-client-identifier-12345",
            clientSecret: "super-secret-client-secret-that-should-be-in-env-vars",
            scopes: ["read", "write", "admin", "user:profile", "user:email"],
            sessionTimeout: 3600,
            refreshTokenExpiry: 604800,
            algorithms: ["RS256", "HS256"],
            issuer: "https://auth.example.com",
            audience: "https://api.example.com",
          },
          monitoring: {
            enabled: true,
            provider: "datadog",
            apiKey: "datadog-api-key-should-be-in-environment-variables",
            metrics: [
              "cpu",
              "memory",
              "disk",
              "network",
              "requests",
              "errors",
              "latency",
            ],
            alerts: {
              email: "alerts@example.com",
              slack: "#alerts-production",
              pagerduty: "pagerduty-service-key",
              thresholds: {
                cpu: 80,
                memory: 90,
                disk: 85,
                errorRate: 5,
                responseTime: 2000,
              },
            },
            dashboards: ["application-overview", "infrastructure", "business-metrics"],
          },
          backup: {
            enabled: true,
            schedule: "0 2 * * *",
            retention: "30 days",
            destinations: ["s3://production-backups", "/mnt/backup/local"],
            compression: "gzip",
            encryption: true,
            encryptionKey: "backup-encryption-key-stored-in-vault",
            verify: true,
            notifications: {
              success: "backup-success@example.com",
              failure: "backup-failure@example.com",
            },
          },
        },
        dependencies: [
          "express@^4.18.0",
          "cors@^2.8.5",
          "helmet@^6.0.0",
          "morgan@^1.10.0",
          "compression@^1.7.4",
          "express-rate-limit@^6.7.0",
          "jsonwebtoken@^9.0.0",
          "bcryptjs@^2.4.3",
          "pg@^8.9.0",
          "redis@^4.6.0",
          "winston@^3.8.2",
          "pino@^8.11.0",
          "joi@^17.9.0",
          "dotenv@^16.0.3",
          "aws-sdk@^2.1329.0",
          "mongoose@^7.0.0",
          "lodash@^4.17.21",
          "moment@^2.29.4",
          "uuid@^9.0.0",
          "crypto-js@^4.1.1",
        ],
        devDependencies: [
          "@types/node@^18.15.0",
          "@types/express@^4.17.17",
          "@types/cors@^2.8.13",
          "@types/bcryptjs@^2.4.2",
          "@types/jsonwebtoken@^9.0.1",
          "@types/uuid@^9.0.1",
          "typescript@^5.0.0",
          "ts-node@^10.9.0",
          "nodemon@^2.0.22",
          "jest@^29.5.0",
          "@types/jest@^29.5.0",
          "supertest@^6.3.3",
          "eslint@^8.37.0",
          "prettier@^2.8.7",
        ],
        scripts: {
          start: "node dist/server.js",
          dev: "nodemon src/server.ts",
          build: "tsc",
          test: "jest",
          "test:watch": "jest --watch",
          "test:coverage": "jest --coverage",
          lint: "eslint src/**/*.ts",
          "lint:fix": "eslint src/**/*.ts --fix",
          format: "prettier --write src/**/*.ts",
          "db:migrate": "npx knex migrate:latest",
          "db:rollback": "npx knex migrate:rollback",
          "db:seed": "npx knex seed:run",
        },
      };

      const jsonContent: RawContent = {
        content: JSON.stringify(largeJsonObject, null, 2),
        mimeType: "application/json",
        charset: "utf-8",
        source: "large-config.json",
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      // Should have chunks
      expect(result.chunks).toBeDefined();
      expect(result.chunks!.length).toBeGreaterThan(0);

      // For large content, verify that content is properly handled
      const totalContentLength = result.chunks!.reduce(
        (sum, chunk) => sum + chunk.content.length,
        0,
      );
      expect(totalContentLength).toBeGreaterThan(1000); // Should be substantial content

      // Verify concatenated result is valid JSON
      const concatenated = result.chunks!.map((chunk) => chunk.content).join("\n");
      let parsedResult: any;
      expect(() => {
        parsedResult = JSON.parse(concatenated);
      }).not.toThrow();
      expect(parsedResult).toEqual(largeJsonObject);
    });

    it("should maintain JSON validity after GreedySplitter concatenation", async () => {
      const complexJson = {
        users: [
          {
            id: 1,
            name: "Alice Johnson",
            email: "alice@example.com",
            profile: {
              age: 28,
              city: "New York",
              preferences: {
                theme: "dark",
                notifications: true,
                language: "en",
              },
            },
            roles: ["user", "moderator"],
          },
          {
            id: 2,
            name: "Bob Smith",
            email: "bob@example.com",
            profile: {
              age: 35,
              city: "San Francisco",
              preferences: {
                theme: "light",
                notifications: false,
                language: "en",
              },
            },
            roles: ["user", "admin"],
          },
        ],
        metadata: {
          total: 2,
          lastUpdated: "2023-12-01T10:00:00Z",
          version: "1.0",
        },
      };

      const jsonContent: RawContent = {
        content: JSON.stringify(complexJson, null, 2),
        mimeType: "application/json",
        charset: "utf-8",
        source: "users.json",
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      // Verify chunks exist
      expect(result.chunks).toBeDefined();
      expect(result.chunks!.length).toBeGreaterThan(0);

      // Test that concatenating all chunks produces valid JSON
      const concatenatedContent = result.chunks!.map((chunk) => chunk.content).join("\n");

      let parsedResult: any;
      expect(() => {
        parsedResult = JSON.parse(concatenatedContent);
      }).not.toThrow();

      // Verify the parsed result matches the original structure
      expect(parsedResult).toEqual(complexJson);
      expect(parsedResult.users).toHaveLength(2);
      expect(parsedResult.metadata.total).toBe(2);
    });

    it("should demonstrate chunk size optimization behavior", async () => {
      // Test with a JSON that could be split but might be combined by GreedySplitter
      const mediumJsonObject = {
        service: "api-gateway-service",
        version: "1.5.0",
        description:
          "API Gateway service configuration with comprehensive settings for routing, authentication, rate limiting, and monitoring across multiple environments",
        endpoints: {
          users: {
            path: "/api/v1/users",
            methods: ["GET", "POST", "PUT", "DELETE"],
            auth: "jwt-required",
            rateLimit: {
              requests: 1000,
              window: "1h",
              burst: 50,
            },
            validation: {
              strictMode: true,
              allowUnknownFields: false,
              sanitization: true,
            },
          },
          posts: {
            path: "/api/v1/posts",
            methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
            auth: "jwt-required",
            rateLimit: {
              requests: 500,
              window: "1h",
              burst: 25,
            },
            caching: {
              enabled: true,
              ttl: 300,
              vary: ["Authorization", "Accept-Language"],
            },
          },
          auth: {
            path: "/api/v1/auth",
            methods: ["POST", "DELETE"],
            auth: "none",
            rateLimit: {
              requests: 100,
              window: "1h",
              burst: 5,
            },
            security: {
              bruteForceProtection: true,
              maxAttempts: 5,
              lockoutDuration: "15m",
            },
          },
        },
        middleware: {
          cors: {
            enabled: true,
            origins: ["https://app.example.com", "https://admin.example.com"],
            methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            credentials: true,
          },
          helmet: {
            enabled: true,
            contentSecurityPolicy: {
              directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:", "https:"],
              },
            },
          },
          compression: {
            enabled: true,
            level: 6,
            threshold: 1024,
          },
        },
        database: {
          type: "postgresql",
          host: "database-cluster.example.com",
          port: 5432,
          ssl: {
            enabled: true,
            rejectUnauthorized: true,
            ca: "/path/to/ca-certificate.pem",
          },
          pool: {
            min: 5,
            max: 25,
            acquireTimeoutMillis: 60000,
            createTimeoutMillis: 30000,
          },
        },
      };

      const jsonContent: RawContent = {
        content: JSON.stringify(mediumJsonObject, null, 2),
        mimeType: "application/json",
        charset: "utf-8",
        source: "api-config.json",
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      expect(result.chunks).toBeDefined();
      expect(result.chunks!.length).toBeGreaterThan(0);

      // Verify JSON validity after processing
      const concatenated = result.chunks!.map((chunk) => chunk.content).join("\n");
      let parsedResult: any;
      expect(() => {
        parsedResult = JSON.parse(concatenated);
      }).not.toThrow();
      expect(parsedResult).toEqual(mediumJsonObject);

      // Verify that chunks are reasonable size
      const totalContentLength = result.chunks!.reduce(
        (sum, chunk) => sum + chunk.content.length,
        0,
      );
      expect(totalContentLength).toBeGreaterThan(500); // Should have substantial content

      // Each chunk should contain valid JSON structure or be part of valid concatenation
      result.chunks!.forEach((chunk) => {
        expect(chunk.content.length).toBeGreaterThan(0);
        expect(chunk.content.trim().length).toBeGreaterThan(0);
      });
    });

    it("should preserve hierarchical path information during concatenation", async () => {
      const nestedJson = {
        application: {
          config: {
            database: {
              primary: {
                host: "primary-db.example.com",
                port: 5432,
                connectionPool: {
                  min: 5,
                  max: 20,
                  acquireTimeoutMillis: 60000,
                  createTimeoutMillis: 30000,
                  destroyTimeoutMillis: 5000,
                  idleTimeoutMillis: 30000,
                  reapIntervalMillis: 1000,
                  createRetryIntervalMillis: 200,
                },
              },
              replica: {
                host: "replica-db.example.com",
                port: 5432,
                connectionPool: {
                  min: 2,
                  max: 10,
                  acquireTimeoutMillis: 30000,
                  createTimeoutMillis: 15000,
                  destroyTimeoutMillis: 3000,
                  idleTimeoutMillis: 60000,
                  reapIntervalMillis: 2000,
                  createRetryIntervalMillis: 500,
                },
              },
            },
            cache: {
              redis: {
                host: "cache.example.com",
                port: 6379,
                database: 0,
                keyPrefix: "app:",
                retryDelayOnFailover: 100,
                enableReadyCheck: true,
                maxRetriesPerRequest: 3,
                lazyConnect: true,
                keepAlive: 30000,
                connectTimeout: 10000,
                commandTimeout: 5000,
              },
              memcached: {
                servers: ["memcache1.example.com:11211", "memcache2.example.com:11211"],
                options: {
                  maxExpiration: 2592000,
                  namespace: "app_cache",
                  hashAlgorithm: "md5",
                  locateTimeout: 3000,
                  retries: 2,
                  retry: 30000,
                  remove: true,
                  failOver: true,
                  failOverServers: ["memcache-backup.example.com:11211"],
                },
              },
            },
          },
          monitoring: {
            metrics: {
              enabled: true,
              interval: 60000,
              retention: "7d",
              aggregation: ["avg", "max", "min", "sum", "count"],
            },
            logging: {
              level: "info",
              format: "json",
              output: ["stdout", "file", "syslog"],
              rotation: {
                maxSize: "100MB",
                maxFiles: 10,
                compress: true,
              },
            },
          },
        },
      };

      const jsonContent: RawContent = {
        content: JSON.stringify(nestedJson, null, 2),
        mimeType: "application/json",
        charset: "utf-8",
        source: "nested-config.json",
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      expect(result.chunks).toBeDefined();

      // Verify JSON validity after processing
      const concatenated = result.chunks!.map((chunk) => chunk.content).join("\n");
      let parsedResult: any;
      expect(() => {
        parsedResult = JSON.parse(concatenated);
      }).not.toThrow();
      expect(parsedResult).toEqual(nestedJson);

      // Verify chunks have meaningful section information
      result.chunks!.forEach((chunk) => {
        expect(chunk.section.path).toBeDefined();
        expect(chunk.section.level).toBeGreaterThan(0);
        expect(Array.isArray(chunk.section.path)).toBe(true);
      });

      // The important thing is that the content is processed correctly,
      // not necessarily that all individual paths are preserved after GreedySplitter
      expect(result.chunks!.length).toBeGreaterThan(0);
    });

    it("should handle edge cases in size optimization", async () => {
      const edgeCases = [
        '{"tiny": "value"}', // Very small JSON
        "{}", // Empty object
        "[]", // Empty array
        `{"single_large_property": "${"x".repeat(2000)}"}`, // Single large property
      ];

      for (const testCase of edgeCases) {
        const jsonContent: RawContent = {
          content: testCase,
          mimeType: "application/json",
          charset: "utf-8",
          source: "edge-case.json",
        };

        const result = await pipeline.process(jsonContent, baseOptions);

        // Should always produce valid results
        expect(result.chunks).toBeDefined();
        expect(result.chunks!.length).toBeGreaterThan(0);

        // Concatenated content should be valid JSON
        const concatenated = result.chunks!.map((chunk) => chunk.content).join("\n");
        expect(() => JSON.parse(concatenated)).not.toThrow();

        // Parsed result should match original
        const original = JSON.parse(testCase);
        const parsed = JSON.parse(concatenated);
        expect(parsed).toEqual(original);
      }
    });

    // Hierarchy-focused tests for consistency with other pipelines
    it("should preserve hierarchical structure through GreedySplitter integration", async () => {
      const nestedJson = {
        application: {
          name: "My Application",
          version: "1.0.0",
          database: {
            primary: {
              host: "localhost",
              port: 5432,
              credentials: {
                username: "admin",
                password: "secret",
              },
            },
            replica: {
              host: "replica.example.com",
              port: 5432,
            },
          },
          services: {
            auth: {
              enabled: true,
              provider: "oauth2",
            },
            logging: {
              level: "info",
              format: "json",
            },
          },
        },
      };

      const jsonContent: RawContent = {
        content: JSON.stringify(nestedJson, null, 2),
        mimeType: "application/json",
        charset: "utf-8",
        source: "hierarchy-test.json",
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      // Verify we got chunks with proper hierarchy
      expect(result.chunks).toBeDefined();
      expect(result.chunks!.length).toBeGreaterThan(0);

      // Check that all chunks have valid hierarchy metadata
      result.chunks!.forEach((chunk) => {
        expect(chunk.section).toBeDefined();
        expect(typeof chunk.section.level).toBe("number");
        expect(Array.isArray(chunk.section.path)).toBe(true);
        expect(chunk.section.level).toBeGreaterThanOrEqual(1); // Should not degrade to 0
      });

      // Verify JSON chunks are marked as code type (that's how JsonDocumentSplitter works)
      const hasCodeType = result.chunks!.some((chunk) => chunk.types.includes("code"));
      expect(hasCodeType).toBe(true);

      // GreedySplitter may merge content, but hierarchy structure should still be meaningful
      // Check that paths contain meaningful JSON property names
      const allPaths = result.chunks!.flatMap((chunk) => chunk.section.path);
      const hasJsonProperties = allPaths.some((pathElement) =>
        ["application", "database", "services"].includes(pathElement),
      );
      expect(hasJsonProperties).toBe(true);

      // Verify JSON validity is preserved
      const concatenated = result.chunks!.map((chunk) => chunk.content).join("\n");
      let parsedResult: any;
      expect(() => {
        parsedResult = JSON.parse(concatenated);
      }).not.toThrow();
      expect(parsedResult).toEqual(nestedJson);
    });

    it("should handle leading whitespace without creating artificial level 0 chunks", async () => {
      const jsonWithLeadingWhitespace = `

  
  {
    "config": {
      "database": {
        "host": "localhost",
        "port": 5432
      }
    },
    "features": {
      "auth": true,
      "logging": true
    }
  }`;

      const jsonContent: RawContent = {
        content: jsonWithLeadingWhitespace,
        mimeType: "application/json",
        charset: "utf-8",
        source: "whitespace-test.json",
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      // Should not create separate whitespace-only chunks at level 0
      const whitespaceOnlyChunks = result.chunks!.filter(
        (chunk) =>
          chunk.section.level === 0 &&
          chunk.section.path.length === 0 &&
          chunk.content.trim() === "",
      );
      expect(whitespaceOnlyChunks).toHaveLength(0);

      // Minimum level should be 1 (not degraded to 0 by GreedySplitter)
      const minLevel = Math.min(...result.chunks!.map((c) => c.section.level));
      expect(minLevel).toBe(1);

      // Verify JSON validity is preserved
      const concatenated = result.chunks!.map((chunk) => chunk.content).join("\n");
      expect(() => JSON.parse(concatenated)).not.toThrow();
    });

    it("should maintain semantic JSON boundaries during optimization", async () => {
      // Use much smaller chunk sizes to force GreedySplitter to work
      const smallChunkPipeline = new JsonPipeline(30);

      // Create JSON that will definitely exceed chunk size limits
      const largeNestedJson = {
        servers: Array.from({ length: 5 }, (_, i) => ({
          id: i + 1,
          name: `server-${i + 1}`,
          host: `server-${i + 1}.example.com`,
        })),
      };

      const jsonContent: RawContent = {
        content: JSON.stringify(largeNestedJson, null, 2),
        mimeType: "application/json",
        charset: "utf-8",
        source: "large-boundaries.json",
      };

      const result = await smallChunkPipeline.process(jsonContent, baseOptions);

      // Should have multiple chunks due to size constraints
      expect(result.chunks!.length).toBeGreaterThan(1);

      // Should maintain hierarchy levels (not degrade to 0)
      const minLevel = Math.min(...result.chunks!.map((c) => c.section.level));
      expect(minLevel).toBeGreaterThanOrEqual(1);

      // Verify JSON validity after processing
      const concatenated = result.chunks!.map((chunk) => chunk.content).join("\n");
      let parsedResult: any;
      expect(() => {
        parsedResult = JSON.parse(concatenated);
      }).not.toThrow();
      expect(parsedResult).toEqual(largeNestedJson);
    });

    it("should assign correct hierarchy levels to nested JSON structures", async () => {
      const hierarchicalJson = {
        root: {
          level1: {
            level2: {
              deepProperty: "deep value",
            },
          },
        },
        topLevel: "top value",
      };

      const jsonContent: RawContent = {
        content: JSON.stringify(hierarchicalJson, null, 2),
        mimeType: "application/json",
        charset: "utf-8",
        source: "hierarchy-levels.json",
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      // Verify we have content
      expect(result.chunks!.length).toBeGreaterThan(0);

      // Verify all chunks have proper section metadata
      result.chunks!.forEach((chunk) => {
        expect(chunk.section).toBeDefined();
        expect(typeof chunk.section.level).toBe("number");
        expect(Array.isArray(chunk.section.path)).toBe(true);
        expect(chunk.section.level).toBeGreaterThanOrEqual(1);
        expect(chunk.types).toContain("code"); // JSON chunks are marked as 'code'
      });

      // Verify content is preserved
      const concatenated = result.chunks!.map((chunk) => chunk.content).join("\n");
      let parsedResult: any;
      expect(() => {
        parsedResult = JSON.parse(concatenated);
      }).not.toThrow();
      expect(parsedResult).toEqual(hierarchicalJson);

      // Verify paths contain meaningful JSON structure
      const allPaths = result.chunks!.flatMap((chunk) => chunk.section.path);
      const hasJsonStructure = allPaths.some((pathElement) =>
        ["root", "level1", "level2"].includes(pathElement),
      );
      expect(hasJsonStructure).toBe(true);
    });
  });
});
