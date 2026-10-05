/**
 * Behavior tests for AppServer focusing on configuration validation,
 * service composition, and lifecycle management.
 */
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBusService } from "../events";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import type { DocumentManagementService } from "../store/DocumentManagementService";
import { type AppConfig, loadConfig } from "../utils/config";
import { logger } from "../utils/logger";
import { AppServer } from "./AppServer";
import type { AppServerConfig } from "./AppServerConfig";

// Mock implementations - use vi.hoisted to ensure they're available at the top level
const mockFastify = vi.hoisted(() => ({
  register: vi.fn(),
  get: vi.fn(), // Mock for the explicit SPA "/" route
  listen: vi.fn(),
  close: vi.fn(),
  setErrorHandler: vi.fn(), // Add missing mock method
  setNotFoundHandler: vi.fn(), // Mock for the SPA fallback handler
  addHook: vi.fn(),
  route: vi.fn(), // Protected resource metadata routes
  options: vi.fn(), // Protected resource metadata preflights
  server: {
    on: vi.fn(), // Mock HTTP server for WebSocket upgrade handling
    closeAllConnections: vi.fn(), // Mock for forcing connection closure
  },
}));

const mockMcpService = vi.hoisted(() => ({
  registerMcpService: vi.fn(),
  MCP_ENDPOINT_PATH: "/mcp",
}));

const mockTrpcService = vi.hoisted(() => ({
  registerTrpcService: vi.fn(),
  applyTrpcWebSocketHandler: vi.fn(),
}));

const mockWorkerService = vi.hoisted(() => ({
  registerWorkerService: vi.fn(),
  stopWorkerService: vi.fn(),
}));

const mockVerifier = vi.hoisted(() => ({
  create: vi.fn(),
}));

// Apply mocks using hoisted values
vi.mock("fastify", () => ({
  default: vi.fn(() => mockFastify),
}));

vi.mock("../services/mcpService", () => mockMcpService);
vi.mock("../services/trpcService", () => mockTrpcService);
vi.mock("../services/workerService", () => mockWorkerService);
vi.mock("../auth/JwtAccessTokenVerifier", () => ({
  JwtAccessTokenVerifier: mockVerifier,
}));
vi.mock("../utils/paths", () => ({
  getProjectRoot: vi.fn(() => "/mock/project/root"),
}));
vi.mock("@fastify/static");

describe("AppServer Behavior Tests", () => {
  let mockDocService: Partial<DocumentManagementService>;
  let mockPipeline: Partial<IPipeline>;
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

    // Setup default mock returns
    mockFastify.register.mockResolvedValue(undefined);
    mockFastify.listen.mockResolvedValue("http://localhost:3000");
    mockFastify.close.mockResolvedValue(undefined);
    mockFastify.addHook.mockReturnValue(undefined);
    mockMcpService.registerMcpService.mockResolvedValue(undefined);
    mockTrpcService.registerTrpcService.mockResolvedValue(undefined);
    mockWorkerService.registerWorkerService.mockResolvedValue(undefined);
    mockWorkerService.stopWorkerService.mockResolvedValue(undefined);
    mockVerifier.create.mockResolvedValue({ verifyAccessToken: vi.fn() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

      // No plugins are registered when every service is disabled
      expect(mockFastify.register).not.toHaveBeenCalled();
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

      // Web interface is now just the SPA static file handler + catch-all,
      // registered after every other route.
      expect(mockWorkerService.registerWorkerService).toHaveBeenCalledWith(mockPipeline);
      expect(mockMcpService.registerMcpService).not.toHaveBeenCalled();
      expect(mockTrpcService.registerTrpcService).not.toHaveBeenCalled();
      expect(mockFastify.get).toHaveBeenCalledWith("/", expect.any(Function));
      expect(mockFastify.setNotFoundHandler).toHaveBeenCalled();
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
        {
          docService: mockDocService,
          pipeline: mockPipeline,
          config: appConfig,
          originPolicy: expect.objectContaining({ check: expect.any(Function) }),
          location: {
            configured: false,
            url: "http://127.0.0.1:3000",
            origin: "http://127.0.0.1:3000",
            basePath: "",
          },
        },
        undefined, // no authentication
      );
      expect(mockWorkerService.registerWorkerService).toHaveBeenCalledWith(mockPipeline);
      // Web interface is disabled: no SPA static handler should be registered
      expect(mockFastify.setNotFoundHandler).not.toHaveBeenCalled();
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
        expect.any(Object), // systemInfo
        undefined, // isWorkerConnected (embedded worker mode)
      );
      expect(mockMcpService.registerMcpService).not.toHaveBeenCalled();
      expect(mockWorkerService.registerWorkerService).not.toHaveBeenCalled();
      // Web interface is disabled: no SPA static handler should be registered
      expect(mockFastify.setNotFoundHandler).not.toHaveBeenCalled();
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

      expect(mockMcpService.registerMcpService).toHaveBeenCalledWith(
        mockFastify,
        expect.objectContaining({ docService: mockDocService, pipeline: mockPipeline }),
        undefined, // no authentication
      );
      expect(mockTrpcService.registerTrpcService).toHaveBeenCalledWith(
        mockFastify,
        mockPipeline,
        mockDocService,
        expect.any(Object), // eventBus
        expect.any(Object), // systemInfo
        undefined, // isWorkerConnected (embedded worker mode)
      );
      expect(mockWorkerService.registerWorkerService).toHaveBeenCalledWith(mockPipeline);
      // Web interface: SPA static handler registered last
      expect(mockFastify.get).toHaveBeenCalledWith("/", expect.any(Function));
      expect(mockFastify.setNotFoundHandler).toHaveBeenCalled();
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

      // static files only
      expect(mockFastify.register).toHaveBeenCalledTimes(1);
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

    it("should log startup URLs using configured bind host instead of listen address", async () => {
      const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);
      const config: AppServerConfig = {
        enableWebInterface: true,
        enableMcpServer: true,
        enableApiServer: true,
        enableWorker: true,
        port: 6280,
        showLogo: false,
      };
      const appConfigWithHost: AppConfig = JSON.parse(JSON.stringify(appConfig));
      appConfigWithHost.server.host = "0.0.0.0";
      mockFastify.listen.mockResolvedValue("http://127.0.0.1:6280");

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfigWithHost,
      );

      await server.start();

      expect(infoSpy).toHaveBeenCalledWith(
        "🚀 Grounded Docs available at http://0.0.0.0:6280",
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("MCP endpoint: http://0.0.0.0:6280/mcp"),
      );
      expect(infoSpy).not.toHaveBeenCalledWith(expect.stringContaining("/sse"));
      expect(infoSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("http://127.0.0.1:6280"),
      );
    });

    it("should prefer public origin in startup URLs", async () => {
      const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);
      const config: AppServerConfig = {
        enableWebInterface: true,
        enableMcpServer: true,
        enableApiServer: true,
        enableWorker: true,
        port: 6280,
        showLogo: false,
      };
      const appConfigWithPublicOrigin: AppConfig = JSON.parse(JSON.stringify(appConfig));
      appConfigWithPublicOrigin.server.host = "0.0.0.0";
      appConfigWithPublicOrigin.server.publicOrigin = "https://docs.example.com";

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfigWithPublicOrigin,
      );

      await server.start();

      expect(infoSpy).toHaveBeenCalledWith(
        "🚀 Grounded Docs available at https://docs.example.com",
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("MCP endpoint: https://docs.example.com/mcp"),
      );
    });

    it("advertises the MCP endpoint under the public URL's path", async () => {
      const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);
      const config: AppServerConfig = {
        enableWebInterface: false,
        enableMcpServer: true,
        enableApiServer: false,
        enableWorker: true,
        port: 6280,
        showLogo: false,
      };
      const appConfigWithUrl: AppConfig = JSON.parse(JSON.stringify(appConfig));
      appConfigWithUrl.server.publicUrl = "https://docs.example.com/tools";

      const server = new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfigWithUrl,
      );

      await server.start();

      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("MCP endpoint: https://docs.example.com/tools/mcp"),
      );
    });

    it("strips the public URL's path from requests before routing", () => {
      const config: AppServerConfig = {
        enableWebInterface: false,
        enableMcpServer: false,
        enableApiServer: true,
        enableWorker: true,
        port: 6280,
        showLogo: false,
      };
      const appConfigWithUrl: AppConfig = JSON.parse(JSON.stringify(appConfig));
      appConfigWithUrl.server.publicUrl = "https://docs.example.com/tools";

      new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfigWithUrl,
      );

      const options = vi.mocked(Fastify).mock.calls.at(-1)?.[0] as unknown as {
        rewriteUrl: (request: { url?: string }) => string;
      };
      expect(options.rewriteUrl({ url: "/tools/mcp" })).toBe("/mcp");
      expect(options.rewriteUrl({ url: "/mcp" })).toBe("/mcp");
    });

    describe("authentication", () => {
      const mcpConfig: AppServerConfig = {
        enableWebInterface: false,
        enableMcpServer: true,
        enableApiServer: false,
        enableWorker: true,
        port: 6280,
        showLogo: false,
      };

      function withAuth(overrides: Partial<AppConfig["auth"]> = {}, publicUrl?: string) {
        const config: AppConfig = JSON.parse(JSON.stringify(appConfig));
        config.auth.enabled = true;
        config.auth.issuerUrl = "https://auth.example.com";
        config.auth.audience = "";
        Object.assign(config.auth, overrides);
        if (publicUrl) {
          config.server.publicUrl = publicUrl;
        }
        return config;
      }

      function createServer(serverConfig: AppServerConfig, config: AppConfig) {
        return new AppServer(
          mockDocService as DocumentManagementService,
          mockPipeline as IPipeline,
          eventBus,
          serverConfig,
          config,
        );
      }

      it("refuses to start without a public URL", async () => {
        const server = createServer(mcpConfig, withAuth());

        await expect(server.start()).rejects.toThrow(/server\.publicUrl/);
      });

      it("refuses to start without an issuer", async () => {
        const server = createServer(
          mcpConfig,
          withAuth({ issuerUrl: "" }, "https://docs.example.com/tools"),
        );

        await expect(server.start()).rejects.toThrow(/auth\.issuerUrl/);
      });

      it("expects tokens for the MCP endpoint URL by default", async () => {
        const server = createServer(
          mcpConfig,
          withAuth({}, "https://docs.example.com/tools"),
        );

        await server.start();

        expect(mockVerifier.create).toHaveBeenCalledWith({
          issuerUrl: "https://auth.example.com",
          audience: "https://docs.example.com/tools/mcp",
        });
      });

      it("expects the configured audience when one is set", async () => {
        const server = createServer(
          mcpConfig,
          withAuth(
            { audience: "https://api.example.com" },
            "https://docs.example.com/tools",
          ),
        );

        await server.start();

        expect(mockVerifier.create).toHaveBeenCalledWith({
          issuerUrl: "https://auth.example.com",
          audience: "https://api.example.com",
        });
      });

      it("serves metadata at both locations and hands the endpoint its challenge URL", async () => {
        const server = createServer(
          mcpConfig,
          withAuth({}, "https://docs.example.com/tools"),
        );

        await server.start();

        const metadataUrls = mockFastify.route.mock.calls.map(
          (call) => (call[0] as { url: string }).url,
        );
        expect(metadataUrls).toEqual([
          "/.well-known/oauth-protected-resource/mcp",
          "/.well-known/oauth-protected-resource/tools/mcp",
        ]);
        expect(mockMcpService.registerMcpService).toHaveBeenCalledWith(
          mockFastify,
          expect.anything(),
          expect.objectContaining({
            resourceMetadataUrl:
              "https://docs.example.com/tools/.well-known/oauth-protected-resource/mcp",
          }),
        );
      });

      it("states at startup that only the MCP endpoint is protected", async () => {
        const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);
        const server = createServer(
          mcpConfig,
          withAuth({}, "https://docs.example.com/tools"),
        );

        await server.start();

        expect(infoSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "Authentication: protects https://docs.example.com/tools/mcp only; the web UI and API are not protected",
          ),
        );
      });

      it("warns that authentication protects nothing without an MCP endpoint", async () => {
        const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
        const server = createServer(
          { ...mcpConfig, enableMcpServer: false, enableApiServer: true },
          withAuth(),
        );

        await server.start();

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("protects nothing"));
        expect(mockVerifier.create).not.toHaveBeenCalled();
      });

      it("serves the MCP endpoint without authentication when auth is disabled", async () => {
        const server = createServer(mcpConfig, appConfig);

        await server.start();

        expect(mockVerifier.create).not.toHaveBeenCalled();
        expect(mockMcpService.registerMcpService).toHaveBeenCalledWith(
          mockFastify,
          expect.anything(),
          undefined,
        );
      });
    });

    it("checks the host on every bind and shields the API from foreign origins only on a loopback bind", async () => {
      const apiConfig: AppServerConfig = {
        enableWebInterface: false,
        enableMcpServer: false,
        enableApiServer: true,
        enableWorker: true,
        port: 6280,
        showLogo: false,
      };

      /** Start a server bound to `host` and run a request through its admission hook. */
      const admit = async (
        host: string,
        headers: Record<string, string>,
        url = "/api/ping",
      ) => {
        mockFastify.addHook.mockClear();
        const config: AppConfig = JSON.parse(JSON.stringify(appConfig));
        config.server.host = host;
        await new AppServer(
          mockDocService as DocumentManagementService,
          mockPipeline as IPipeline,
          eventBus,
          apiConfig,
          config,
        ).start();
        const hook = mockFastify.addHook.mock.calls.find(
          ([name]) => name === "onRequest",
        )?.[1] as (request: unknown, reply: unknown) => Promise<unknown>;
        const reply = { code: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };
        await hook({ url, headers }, reply);
        return reply.code.mock.calls[0]?.[0] as number | undefined;
      };

      const foreignOrigin = {
        host: "127.0.0.1:6280",
        origin: "https://attacker.example",
      };
      expect(await admit("127.0.0.1", foreignOrigin)).toBe(403);
      expect(await admit("127.0.0.1", foreignOrigin, "/assets/app.js")).toBeUndefined();
      expect(await admit("0.0.0.0", foreignOrigin)).toBeUndefined();
      expect(await admit("0.0.0.0", { host: "attacker.example:6280" })).toBe(403);
      expect(await admit("127.0.0.1", { host: "localhost:6280" })).toBeUndefined();
    });

    it("warns that server.publicOrigin is deprecated when it is in effect", () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
      const config: AppServerConfig = {
        enableWebInterface: false,
        enableMcpServer: false,
        enableApiServer: true,
        enableWorker: true,
        port: 6280,
        showLogo: false,
      };
      const appConfigWithOrigin: AppConfig = JSON.parse(JSON.stringify(appConfig));
      appConfigWithOrigin.server.publicOrigin = "https://docs.example.com";

      new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfigWithOrigin,
      );

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/publicOrigin is deprecated.*server\.publicUrl/),
      );
    });

    it("warns that server.publicOrigin is ignored when server.publicUrl is also set", () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
      const config: AppServerConfig = {
        enableWebInterface: false,
        enableMcpServer: false,
        enableApiServer: true,
        enableWorker: true,
        port: 6280,
        showLogo: false,
      };
      const appConfigWithBoth: AppConfig = JSON.parse(JSON.stringify(appConfig));
      appConfigWithBoth.server.publicOrigin = "https://old.example.com";
      appConfigWithBoth.server.publicUrl = "https://example.com/docs";

      new AppServer(
        mockDocService as DocumentManagementService,
        mockPipeline as IPipeline,
        eventBus,
        config,
        appConfigWithBoth,
      );

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("server.publicOrigin is ignored"),
      );
    });

    it("logs no warnings on a wildcard bind without authentication", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
      const config: AppServerConfig = {
        enableWebInterface: false,
        enableMcpServer: false,
        enableApiServer: true,
        enableWorker: false,
        port: 6280,
        showLogo: false,
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

      expect(warnSpy).not.toHaveBeenCalled();
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
      expect(mockMcpService.registerMcpService).toHaveBeenCalled();
      expect(mockTrpcService.registerTrpcService).toHaveBeenCalled();
      expect(mockWorkerService.registerWorkerService).toHaveBeenCalled();
      // Web interface: SPA static handler registered
      expect(mockFastify.get).toHaveBeenCalledWith("/", expect.any(Function));
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

      // Verify web interface (SPA static handler) was set up but not the
      // embedded worker
      expect(mockFastify.get).toHaveBeenCalledWith("/", expect.any(Function));
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
        expect.any(Object), // systemInfo
        undefined, // isWorkerConnected (embedded worker mode)
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

    it("should thread a remote worker mode and connectivity check into the tRPC context when using an external worker", async () => {
      const config: AppServerConfig = {
        enableWebInterface: false,
        enableMcpServer: false,
        enableApiServer: true,
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

      await server.start();

      expect(mockTrpcService.registerTrpcService).toHaveBeenCalledWith(
        mockFastify,
        mockPipeline,
        mockDocService,
        expect.any(Object), // eventBus
        expect.objectContaining({
          worker: { mode: "remote", url: "http://worker.example.com" },
        }),
        expect.any(Function), // isWorkerConnected, only populated in remote mode
      );
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
