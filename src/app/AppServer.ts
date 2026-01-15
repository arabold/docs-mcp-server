/**
 * Central application server that can be configured to run different combinations of services.
 * This replaces the separate server implementations with a single, modular approach.
 */

import path from "node:path";
import formBody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { WebSocketServer } from "ws";
import { ProxyAuthManager } from "../auth";
import type { EventBusService } from "../events";
import { RemoteEventProxy } from "../events/RemoteEventProxy";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import { cleanupMcpService, registerMcpService } from "../services/mcpService";
import { applyTrpcWebSocketHandler, registerTrpcService } from "../services/trpcService";
import { registerWebService } from "../services/webService";
import { registerWorkerService, stopWorkerService } from "../services/workerService";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { TelemetryEvent, telemetry } from "../telemetry";
import { shouldEnableTelemetry } from "../telemetry/TelemetryConfig";
import { printBanner } from "../utils/banner";
import type { AppConfig } from "../utils/config";
import { logger } from "../utils/logger";
import { getProjectRoot } from "../utils/paths";
import type { AppServerConfig } from "./AppServerConfig";

/**
 * Central application server that provides modular service composition.
 */
export class AppServer {
  private server: FastifyInstance;
  private mcpServer: McpServer | null = null;
  private authManager: ProxyAuthManager | null = null;
  private serverConfig: AppServerConfig;
  private readonly appConfig: AppConfig;
  private remoteEventProxy: RemoteEventProxy | null = null;
  private wss: WebSocketServer | null = null;

  constructor(
    private docService: IDocumentManagement,
    private pipeline: IPipeline,
    private eventBus: EventBusService,
    serverConfig: AppServerConfig,
    appConfig: AppConfig,
  ) {
    this.serverConfig = serverConfig;
    this.appConfig = appConfig;
    this.server = Fastify({
      logger: false, // Use our own logger
    });
  }

  /**
   * Validate the server configuration for invalid service combinations.
   */
  private validateConfig(): void {
    // Web interface needs either worker or external worker URL
    if (this.serverConfig.enableWebInterface) {
      if (!this.serverConfig.enableWorker && !this.serverConfig.externalWorkerUrl) {
        throw new Error(
          "Web interface requires either embedded worker (enableWorker: true) or external worker (externalWorkerUrl)",
        );
      }
    }

    // MCP server needs pipeline access (worker or external)
    if (this.serverConfig.enableMcpServer) {
      if (!this.serverConfig.enableWorker && !this.serverConfig.externalWorkerUrl) {
        throw new Error(
          "MCP server requires either embedded worker (enableWorker: true) or external worker (externalWorkerUrl)",
        );
      }
    }
  }

  /**
   * Start the application server with the configured services.
   */
  async start(): Promise<FastifyInstance> {
    this.validateConfig();

    // Get embedding configuration from the document service (source of truth)
    const embeddingConfig = this.docService.getActiveEmbeddingConfig();

    // Initialize telemetry if enabled
    if (this.appConfig.app.telemetryEnabled && shouldEnableTelemetry()) {
      try {
        // Set global application context that will be included in all events
        if (telemetry.isEnabled()) {
          telemetry.setGlobalContext({
            appVersion: __APP_VERSION__,
            appPlatform: process.platform,
            appNodeVersion: process.version,
            appServicesEnabled: this.getActiveServicesList(),
            appAuthEnabled: Boolean(this.appConfig.auth.enabled),
            appReadOnly: Boolean(this.appConfig.app.readOnly),
            // Add embedding configuration to global context
            ...(embeddingConfig && {
              aiEmbeddingProvider: embeddingConfig.provider,
              aiEmbeddingModel: embeddingConfig.model,
              aiEmbeddingDimensions: embeddingConfig.dimensions,
            }),
          });

          // Track app start at the very beginning
          telemetry.track(TelemetryEvent.APP_STARTED, {
            services: this.getActiveServicesList(),
            port: this.serverConfig.port,
            externalWorker: Boolean(this.serverConfig.externalWorkerUrl),
            // Include startup context when available
            ...(this.serverConfig.startupContext?.cliCommand && {
              cliCommand: this.serverConfig.startupContext.cliCommand,
            }),
            ...(this.serverConfig.startupContext?.mcpProtocol && {
              mcpProtocol: this.serverConfig.startupContext.mcpProtocol,
            }),
            ...(this.serverConfig.startupContext?.mcpTransport && {
              mcpTransport: this.serverConfig.startupContext.mcpTransport,
            }),
          });
        }
      } catch (error) {
        logger.debug(`Failed to initialize telemetry: ${error}`);
      }
    }

    await this.setupServer();

    try {
      const address = await this.server.listen({
        port: this.serverConfig.port,
        host: this.appConfig.server.host,
      });

      // Setup WebSocket server for tRPC subscriptions if API server is enabled
      if (this.serverConfig.enableApiServer) {
        this.setupWebSocketServer();
      }

      // Connect to remote worker after server is fully started
      if (this.remoteEventProxy) {
        // Don't await - let it connect in the background
        this.remoteEventProxy.connect();
      }

      this.logStartupInfo(address);
      return this.server;
    } catch (error) {
      logger.error(`❌ Failed to start AppServer: ${error}`);
      await this.server.close();
      throw error;
    }
  }

  /**
   * Stop the application server and cleanup all services.
   */
  async stop(): Promise<void> {
    try {
      // Disconnect remote event proxy if connected
      if (this.remoteEventProxy) {
        this.remoteEventProxy.disconnect();
      }

      // Stop worker service if enabled
      if (this.serverConfig.enableWorker) {
        await stopWorkerService(this.pipeline);
      }

      // Cleanup MCP service if enabled
      if (this.mcpServer) {
        await cleanupMcpService(this.mcpServer);
      }

      // Close WebSocket server if it exists
      if (this.wss) {
        // Forcibly close all active client connections before closing the server
        for (const client of this.wss.clients) {
          client.terminate();
        }

        await new Promise<void>((resolve, reject) => {
          this.wss?.close((err) => {
            if (err) {
              logger.error(`❌ Failed to close WebSocket server: ${err}`);
              reject(err);
            } else {
              logger.debug("WebSocket server closed");
              resolve();
            }
          });
        });
      }

      // Track app shutdown
      if (telemetry.isEnabled()) {
        telemetry.track(TelemetryEvent.APP_SHUTDOWN, {
          graceful: true,
        });
      }

      // Shutdown telemetry service (this will flush remaining events)
      await telemetry.shutdown();

      // Force close all connections to ensure immediate shutdown
      if (this.server.server) {
        this.server.server.closeAllConnections();
      }

      // Close Fastify server
      await this.server.close();
      logger.info("🛑 AppServer stopped");
    } catch (error) {
      logger.error(`❌ Failed to stop AppServer gracefully: ${error}`);

      // Track ungraceful shutdown
      if (telemetry.isEnabled()) {
        telemetry.track(TelemetryEvent.APP_SHUTDOWN, {
          graceful: false,
          error: error instanceof Error ? error.constructor.name : "UnknownError",
        });
        await telemetry.shutdown();
      }

      throw error;
    }
  }

  /**
   * Setup global error handling for telemetry
   */
  private setupErrorHandling(): void {
    // Only add listeners if they haven't been added yet (prevent duplicate listeners in tests)
    if (!process.listenerCount("unhandledRejection")) {
      // Catch unhandled promise rejections
      process.on("unhandledRejection", (reason) => {
        logger.error(`Unhandled Promise Rejection: ${reason}`);
        if (telemetry.isEnabled()) {
          // Create an Error object from the rejection reason for better tracking
          const error = reason instanceof Error ? reason : new Error(String(reason));
          telemetry.captureException(error, {
            error_category: "system",
            component: AppServer.constructor.name,
            context: "process_unhandled_rejection",
          });
        }
      });
    }

    if (!process.listenerCount("uncaughtException")) {
      // Catch uncaught exceptions
      process.on("uncaughtException", (error) => {
        logger.error(`Uncaught Exception: ${error.message}`);
        if (telemetry.isEnabled()) {
          telemetry.captureException(error, {
            error_category: "system",
            component: AppServer.constructor.name,
            context: "process_uncaught_exception",
          });
        }
        // Don't exit immediately, let the app attempt graceful shutdown
      });
    }

    // Setup Fastify error handler (if method exists - for testing compatibility)
    if (typeof this.server.setErrorHandler === "function") {
      this.server.setErrorHandler<FastifyError>(async (error, request, reply) => {
        if (telemetry.isEnabled()) {
          telemetry.captureException(error, {
            errorCategory: "http",
            component: "FastifyServer",
            statusCode: error.statusCode || 500,
            method: request.method,
            route: request.routeOptions?.url || request.url,
            context: "http_request_error",
          });
        }

        logger.error(`HTTP Error on ${request.method} ${request.url}: ${error.message}`);

        // Send appropriate error response
        const statusCode = error.statusCode || 500;
        reply.status(statusCode).send({
          error: "Internal Server Error",
          statusCode,
          message: statusCode < 500 ? error.message : "An unexpected error occurred",
        });
      });
    }
  }

  /**
   * Get list of currently active services for telemetry
   */
  private getActiveServicesList(): string[] {
    const services: string[] = [];
    if (this.serverConfig.enableMcpServer) services.push("mcp");
    if (this.serverConfig.enableWebInterface) services.push("web");
    if (this.serverConfig.enableApiServer) services.push("api");
    if (this.serverConfig.enableWorker) services.push("worker");
    return services;
  }

  /**
   * Setup the server with plugins and conditionally enabled services.
   */
  private async setupServer(): Promise<void> {
    // Setup global error handling for telemetry
    this.setupErrorHandling();

    // Setup remote event proxy if using an external worker
    this.setupRemoteEventProxy();

    // Initialize authentication if enabled
    if (this.appConfig.auth.enabled) {
      await this.initializeAuth();
    }

    // Register core Fastify plugins
    await this.server.register(formBody);

    // Add request logging middleware for OAuth debugging
    if (this.appConfig.auth.enabled) {
      this.server.addHook("onRequest", async (request) => {
        if (
          request.url.includes("/oauth") ||
          request.url.includes("/auth") ||
          request.url.includes("/register")
        ) {
          logger.debug(
            `${request.method} ${request.url} - Headers: ${JSON.stringify(request.headers)}`,
          );
        }
      });
    }

    // Add protected resource metadata endpoint for RFC9728 compliance
    if (this.appConfig.auth.enabled && this.authManager) {
      await this.setupAuthMetadataEndpoint();
    }

    // Conditionally enable services based on configuration
    if (this.serverConfig.enableWebInterface) {
      await this.enableWebInterface();
    }

    if (this.serverConfig.enableMcpServer) {
      await this.enableMcpServer();
    }

    if (this.serverConfig.enableApiServer) {
      await this.enableTrpcApi();
    }

    if (this.serverConfig.enableWorker) {
      await this.enableWorker();
    }

    // Setup static file serving as fallback (must be last)
    if (this.serverConfig.enableWebInterface) {
      await this.setupStaticFiles();
    }
  }

  /**
   * Initialize remote event proxy if using an external worker.
   * The proxy is created here but connection is deferred until after server starts.
   */
  private setupRemoteEventProxy(): void {
    // If using an external worker, create remote event proxy (connection happens later)
    if (this.serverConfig.externalWorkerUrl) {
      this.remoteEventProxy = new RemoteEventProxy(
        this.serverConfig.externalWorkerUrl,
        this.eventBus,
      );
      logger.debug(
        "Remote event proxy created for external worker (connection deferred)",
      );
    }
  }

  /**
   * Enable web interface service.
   */
  private async enableWebInterface(): Promise<void> {
    await registerWebService(
      this.server,
      this.docService,
      this.pipeline,
      this.eventBus,
      this.appConfig,
      this.serverConfig.externalWorkerUrl,
    );

    logger.debug("Web interface service enabled");
  }

  /**
   * Enable MCP server service.
   */
  private async enableMcpServer(): Promise<void> {
    this.mcpServer = await registerMcpService(
      this.server,
      this.docService,
      this.pipeline,
      this.appConfig,
      this.authManager || undefined,
    );
    logger.debug("MCP server service enabled");
  }

  /**
   * Enable Pipeline RPC (tRPC) service.
   */
  private async enableTrpcApi(): Promise<void> {
    await registerTrpcService(this.server, this.pipeline, this.docService, this.eventBus);
    logger.debug("API server (tRPC) enabled");
  }

  /**
   * Setup WebSocket server for tRPC subscriptions.
   * This is called after the HTTP server is listening.
   */
  private setupWebSocketServer(): void {
    // Ensure the underlying HTTP server is available
    if (!this.server.server) {
      throw new Error(
        "Cannot setup WebSocket server: HTTP server not available. " +
          "This method must be called after server.listen() completes.",
      );
    }

    // Create WebSocket server attached to the HTTP server
    this.wss = new WebSocketServer({
      noServer: true,
    });

    // Handle HTTP upgrade requests for WebSocket connections
    this.server.server.on("upgrade", (request, socket, head) => {
      // Let the WebSocket server handle all upgrade requests.
      // tRPC's WebSocket handler manages routing internally after connection is established.
      this.wss?.handleUpgrade(request, socket, head, (ws) => {
        this.wss?.emit("connection", ws, request);
      });
    });

    // Apply tRPC WebSocket handler to enable subscriptions
    applyTrpcWebSocketHandler(this.wss, this.pipeline, this.docService, this.eventBus);

    logger.debug("WebSocket server initialized for tRPC subscriptions");
  }

  /**
   * Enable worker service.
   */
  private async enableWorker(): Promise<void> {
    await registerWorkerService(this.pipeline);
    logger.debug("Worker service enabled");
  }

  /**
   * Setup static file serving with root prefix as fallback.
   */
  private async setupStaticFiles(): Promise<void> {
    await this.server.register(fastifyStatic, {
      root: path.join(getProjectRoot(), "public"),
      prefix: "/",
      index: false,
    });
  }

  /**
   * Initialize OAuth2/OIDC authentication manager.
   */
  private async initializeAuth(): Promise<void> {
    if (!this.appConfig.auth.enabled) {
      return;
    }

    if (!this.appConfig.auth.issuerUrl || !this.appConfig.auth.audience) {
      throw new Error(
        "Authentication is enabled but auth.issuerUrl or auth.audience is not configured.",
      );
    }

    this.authManager = new ProxyAuthManager({
      enabled: true,
      issuerUrl: this.appConfig.auth.issuerUrl,
      audience: this.appConfig.auth.audience,
      scopes: ["openid", "profile"],
    });
    await this.authManager.initialize();
    logger.debug("Proxy auth manager initialized");
  }

  /**
   * Setup OAuth2 endpoints using ProxyAuthManager.
   */
  private async setupAuthMetadataEndpoint(): Promise<void> {
    if (!this.authManager) {
      return;
    }

    // ProxyAuthManager handles all OAuth2 endpoints automatically
    const baseUrl = new URL(`http://localhost:${this.serverConfig.port}`);
    this.authManager.registerRoutes(this.server, baseUrl);

    logger.debug("OAuth2 proxy endpoints registered");
  }

  /**
   * Log startup information showing which services are enabled.
   */
  private logStartupInfo(address: string): void {
    // Print the ASCII art banner if enabled
    if (this.serverConfig.showLogo !== false) {
      printBanner();
    }

    // Determine the service mode
    const isWorkerOnly =
      this.serverConfig.enableWorker &&
      !this.serverConfig.enableWebInterface &&
      !this.serverConfig.enableMcpServer;
    const isWebOnly =
      this.serverConfig.enableWebInterface &&
      !this.serverConfig.enableWorker &&
      !this.serverConfig.enableMcpServer;
    const isMcpOnly =
      this.serverConfig.enableMcpServer &&
      !this.serverConfig.enableWebInterface &&
      !this.serverConfig.enableWorker;

    // Determine the main service name
    if (isWorkerOnly) {
      logger.info(`🚀 Worker available at ${address}`);
    } else if (isWebOnly) {
      logger.info(`🚀 Web interface available at ${address}`);
    } else if (isMcpOnly) {
      logger.info(`🚀 MCP server available at ${address}`);
    } else {
      logger.info(`🚀 Grounded Docs available at ${address}`);
    }

    const isCombined = !isWorkerOnly && !isWebOnly && !isMcpOnly;

    const enabledServices: string[] = [];

    // Web interface: only show if combined mode
    if (this.serverConfig.enableWebInterface && isCombined) {
      enabledServices.push(`Web interface: ${address}`);
    }

    // MCP endpoints: always show if enabled
    if (this.serverConfig.enableMcpServer) {
      enabledServices.push(`MCP endpoints: ${address}/mcp, ${address}/sse`);
    }

    // Worker: only show external worker URL (internal is implied)
    if (!this.serverConfig.enableWorker && this.serverConfig.externalWorkerUrl) {
      enabledServices.push(`Worker: ${this.serverConfig.externalWorkerUrl}`);
    }

    // Embeddings: only show if worker is enabled
    if (this.serverConfig.enableWorker) {
      const embeddingConfig = this.docService.getActiveEmbeddingConfig();
      if (embeddingConfig) {
        enabledServices.push(
          `Embeddings: ${embeddingConfig.provider}:${embeddingConfig.model}`,
        );
      } else {
        enabledServices.push(`Embeddings: disabled (full text search only)`);
      }
    }

    for (const service of enabledServices) {
      logger.info(`   • ${service}`);
    }
  }
}
