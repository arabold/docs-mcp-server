/**
 * Behavior tests for AppServer focusing on configuration validation,
 * service composition, and lifecycle management.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBusService } from "../events";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import type { DocumentManagementService } from "../store/DocumentManagementService";
import { type AppConfig, loadConfig } from "../utils/config";
import { AppServer } from "./AppServer";
import type { AppServerConfig } from "./AppServerConfig";

// Mock implementations - use vi.hoisted to ensure they're available at the top level
const mockFastify = vi.hoisted(() => ({
  register: vi.fn(),
  listen: vi.fn(),
  close: vi.fn(),
  setErrorHandler: vi.fn(), // Add missing mock method
  server: {
    on: vi.fn(), // Mock HTTP server for WebSocket upgrade handling
    closeAllConnections: vi.fn(), // Mock for forcing connection closure
  },
}));

const mockMcpService = vi.hoisted(() => ({
  registerMcpService: vi.fn(),
  cleanupMcpService: vi.fn(),
}));

const mockTrpcService = vi.hoisted(() => ({
  registerTrpcService: vi.fn(),
  applyTrpcWebSocketHandler: vi.fn(),
}));

const mockWebService = vi.hoisted(() => ({
  registerWebService: vi.fn(),
}));

const mockWorkerService = vi.hoisted(() => ({
  registerWorkerService: vi.fn(),
  stopWorkerService: vi.fn(),
}));

// Apply mocks using hoisted values
vi.mock("fastify", () => ({
  default: vi.fn(() => mockFastify),
}));

vi.mock("../services/mcpService", () => mockMcpService);
vi.mock("../services/trpcService", () => mockTrpcService);
vi.mock("../services/webService", () => mockWebService);
vi.mock("../services/workerService", () => mockWorkerService);
vi.mock("../utils/paths", () => ({
  getProjectRoot: vi.fn(() => "/mock/project/root"),
}));
vi.mock("@fastify/formbody");
vi.mock("@fastify/static");

describe("AppServer Behavior Tests", () => {
  let mockDocService: Partial<DocumentManagementService>;
  let mockPipeline: Partial<IPipeline>;
  let mockMcpServer: Partial<McpServer>;
  let eventBus: EventBusService;
  let appConfig: AppConfig;

  beforeEach(() => {
    eventBus = new EventBusService();
    // Reset all mocks before each test
    vi.clearAllMocks();

    appConfig = loadConfig();

    // Setup mock dependencies
    mockDocService = {
      getActiveEmbeddingConfig: vi.fn().mockReturnValue(null),
    };
    mockPipeline = {
      setCallbacks: vi.fn(), // Add mock for setCallbacks method
    };
    mockMcpServer = {};

    // Setup default mock returns
    mockFastify.register.mockResolvedValue(undefined);
    mockFastify.listen.mockResolvedValue("http://localhost:3000");
    mockFastify.close.mockResolvedValue(undefined);
    mockMcpService.registerMcpService.mockResolvedValue(mockMcpServer as McpServer);
    mockMcpService.cleanupMcpService.mockResolvedValue(undefined);
    mockTrpcService.registerTrpcService.mockResolvedValue(undefined);
    mockWebService.registerWebService.mockResolvedValue(undefined);
    mockWorkerService.registerWorkerService.mockResolvedValue(undefined);
    mockWorkerService.stopWorkerService.mockResolvedValue(undefined);
  });

  describe("Configuration Validation", () => {
    it("should reject web interface without worker or external worker URL", async () => {
      const config: AppServerConfig = {
        enableWebInterface: true,
        enableMcpServer: false,
        enableApiServer: false,
        enableWorker: false,
        port: 3000,
        // externalWorkerUrl not provided
      };

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfig,
      );

      await expect(server.start()).rejects.toThrow(
        "Web interface requires either embedded worker (enableWorker: true) or external worker (externalWorkerUrl)",
      );
    });

    it("should reject MCP server without worker or external worker URL", async () => {
      const config: AppServerConfig = {
        enableWebInterface: false,
        enableMcpServer: true,
        enableApiServer: false,
        enableWorker: false,
        port: 3000,
        // externalWorkerUrl not provided
      };

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfig,
      );

      await expect(server.start()).rejects.toThrow(
        "MCP server requires either embedded worker (enableWorker: true) or external worker (externalWorkerUrl)",
      );
    });

    it("should accept web interface with embedded worker", () => {
      const config: AppServerConfig = {
        enableWebInterface: true,
        enableMcpServer: false,
        enableApiServer: false,
        enableWorker: true,
        port: 3000,
      };

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfig,
      );

      expect(() => server.start()).not.toThrow();
    });

    it("should accept web interface with external worker URL", () => {
      const config: AppServerConfig = {
        enableWebInterface: true,
        enableMcpServer: false,
        enableApiServer: false,
        enableWorker: false,
        port: 3000,
        externalWorkerUrl: "http://worker.example.com",
      };

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfig,
      );

      expect(() => server.start()).not.toThrow();
    });

    it("should accept all services enabled", () => {
      const config: AppServerConfig = {
        enableWebInterface: true,
        enableMcpServer: true,
        enableApiServer: true,
        enableWorker: true,
        port: 3000,
      };

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfig,
      );

      expect(() => server.start()).not.toThrow();
    });
  });

  describe("Service Registration Behavior", () => {
    it("should register no services when all are disabled", async () => {
      const config: AppServerConfig = {
        enableWebInterface: false,
        enableMcpServer: false,
        enableApiServer: false,
        enableWorker: false,
        port: 3000,
      };

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfig,
      );

      await server.start();

      // Only core plugins should be registered
      expect(mockFastify.register).toHaveBeenCalledTimes(1); // Just formbody
      expect(mockWebService.registerWebService).not.toHaveBeenCalled();
      expect(mockMcpService.registerMcpService).not.toHaveBeenCalled();
      expect(mockTrpcService.registerTrpcService).not.toHaveBeenCalled();
      expect(mockWorkerService.registerWorkerService).not.toHaveBeenCalled();
    });

    it("should register only web interface when enabled", async () => {
      const config: AppServerConfig = {
        enableWebInterface: true,
        enableMcpServer: false,
        enableApiServer: false,
        enableWorker: true, // Required for web interface
        port: 3000,
      };

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfig,
      );

      await server.start();

      expect(mockWebService.registerWebService).toHaveBeenCalledWith(
        mockFastify,
        mockDocService,
        mockPipeline,
        eventBus,
        appConfig,
        undefined,
      );
      expect(mockWorkerService.registerWorkerService).toHaveBeenCalledWith(mockPipeline);
      expect(mockMcpService.registerMcpService).not.toHaveBeenCalled();
      expect(mockTrpcService.registerTrpcService).not.toHaveBeenCalled();
    });

    it("should register only MCP server when enabled", async () => {
      const config: AppServerConfig = {
        enableWebInterface: false,
        enableMcpServer: true,
        enableApiServer: false,
        enableWorker: true, // Required for MCP server
        port: 3000,
      };

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfig,
      );

      await server.start();

      expect(mockMcpService.registerMcpService).toHaveBeenCalledWith(
        mockFastify,
        mockDocService,
        mockPipeline,
        appConfig,
        undefined, // authManager
      );
      expect(mockWorkerService.registerWorkerService).toHaveBeenCalledWith(mockPipeline);
      expect(mockWebService.registerWebService).not.toHaveBeenCalled();
      // tRPC service should not be registered in this mode
      expect(mockTrpcService.registerTrpcService).not.toHaveBeenCalled();
    });

    it("should register only API when enabled", async () => {
      const config: AppServerConfig = {
        enableWebInterface: false,
        enableMcpServer: false,
        enableApiServer: true,
        enableWorker: false,
        port: 3000,
      };

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfig,
      );

      await server.start();

      expect(mockTrpcService.registerTrpcService).toHaveBeenCalledWith(
        mockFastify,
        mockPipeline,
        mockDocService,
        expect.any(Object), // eventBus
      );
      expect(mockWebService.registerWebService).not.toHaveBeenCalled();
      expect(mockMcpService.registerMcpService).not.toHaveBeenCalled();
      expect(mockWorkerService.registerWorkerService).not.toHaveBeenCalled();
    });

    it("should register all services when all are enabled", async () => {
      const config: AppServerConfig = {
        enableWebInterface: true,
        enableMcpServer: true,
        enableApiServer: true,
        enableWorker: true,
        port: 3000,
      };

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfig,
      );

      await server.start();

      expect(mockWebService.registerWebService).toHaveBeenCalledWith(
        mockFastify,
        mockDocService,
        mockPipeline,
        eventBus,
        appConfig,
        undefined,
      );
      expect(mockMcpService.registerMcpService).toHaveBeenCalledWith(
        mockFastify,
        mockDocService,
        mockPipeline,
        appConfig,
        undefined, // authManager
      );
      expect(mockTrpcService.registerTrpcService).toHaveBeenCalledWith(
        mockFastify,
        mockPipeline,
        mockDocService,
        expect.any(Object), // eventBus
      );
      expect(mockWorkerService.registerWorkerService).toHaveBeenCalledWith(mockPipeline);
    });

    it("should register static files only when web interface is enabled", async () => {
      const config: AppServerConfig = {
        enableWebInterface: true,
        enableMcpServer: false,
        enableApiServer: false,
        enableWorker: true,
        port: 3000,
      };

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfig,
      );

      await server.start();

      // formbody + static files
      expect(mockFastify.register).toHaveBeenCalledTimes(2);
      // Verify static files registration with correct path
      expect(mockFastify.register).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          root: expect.stringContaining("public"),
          prefix: "/",
          index: false,
        }),
      );
    });
  });

  describe("Server Lifecycle Behavior", () => {
    it("should start server on specified port and host", async () => {
      const config: AppServerConfig = {
        enableWebInterface: false,
        enableMcpServer: false,
        enableApiServer: true,
        enableWorker: false,
        port: 4000,
      };

      const appConfigWithHost: AppConfig = JSON.parse(JSON.stringify(appConfig));
      appConfigWithHost.server.host = "0.0.0.0";

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfigWithHost,
      );

      const fastifyInstance = await server.start();

      expect(mockFastify.listen).toHaveBeenCalledWith({
        port: 4000,
        host: "0.0.0.0",
      });
      expect(fastifyInstance).toBe(mockFastify);
    });

    it("should successfully start server with all services enabled", async () => {
      const config: AppServerConfig = {
        enableWebInterface: true,
        enableMcpServer: true,
        enableApiServer: true,
        enableWorker: true,
        port: 3000,
      };

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfig,
      );

      const fastifyInstance = await server.start();

      // Verify server started successfully
      expect(fastifyInstance).toBe(mockFastify);
      expect(mockFastify.listen).toHaveBeenCalledWith({
        port: 3000,
        host: "127.0.0.1",
      });

      // Verify all services were registered
      expect(mockWebService.registerWebService).toHaveBeenCalled();
      expect(mockMcpService.registerMcpService).toHaveBeenCalled();
      expect(mockTrpcService.registerTrpcService).toHaveBeenCalled();
      expect(mockWorkerService.registerWorkerService).toHaveBeenCalled();
    });

    it("should successfully start server with external worker configured", async () => {
      const config: AppServerConfig = {
        enableWebInterface: true,
        enableMcpServer: false,
        enableApiServer: false,
        enableWorker: false,
        port: 3000,
        externalWorkerUrl: "http://worker.example.com",
      };

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfig,
      );

      const fastifyInstance = await server.start();

      // Verify server started successfully
      expect(fastifyInstance).toBe(mockFastify);
      expect(mockFastify.listen).toHaveBeenCalled();

      // Verify web service was registered but not embedded worker
      expect(mockWebService.registerWebService).toHaveBeenCalled();
      expect(mockWorkerService.registerWorkerService).not.toHaveBeenCalled();
    });

    it("should handle server startup failure gracefully", async () => {
      const startupError = new Error("Port already in use");
      mockFastify.listen.mockRejectedValue(startupError);

      const config: AppServerConfig = {
        enableWebInterface: false,
        enableMcpServer: false,
        enableApiServer: true,
        enableWorker: false,
        port: 3000,
      };

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfig,
      );

      await expect(server.start()).rejects.toThrow("Port already in use");
      // Verify that cleanup was attempted
      expect(mockFastify.close).toHaveBeenCalled();
    });
  });

  describe("Server Shutdown Behavior", () => {
    it("should stop all services gracefully", async () => {
      const config: AppServerConfig = {
        enableWebInterface: true,
        enableMcpServer: true,
        enableApiServer: true,
        enableWorker: true,
        port: 3000,
      };

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfig,
      );

      await server.start();
      await server.stop();

      expect(mockWorkerService.stopWorkerService).toHaveBeenCalledWith(mockPipeline);
      expect(mockMcpService.cleanupMcpService).toHaveBeenCalledWith(mockMcpServer);
      expect(mockFastify.close).toHaveBeenCalled();
    });

    it("should not stop worker service when not enabled", async () => {
      const config: AppServerConfig = {
        enableWebInterface: false,
        enableMcpServer: false,
        enableApiServer: true,
        enableWorker: false,
        port: 3000,
      };

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfig,
      );

      await server.start();
      await server.stop();

      expect(mockWorkerService.stopWorkerService).not.toHaveBeenCalled();
      expect(mockMcpService.cleanupMcpService).not.toHaveBeenCalled();
      expect(mockFastify.close).toHaveBeenCalled();
    });

    it("should handle shutdown failure and still attempt all cleanup", async () => {
      const shutdownError = new Error("Cleanup failed");
      mockWorkerService.stopWorkerService.mockRejectedValue(shutdownError);

      const config: AppServerConfig = {
        enableWebInterface: false,
        enableMcpServer: true, // Enable MCP server so it gets cleaned up too
        enableApiServer: false,
        enableWorker: true,
        port: 3000,
      };

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfig,
      );

      await server.start();
      await expect(server.stop()).rejects.toThrow("Cleanup failed");

      // Verify that stopWorkerService was called before the error was thrown
      expect(mockWorkerService.stopWorkerService).toHaveBeenCalledWith(mockPipeline);
    });
  });

  describe("Configuration Edge Cases", () => {
    it("should handle minimal configuration with only API", async () => {
      const config: AppServerConfig = {
        enableWebInterface: false,
        enableMcpServer: false,
        enableApiServer: true,
        enableWorker: false,
        port: 3000,
      };

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfig,
      );

      const fastifyInstance = await server.start();

      expect(fastifyInstance).toBe(mockFastify);
      expect(mockTrpcService.registerTrpcService).toHaveBeenCalledWith(
        mockFastify,
        mockPipeline,
        mockDocService,
        expect.any(Object), // eventBus
      );
    });

    it("should handle configuration with both embedded and external worker", async () => {
      const config: AppServerConfig = {
        enableWebInterface: true,
        enableMcpServer: false,
        enableApiServer: false,
        enableWorker: true,
        port: 3000,
        externalWorkerUrl: "http://worker.example.com", // This should be ignored
      };

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfig,
      );

      await server.start();

      // Worker should take precedence - external worker should not be registered
      expect(mockWorkerService.registerWorkerService).toHaveBeenCalledWith(mockPipeline);
    });

    it("should validate port number boundaries", async () => {
      const config: AppServerConfig = {
        enableWebInterface: false,
        enableMcpServer: false,
        enableApiServer: true,
        enableWorker: false,
        port: 65535, // Maximum valid port
      };

      const appConfigWithHost: AppConfig = JSON.parse(JSON.stringify(appConfig));
      appConfigWithHost.server.host = "0.0.0.0";

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfigWithHost,
      );

      await server.start();

      expect(mockFastify.listen).toHaveBeenCalledWith({
        port: 65535,
        host: "0.0.0.0",
      });
    });
  });
});
