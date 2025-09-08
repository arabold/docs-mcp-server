/**
 * Central application server that can be configured to run different combinations of services.
 * This replaces the separate server implementations with a single, modular approach.
 */

import path from "node:path";
import formBody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Fastify, { type FastifyInstance } from "fastify";
import packageJson from "../../package.json";
import { ProxyAuthManager } from "../auth";
import { resolveEmbeddingContext } from "../cli/utils";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import { cleanupMcpService, registerMcpService } from "../services/mcpService";
import { registerTrpcService } from "../services/trpcService";
import { registerWebService } from "../services/webService";
import { registerWorkerService, stopWorkerService } from "../services/workerService";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { analytics, TelemetryEvent } from "../telemetry";
import { shouldEnableTelemetry } from "../telemetry/TelemetryConfig";
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
  private config: AppServerConfig;

  constructor(
    private docService: IDocumentManagement,
    private pipeline: IPipeline,
    config: AppServerConfig,
  ) {
    this.config = config;
    this.server = Fastify({
      logger: false, // Use our own logger
    });
  }

  /**
   * Validate the server configuration for invalid service combinations.
   */
  private validateConfig(): void {
    // Web interface needs either worker or external worker URL
    if (this.config.enableWebInterface) {
      if (!this.config.enableWorker && !this.config.externalWorkerUrl) {
        throw new Error(
          "Web interface requires either embedded worker (enableWorker: true) or external worker (externalWorkerUrl)",
        );
      }
    }

    // MCP server needs pipeline access (worker or external)
    if (this.config.enableMcpServer) {
      if (!this.config.enableWorker && !this.config.externalWorkerUrl) {
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

    // Initialize telemetry if enabled
    if (this.config.telemetry !== false && shouldEnableTelemetry()) {
      try {
        // Set global application context that will be included in all events
        if (analytics.isEnabled()) {
          // Resolve embedding configuration for global context
          const embeddingConfig = resolveEmbeddingContext();

          analytics.setGlobalContext({
            appVersion: packageJson.version,
            appPlatform: process.platform,
            appNodeVersion: process.version,
            appServicesEnabled: this.getActiveServicesList(),
            appAuthEnabled: Boolean(this.config.auth),
            appReadOnly: Boolean(this.config.readOnly),
            // Add embedding configuration to global context
            ...(embeddingConfig && {
              aiEmbeddingProvider: embeddingConfig.provider,
              aiEmbeddingModel: embeddingConfig.model,
              aiEmbeddingDimensions: embeddingConfig.dimensions,
            }),
          });

          // Track app start at the very beginning
          analytics.track(TelemetryEvent.APP_STARTED, {
            services: this.getActiveServicesList(),
            port: this.config.port,
            externalWorker: Boolean(this.config.externalWorkerUrl),
            // Include startup context when available
            ...(this.config.startupContext?.cliCommand && {
              cliCommand: this.config.startupContext.cliCommand,
            }),
            ...(this.config.startupContext?.mcpProtocol && {
              mcpProtocol: this.config.startupContext.mcpProtocol,
            }),
            ...(this.config.startupContext?.mcpTransport && {
              mcpTransport: this.config.startupContext.mcpTransport,
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
        port: this.config.port,
        host: this.config.host,
      });

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
      // Stop worker service if enabled
      if (this.config.enableWorker) {
        await stopWorkerService(this.pipeline);
      }

      // Cleanup MCP service if enabled
      if (this.mcpServer) {
        await cleanupMcpService(this.mcpServer);
      }

      // Track app shutdown
      if (analytics.isEnabled()) {
        analytics.track(TelemetryEvent.APP_SHUTDOWN, {
          graceful: true,
        });
      }

      // Shutdown telemetry service (this will flush remaining events)
      await analytics.shutdown();

      // Close Fastify server
      await this.server.close();
      logger.info("🛑 AppServer stopped");
    } catch (error) {
      logger.error(`❌ Failed to stop AppServer gracefully: ${error}`);

      // Track ungraceful shutdown
      if (analytics.isEnabled()) {
        analytics.track(TelemetryEvent.APP_SHUTDOWN, {
          graceful: false,
          error: error instanceof Error ? error.constructor.name : "UnknownError",
        });
        await analytics.shutdown();
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
        if (analytics.isEnabled()) {
          // Create an Error object from the rejection reason for better tracking
          const error = reason instanceof Error ? reason : new Error(String(reason));
          analytics.captureException(error, {
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
        if (analytics.isEnabled()) {
          analytics.captureException(error, {
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
      this.server.setErrorHandler(async (error, request, reply) => {
        if (analytics.isEnabled()) {
          analytics.captureException(error, {
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
    if (this.config.enableMcpServer) services.push("mcp");
    if (this.config.enableWebInterface) services.push("web");
    if (this.config.enableApiServer) services.push("api");
    if (this.config.enableWorker) services.push("worker");
    return services;
  }

  /**
   * Setup the server with plugins and conditionally enabled services.
   */
  private async setupServer(): Promise<void> {
    // Setup global error handling for telemetry
    this.setupErrorHandling();

    // Initialize authentication if enabled
    if (this.config.auth?.enabled) {
      await this.initializeAuth();
    }

    // Register core Fastify plugins
    await this.server.register(formBody);

    // Add request logging middleware for OAuth debugging
    if (this.config.auth?.enabled) {
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
    if (this.config.auth?.enabled && this.authManager) {
      await this.setupAuthMetadataEndpoint();
    }

    // Conditionally enable services based on configuration
    if (this.config.enableWebInterface) {
      await this.enableWebInterface();
    }

    if (this.config.enableMcpServer) {
      await this.enableMcpServer();
    }

    if (this.config.enableApiServer) {
      await this.enableTrpcApi();
    }

    if (this.config.enableWorker) {
      await this.enableWorker();
    }

    // Setup static file serving as fallback (must be last)
    if (this.config.enableWebInterface) {
      await this.setupStaticFiles();
    }
  }

  /**
   * Enable web interface service.
   */
  private async enableWebInterface(): Promise<void> {
    await registerWebService(this.server, this.docService, this.pipeline);
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
      this.config.readOnly,
      this.authManager || undefined,
    );
    logger.debug("MCP server service enabled");
  }

  /**
   * Enable Pipeline RPC (tRPC) service.
   */
  private async enableTrpcApi(): Promise<void> {
    await registerTrpcService(this.server, this.pipeline, this.docService);
    logger.debug("API server (tRPC) enabled");
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
    if (!this.config.auth) {
      return;
    }

    this.authManager = new ProxyAuthManager(this.config.auth);
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
    const baseUrl = new URL(`http://localhost:${this.config.port}`);
    this.authManager.registerRoutes(this.server, baseUrl);

    logger.debug("OAuth2 proxy endpoints registered");
  }

  /**
   * Log startup information showing which services are enabled.
   */
  private logStartupInfo(address: string): void {
    logger.info(`🚀 AppServer available at ${address}`);

    const enabledServices: string[] = [];

    if (this.config.enableWebInterface) {
      enabledServices.push(`Web interface: ${address}`);
    }

    if (this.config.enableMcpServer) {
      enabledServices.push(`MCP endpoints: ${address}/mcp, ${address}/sse`);
    }

    if (this.config.enableApiServer) {
      enabledServices.push(`API: ${address}/api`);
    }

    if (this.config.enableWorker) {
      enabledServices.push("Embedded worker: enabled");
    } else if (this.config.externalWorkerUrl) {
      enabledServices.push(`External worker: ${this.config.externalWorkerUrl}`);
    }

    for (const service of enabledServices) {
      logger.info(`   • ${service}`);
    }
  }
}
