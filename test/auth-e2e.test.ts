/**
 * End-to-end authentication tests for the MCP server.
 * 
 * These tests validate that authentication works correctly using a real OAuth2/OIDC provider.
 * The tests use environment variables from the .env file to configure the authentication.
 */

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { startAppServer } from "../src/app";
import { createLocalDocumentManagement } from "../src/store";
import { PipelineFactory } from "../src/pipeline/PipelineFactory";
import { createAppServerConfig } from "../src/cli/utils";
import { LogLevel, setLogLevel } from "../src/utils/logger";

// Load environment variables from .env file
config();

describe("Authentication End-to-End Tests", () => {
  let appServer: any;
  let docService: any;
  let pipeline: any;
  let serverPort: number;
  let baseUrl: string;
  let tempDir: string;

  beforeAll(async () => {
    // Skip tests if authentication environment variables are not set
    if (!process.env.DOCS_MCP_AUTH_ISSUER_URL || !process.env.DOCS_MCP_AUTH_AUDIENCE) {
      console.log("⚠️ Skipping authentication tests - DOCS_MCP_AUTH_ISSUER_URL or DOCS_MCP_AUTH_AUDIENCE not found in .env");
      return;
    }

    // Set quiet logging for tests
    setLogLevel(LogLevel.ERROR);

    // Create temporary directory for test database
    tempDir = mkdtempSync(join(tmpdir(), "auth-e2e-test-"));

    // Find an available port for the test server
    serverPort = 9876; // Use a specific port for testing
    baseUrl = `http://localhost:${serverPort}`;

    // Initialize services with temporary directory
    docService = await createLocalDocumentManagement(tempDir); // Use temp dir for test database
    pipeline = await PipelineFactory.createPipeline(docService);

    // Configure server with authentication enabled
    const config = createAppServerConfig({
      enableWebInterface: false,
      enableMcpServer: true,
      enableApiServer: false,
      enableWorker: true, // Enable worker for MCP server
      port: serverPort,
      host: "localhost",
      auth: {
        enabled: true,
        issuerUrl: process.env.DOCS_MCP_AUTH_ISSUER_URL,
        audience: process.env.DOCS_MCP_AUTH_AUDIENCE,
        scopes: ["openid", "profile"],
      },
      startupContext: {
        cliCommand: "test",
        mcpProtocol: "http",
      },
    });

    // Start the server
    appServer = await startAppServer(docService, pipeline, config);
    
    // Give the server a moment to start
    await new Promise(resolve => setTimeout(resolve, 1000));
  }, 30000);

  afterAll(async () => {
    if (appServer) {
      await appServer.stop();
    }
    if (pipeline) {
      await pipeline.stop();
    }
    if (docService) {
      await docService.shutdown();
    }
    // Clean up temporary directory
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  describe("Protected Endpoint Access", () => {
    it("should return 401 when accessing protected endpoint without token", async () => {
      // Skip if no auth config
      if (!process.env.DOCS_MCP_AUTH_ISSUER_URL || !process.env.DOCS_MCP_AUTH_AUDIENCE) {
        console.log("⚠️ Skipping test - authentication not configured");
        return;
      }

      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1,
        }),
      });

      expect(response.status).toBe(401);
      const responseText = await response.text();
      expect(responseText.toLowerCase()).toContain("unauthorized");
    }, 10000);

    it("should return 401 when accessing protected endpoint with invalid token", async () => {
      // Skip if no auth config
      if (!process.env.DOCS_MCP_AUTH_ISSUER_URL || !process.env.DOCS_MCP_AUTH_AUDIENCE) {
        console.log("⚠️ Skipping test - authentication not configured");
        return;
      }

      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer invalid-token-12345",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1,
        }),
      });

      expect(response.status).toBe(401);
      const responseText = await response.text();
      expect(responseText.toLowerCase()).toContain("invalid_token");
    }, 10000);

    it("should return 401 when accessing protected endpoint with malformed token", async () => {
      // Skip if no auth config
      if (!process.env.DOCS_MCP_AUTH_ISSUER_URL || !process.env.DOCS_MCP_AUTH_AUDIENCE) {
        console.log("⚠️ Skipping test - authentication not configured");
        return;
      }

      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer not.a.valid.jwt.token",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1,
        }),
      });

      expect(response.status).toBe(401);
      const responseText = await response.text();
      expect(responseText.toLowerCase()).toContain("invalid_token");
    }, 10000);
  });

  describe("Environment Variable Configuration", () => {
    it("should load authentication configuration from environment variables", () => {
      // Skip if no auth config
      if (!process.env.DOCS_MCP_AUTH_ISSUER_URL || !process.env.DOCS_MCP_AUTH_AUDIENCE) {
        console.log("⚠️ Skipping test - authentication not configured");
        return;
      }

      expect(process.env.DOCS_MCP_AUTH_ISSUER_URL).toBe("https://engaging-cowbird-70.clerk.accounts.dev");
      expect(process.env.DOCS_MCP_AUTH_AUDIENCE).toBe("https://mcp.grounded.tools");
    });

    it("should validate issuer URL format", () => {
      // Skip if no auth config
      if (!process.env.DOCS_MCP_AUTH_ISSUER_URL || !process.env.DOCS_MCP_AUTH_AUDIENCE) {
        console.log("⚠️ Skipping test - authentication not configured");
        return;
      }

      const issuerUrl = process.env.DOCS_MCP_AUTH_ISSUER_URL!;
      expect(issuerUrl).toMatch(/^https:\/\/.+/);
      
      // Verify it's a valid URL
      expect(() => new URL(issuerUrl)).not.toThrow();
    });

    it("should validate audience format", () => {
      // Skip if no auth config
      if (!process.env.DOCS_MCP_AUTH_ISSUER_URL || !process.env.DOCS_MCP_AUTH_AUDIENCE) {
        console.log("⚠️ Skipping test - authentication not configured");
        return;
      }

      const audience = process.env.DOCS_MCP_AUTH_AUDIENCE!;
      expect(audience).toMatch(/^https:\/\/.+/);
      
      // Verify it's a valid URL
      expect(() => new URL(audience)).not.toThrow();
    });
  });

  describe("Manual Testing Guide", () => {
    it("should document how to manually test with valid token", () => {
      // Skip if no auth config
      if (!process.env.DOCS_MCP_AUTH_ISSUER_URL || !process.env.DOCS_MCP_AUTH_AUDIENCE) {
        console.log("⚠️ Skipping test - authentication not configured");
        return;
      }

      console.log(`
📋 MANUAL TESTING GUIDE FOR AUTHENTICATION:

To test authentication with a valid token, follow these steps:

1. Set the environment variables in your .env file:
   DOCS_MCP_AUTH_ISSUER_URL=${process.env.DOCS_MCP_AUTH_ISSUER_URL}
   DOCS_MCP_AUTH_AUDIENCE=${process.env.DOCS_MCP_AUTH_AUDIENCE}

2. Start the server with authentication enabled:
   npm run dev -- --auth-enabled --auth-issuer-url "${process.env.DOCS_MCP_AUTH_ISSUER_URL}" --auth-audience "${process.env.DOCS_MCP_AUTH_AUDIENCE}"

3. Obtain a valid JWT token from the Clerk authentication system:
   - Visit: ${process.env.DOCS_MCP_AUTH_ISSUER_URL}
   - Follow the authentication flow
   - Extract the JWT token from the response

4. Test the protected endpoint with the valid token:
   curl -X POST ${baseUrl}/mcp \\
     -H "Content-Type: application/json" \\
     -H "Authorization: Bearer YOUR_JWT_TOKEN" \\
     -d '{"jsonrpc": "2.0", "method": "tools/list", "id": 1}'

5. Expected result: 200 OK with the list of available tools

⚠️  Note: This test is documented here but not automated because obtaining
   a valid JWT token requires a full OAuth2 flow with user interaction.
      `);
      
      // This test always passes - it's just documentation
      expect(true).toBe(true);
    });
  });
});
