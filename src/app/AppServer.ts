/**
 * Central application server that can be configured to run different combinations of services.
 * This replaces the separate server implementations with a single, modular approach.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { WebSocketServer } from "ws";
import { JwtAccessTokenVerifier } from "../auth/JwtAccessTokenVerifier";
import {
  buildProtectedResourceMetadata,
  protectedResourceMetadataPaths,
  protectedResourceMetadataUrl,
} from "../auth/protectedResourceMetadata";
import type { EventBusService } from "../events";
import { RemoteEventProxy } from "../events/RemoteEventProxy";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import {
  MCP_ENDPOINT_PATH,
  type McpEndpointAuth,
  registerMcpService,
} from "../services/mcpService";
import { buildSystemInfo, type SystemInfo } from "../services/systemInfo";
import { applyTrpcWebSocketHandler, registerTrpcService } from "../services/trpcService";
import { registerWorkerService, stopWorkerService } from "../services/workerService";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { TelemetryEvent, telemetry } from "../telemetry";
import { shouldEnableTelemetry } from "../telemetry/TelemetryConfig";
import { printBanner } from "../utils/banner";
import type { AppConfig } from "../utils/config";
import { logger } from "../utils/logger";
import { getProjectRoot } from "../utils/paths";
import {
  describePublicLocationWarnings,
  type PublicLocation,
  resolvePublicLocation,
} from "../utils/serverOrigin";
import type { AppServerConfig } from "./AppServerConfig";
import { injectBaseHref, servesSpaShell, stripBasePath } from "./basePath";
import {
  createOriginPolicy,
  isLoopbackBindHost,
  type OriginPolicy,
  sanitizeRequestedHeaders,
} from "./originPolicy";

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Central application server that provides modular service composition.
 */
export class AppServer {
  private server: FastifyInstance;
  /** Authentication for the MCP endpoint; set only when auth is enabled and MCP is served. */
  private mcpAuth: McpEndpointAuth | undefined;
  private readonly originPolicy: OriginPolicy;
  private serverConfig: AppServerConfig;
  private readonly appConfig: AppConfig;
  private readonly systemInfo: SystemInfo;
  private remoteEventProxy: RemoteEventProxy | null = null;
  private wss: WebSocketServer | null = null;
  /** Where clients reach this server; every advertised URL derives from it. */
  private readonly location: PublicLocation;

  constructor(
    private docService: IDocumentManagement,
    private pipeline: IPipeline,
    private eventBus: EventBusService,
    serverConfig: AppServerConfig,
    appConfig: AppConfig,
  ) {
    this.serverConfig = serverConfig;
    this.appConfig = appConfig;
    this.location = resolvePublicLocation(appConfig, serverConfig.port);
    for (const warning of describePublicLocationWarnings(appConfig)) {
      logger.warn(`⚠️  ${warning}`);
    }
    this.originPolicy = createOriginPolicy({
      publicHostname: this.hasPublicUrl()
        ? new URL(this.location.url).hostname
        : undefined,
      allowedOrigins: appConfig.server.allowedOrigins,
    });
    this.systemInfo = buildSystemInfo(serverConfig, appConfig, this.mcpEndpointUrl());
    const basePath = this.location.basePath;
    this.server = Fastify({
      logger: false, // Use our own logger
      // One set of root-mounted routes serves proxies that forward the base
      // path and proxies that strip it.
      rewriteUrl: (request) => stripBasePath(request.url ?? "/", basePath),
    });
  }

  /** Whether an operator configured where clients reach this server. */
  private hasPublicUrl(): boolean {
    return Boolean(
      this.appConfig.server.publicUrl?.trim() ||
        this.appConfig.server.publicOrigin?.trim(),
    );
  }

  /** Public URL of the MCP endpoint: the resource identifier and default token audience. */
  private mcpEndpointUrl(): string {
    return `${this.location.url}${MCP_ENDPOINT_PATH}`;
  }

  /**
   * Builds a cheap, synchronous connectivity check for the remote worker.
   * Returns `undefined` when the worker is embedded (the field is only
   * meaningful — and only ever populated — in remote worker mode).
   */
  private buildIsWorkerConnected(): (() => boolean) | undefined {
    if (!this.serverConfig.externalWorkerUrl) {
      return undefined;
    }
    return () => this.remoteEventProxy?.isActive() ?? false;
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
      await this.server.listen({
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

      this.logStartupInfo(this.location.url);
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

    // Authentication covers the MCP endpoint only; set it up before the
    // endpoint registers so every request goes through the same checks.
    await this.setupAuthentication();

    // On a loopback bind no reverse proxy stands in front of the API, so shield
    // it from foreign web pages (DNS rebinding) the same way as the MCP endpoint.
    if (isLoopbackBindHost(this.appConfig.server.host)) {
      this.server.addHook("onRequest", async (request, reply) => {
        const pathname = request.url.split("?")[0];
        if (pathname !== "/api" && !pathname.startsWith("/api/")) {
          return;
        }
        if (this.originPolicy.check(headerValue(request.headers.origin)) === "denied") {
          return reply.code(403).send({ error: "Forbidden: origin not allowed." });
        }
      });
    }

    // Conditionally enable services based on configuration
    if (this.serverConfig.enableMcpServer) {
      await this.enableMcpServer();
    }

    if (this.serverConfig.enableApiServer) {
      await this.enableTrpcApi();
    }

    if (this.serverConfig.enableWorker) {
      await this.enableWorker();
    }

    // Enable the web interface (must be last): the React SPA is served as a
    // static asset with a catch-all fallback for client-side routing, so
    // "enabling" it just means registering the static file handler after
    // every other route is in place. See setupStaticFiles/setNotFoundHandler.
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
   * Enable MCP server service.
   */
  private async enableMcpServer(): Promise<void> {
    await registerMcpService(
      this.server,
      {
        docService: this.docService,
        pipeline: this.pipeline,
        config: this.appConfig,
        originPolicy: this.originPolicy,
        location: this.location,
      },
      this.mcpAuth,
    );
    logger.debug("MCP server service enabled");
  }

  /**
   * Enable Pipeline RPC (tRPC) service.
   */
  private async enableTrpcApi(): Promise<void> {
    await registerTrpcService(
      this.server,
      this.pipeline,
      this.docService,
      this.eventBus,
      this.systemInfo,
      this.buildIsWorkerConnected(),
    );
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
    const checkOrigin = isLoopbackBindHost(this.appConfig.server.host);
    this.server.server.on("upgrade", (request, socket, head) => {
      // Upgrades bypass Fastify routing, so the API's origin shield is applied
      // here as well: a foreign page must not open the live-update stream.
      if (
        checkOrigin &&
        this.originPolicy.check(headerValue(request.headers.origin)) === "denied"
      ) {
        socket.write(
          "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        );
        socket.destroy();
        return;
      }
      // Let the WebSocket server handle all upgrade requests.
      // tRPC's WebSocket handler manages routing internally after connection is established.
      this.wss?.handleUpgrade(request, socket, head, (ws) => {
        this.wss?.emit("connection", ws, request);
      });
    });

    // Apply tRPC WebSocket handler to enable subscriptions
    applyTrpcWebSocketHandler(
      this.wss,
      this.pipeline,
      this.docService,
      this.eventBus,
      this.systemInfo,
      this.buildIsWorkerConnected(),
    );

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
   * Setup static file serving with root prefix as fallback, plus a SPA
   * fallback so client-side routing works for the React admin dashboard.
   */
  private async setupStaticFiles(): Promise<void> {
    const publicRoot = path.join(getProjectRoot(), "public");
    const indexHtmlPath = path.join(publicRoot, "index.html");
    const serveSpaShell = this.createSpaShellHandler(indexHtmlPath);

    await this.server.register(fastifyStatic, {
      root: publicRoot,
      prefix: "/",
      index: false,
    });

    // @fastify/static's wildcard route treats an exact "/" request as a
    // directory listing attempt and answers 403 (not 404) when index is
    // disabled, so it never reaches setNotFoundHandler below. Register an
    // explicit literal route for "/" - Fastify's router always prefers a
    // literal match over the plugin's "/*" wildcard, so this takes priority
    // without conflicting with it.
    this.server.get("/", serveSpaShell);
    // The shell must always carry its <base> element, so it is never served
    // raw by the static handler either.
    this.server.get("/index.html", serveSpaShell);

    // SPA fallback: serve the shell for any other unmatched GET request
    // (client-side routes like /libraries or /jobs) so deep links and page
    // refreshes work. API, MCP, metadata and asset paths get a JSON 404.
    this.server.setNotFoundHandler(async (request, reply) => {
      if (!servesSpaShell(request.method, request.url)) {
        reply.code(404).send({ error: "Not Found" });
        return;
      }

      await serveSpaShell(request, reply);
    });
  }

  /**
   * Creates a request handler that responds with the built SPA's
   * `index.html`, with a `<base>` element for the public URL's path, falling
   * back to a 404 if the file cannot be read (e.g. the frontend has not been
   * built yet).
   */
  private createSpaShellHandler(
    indexHtmlPath: string,
  ): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
    // Cache the built index.html after the first successful read — it never
    // changes while the server is running, so re-reading it from disk on every
    // deep-link/refresh is wasted I/O.
    let cachedHtml: string | null = null;
    return async (_request, reply) => {
      try {
        if (cachedHtml === null) {
          cachedHtml = injectBaseHref(
            await readFile(indexHtmlPath, "utf-8"),
            this.location.basePath,
          );
        }
        reply.type("text/html").send(cachedHtml);
      } catch (error) {
        logger.error(`❌ Failed to serve SPA shell from ${indexHtmlPath}: ${error}`);
        reply.code(404).send({ error: "Not Found" });
      }
    };
  }

  /**
   * Set up authentication for the MCP endpoint: this server is an OAuth 2.0
   * resource server that verifies tokens the configured issuer issued for it,
   * and publishes protected resource metadata so clients can find that issuer.
   *
   * @throws Error when authentication is enabled for the MCP endpoint without
   *   an issuer or a public URL, or when the issuer can't be discovered.
   */
  private async setupAuthentication(): Promise<void> {
    if (!this.appConfig.auth.enabled) {
      return;
    }
    if (!this.serverConfig.enableMcpServer) {
      logger.warn(
        "⚠️  Authentication is enabled, but this process serves no MCP endpoint, so it protects nothing here. The web UI and API are never protected by authentication.",
      );
      return;
    }

    const issuerUrl = this.appConfig.auth.issuerUrl?.trim();
    if (!issuerUrl) {
      throw new Error(
        "Authentication is enabled but auth.issuerUrl is not set. Set it to your identity provider's issuer URL.",
      );
    }
    if (!this.hasPublicUrl()) {
      throw new Error(
        "Authentication is enabled but no public URL is configured. Set server.publicUrl (or --public-url) to the URL clients use to reach this server.",
      );
    }

    const mcpEndpointUrl = this.mcpEndpointUrl();
    const verifier = await JwtAccessTokenVerifier.create({
      issuerUrl,
      audience: this.appConfig.auth.audience?.trim() || mcpEndpointUrl,
    });

    const document = buildProtectedResourceMetadata({ mcpEndpointUrl, issuerUrl });
    for (const metadataPath of protectedResourceMetadataPaths(this.location.basePath)) {
      this.server.route({
        method: ["GET", "HEAD"],
        url: metadataPath,
        handler: async (_request, reply) =>
          reply
            .header("Access-Control-Allow-Origin", "*")
            .type("application/json")
            .send(document),
      });
      this.server.options(metadataPath, async (request, reply) => {
        reply
          .header("Access-Control-Allow-Origin", "*")
          .header("Access-Control-Allow-Methods", "GET")
          .header("Access-Control-Max-Age", "600");
        const requestedHeaders = sanitizeRequestedHeaders(
          headerValue(request.headers["access-control-request-headers"]),
        );
        if (requestedHeaders) {
          reply.header("Access-Control-Allow-Headers", requestedHeaders);
        }
        return reply.code(204).send();
      });
    }

    this.mcpAuth = {
      verifier,
      resourceMetadataUrl: protectedResourceMetadataUrl(this.location),
    };
    logger.debug(`Protected resource metadata served for ${mcpEndpointUrl}`);
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
      // Advertise the tRPC API endpoint (mounted under /api, see trpcService),
      // not the bare origin, so it can be pasted straight into another
      // instance's `web --server-url`.
      logger.info(`🚀 Worker available at ${address}/api`);
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

    // MCP endpoint: always show if enabled
    if (this.serverConfig.enableMcpServer) {
      enabledServices.push(`MCP endpoint: ${this.mcpEndpointUrl()}`);
    }

    // Authentication boundary: say exactly what is and isn't protected
    if (this.mcpAuth) {
      enabledServices.push(
        `Authentication: protects ${this.mcpEndpointUrl()} only; the web UI and API are not protected`,
      );
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
