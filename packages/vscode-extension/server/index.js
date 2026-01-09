#!/usr/bin/env node
import "dotenv/config";
import { BedrockEmbeddings } from "@langchain/aws";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { VertexAIEmbeddings } from "@langchain/google-vertexai";
import { AzureOpenAIEmbeddings, OpenAIEmbeddings } from "@langchain/openai";
import { Embeddings } from "@langchain/core/embeddings";
import crypto, { randomUUID } from "node:crypto";
import fs, { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, URL as URL$1 } from "node:url";
import envPaths from "env-paths";
import "posthog-node";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import EventEmitter from "node:events";
import yaml from "yaml";
import { z } from "zod";
import formBody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { WebSocketServer } from "ws";
import { ProxyOAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createWSClient, createTRPCClient, splitLink, httpBatchLink, wsLink, createTRPCProxyClient } from "@trpc/client";
import superjson from "superjson";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z$1 } from "zod/v3";
import { chromium } from "playwright";
import mime from "mime";
import { HeaderGenerator } from "header-generator";
import fs$1 from "node:fs/promises";
import axios from "axios";
import { VirtualConsole, JSDOM } from "jsdom";
import psl from "psl";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import remarkGfm from "remark-gfm";
import remarkHtml from "remark-html";
import remarkParse from "remark-parse";
import TurndownService from "turndown";
import { unified } from "unified";
import * as cheerio from "cheerio";
import { gfm } from "@joplin/turndown-plugin-gfm";
import iconv from "iconv-lite";
import Parser from "tree-sitter";
import Python from "tree-sitter-python";
import TypeScript from "tree-sitter-typescript";
import * as semver from "semver";
import semver__default from "semver";
import Fuse from "fuse.js";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { initTRPC } from "@trpc/server";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { observable } from "@trpc/server/observable";
import { jsx, jsxs, Fragment } from "@kitajs/html/jsx-runtime";
import DOMPurify from "dompurify";
import { escapeHtml } from "@kitajs/html";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { v4 } from "uuid";
import { minimatch } from "minimatch";
import { execSync } from "node:child_process";
class StoreError extends Error {
  constructor(message, cause) {
    super(cause ? `${message} caused by ${cause}` : message);
    this.cause = cause;
    this.name = this.constructor.name;
    const causeError = cause instanceof Error ? cause : cause ? new Error(String(cause)) : void 0;
    if (causeError?.stack) {
      this.stack = causeError.stack;
    }
  }
}
class LibraryNotFoundInStoreError extends StoreError {
  constructor(library, similarLibraries = []) {
    let text = `Library ${library} not found in store.`;
    if (similarLibraries.length > 0) {
      text += ` Did you mean: ${similarLibraries.join(", ")}?`;
    }
    super(text);
    this.library = library;
    this.similarLibraries = similarLibraries;
  }
}
class VersionNotFoundInStoreError extends StoreError {
  constructor(library, version, availableVersions) {
    const versionText = version ? `Version ${version}` : "Version";
    let text = `${versionText} for library ${library} not found in store.`;
    if (availableVersions.length > 0) {
      text += ` Available versions: ${availableVersions.join(", ")}`;
    }
    super(text);
    this.library = library;
    this.version = version;
    this.availableVersions = availableVersions;
  }
}
class DimensionError extends StoreError {
  constructor(modelName, modelDimension, dbDimension) {
    super(
      `Model "${modelName}" produces ${modelDimension}-dimensional vectors, which exceeds the database's fixed dimension of ${dbDimension}. Please use a model with dimension ≤ ${dbDimension}.`
    );
    this.modelName = modelName;
    this.modelDimension = modelDimension;
    this.dbDimension = dbDimension;
  }
}
class ConnectionError extends StoreError {
}
class MissingCredentialsError extends StoreError {
  constructor(provider, missingCredentials) {
    super(
      `Missing credentials for ${provider} embedding provider. Required: ${missingCredentials.join(", ")}`
    );
    this.provider = provider;
  }
}
class FixedDimensionEmbeddings extends Embeddings {
  constructor(embeddings, targetDimension, providerAndModel, allowTruncate = false) {
    super({});
    this.embeddings = embeddings;
    this.targetDimension = targetDimension;
    this.allowTruncate = allowTruncate;
    const [providerOrModel, modelName] = providerAndModel.split(":");
    this.provider = modelName ? providerOrModel : "openai";
    this.model = modelName || providerOrModel;
  }
  provider;
  model;
  /**
   * Normalize a vector to the target dimension by truncating (for MRL models) or padding.
   * @throws {DimensionError} If vector is too large and provider doesn't support MRL
   */
  normalizeVector(vector) {
    const dimension = vector.length;
    if (dimension > this.targetDimension) {
      if (this.allowTruncate) {
        return vector.slice(0, this.targetDimension);
      }
      throw new DimensionError(
        `${this.provider}:${this.model}`,
        dimension,
        this.targetDimension
      );
    }
    if (dimension < this.targetDimension) {
      return [...vector, ...new Array(this.targetDimension - dimension).fill(0)];
    }
    return vector;
  }
  async embedQuery(text) {
    const vector = await this.embeddings.embedQuery(text);
    return this.normalizeVector(vector);
  }
  async embedDocuments(documents) {
    const vectors = await this.embeddings.embedDocuments(documents);
    return vectors.map((vector) => this.normalizeVector(vector));
  }
}
class UnsupportedProviderError extends Error {
  constructor(provider) {
    super(
      `❌ Unsupported embedding provider: ${provider}
   Supported providers: openai, vertex, gemini, aws, microsoft, sagemaker
   See README.md for configuration options or run with --help for more details.`
    );
    this.name = "UnsupportedProviderError";
  }
}
class ModelConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ModelConfigurationError";
  }
}
function areCredentialsAvailable(provider) {
  switch (provider) {
    case "openai":
      return !!process.env.OPENAI_API_KEY;
    case "vertex":
      return !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
    case "gemini":
      return !!process.env.GOOGLE_API_KEY;
    case "aws": {
      const region = process.env.BEDROCK_AWS_REGION || process.env.AWS_REGION;
      return !!region && (!!process.env.AWS_PROFILE || !!process.env.AWS_ACCESS_KEY_ID && !!process.env.AWS_SECRET_ACCESS_KEY);
    }
    case "microsoft":
      return !!(process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_API_INSTANCE_NAME && process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME && process.env.AZURE_OPENAI_API_VERSION);
    case "sagemaker": {
      const region = process.env.AWS_REGION;
      return !!region && (!!process.env.AWS_PROFILE || !!process.env.AWS_ACCESS_KEY_ID && !!process.env.AWS_SECRET_ACCESS_KEY);
    }
    default:
      return false;
  }
}
function createEmbeddingModel(providerAndModel, runtime) {
  const config = runtime?.config;
  const requestTimeoutMs = runtime?.requestTimeoutMs ?? config?.requestTimeoutMs;
  const vectorDimension = runtime?.vectorDimension ?? config?.vectorDimension;
  if (vectorDimension === void 0) {
    throw new ModelConfigurationError(
      "Embedding vector dimension is required; set DOCS_MCP_EMBEDDINGS_VECTOR_DIMENSION or embeddings.vectorDimension in config."
    );
  }
  const [providerOrModel, ...modelNameParts] = providerAndModel.split(":");
  const modelName = modelNameParts.join(":");
  const provider = modelName ? providerOrModel : "openai";
  const model = modelName || providerOrModel;
  const baseConfig = { stripNewLines: true };
  switch (provider) {
    case "openai": {
      if (!process.env.OPENAI_API_KEY) {
        throw new MissingCredentialsError("openai", ["OPENAI_API_KEY"]);
      }
      const config2 = {
        ...baseConfig,
        modelName: model,
        batchSize: 512,
        // OpenAI supports large batches
        timeout: requestTimeoutMs
      };
      const baseURL = process.env.OPENAI_API_BASE;
      config2.configuration = baseURL ? { baseURL, timeout: requestTimeoutMs } : { timeout: requestTimeoutMs };
      return new OpenAIEmbeddings(config2);
    }
    case "vertex": {
      if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        throw new MissingCredentialsError("vertex", ["GOOGLE_APPLICATION_CREDENTIALS"]);
      }
      return new VertexAIEmbeddings({
        ...baseConfig,
        model
        // e.g., "text-embedding-004"
      });
    }
    case "gemini": {
      if (!process.env.GOOGLE_API_KEY) {
        throw new MissingCredentialsError("gemini", ["GOOGLE_API_KEY"]);
      }
      const baseEmbeddings = new GoogleGenerativeAIEmbeddings({
        ...baseConfig,
        apiKey: process.env.GOOGLE_API_KEY,
        model
        // e.g., "gemini-embedding-exp-03-07"
      });
      return new FixedDimensionEmbeddings(
        baseEmbeddings,
        vectorDimension,
        providerAndModel,
        true
      );
    }
    case "aws": {
      const region = process.env.BEDROCK_AWS_REGION || process.env.AWS_REGION;
      const missingCredentials = [];
      if (!region) {
        missingCredentials.push("BEDROCK_AWS_REGION or AWS_REGION");
      }
      if (!process.env.AWS_PROFILE && !process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_SECRET_ACCESS_KEY) {
        missingCredentials.push(
          "AWS_PROFILE or (AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY)"
        );
      }
      if (missingCredentials.length > 0) {
        throw new MissingCredentialsError("aws", missingCredentials);
      }
      const credentials = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN
      } : void 0;
      return new BedrockEmbeddings({
        ...baseConfig,
        model,
        // e.g., "amazon.titan-embed-text-v1"
        region,
        ...credentials ? { credentials } : {}
      });
    }
    case "microsoft": {
      const missingCredentials = [];
      if (!process.env.AZURE_OPENAI_API_KEY) {
        missingCredentials.push("AZURE_OPENAI_API_KEY");
      }
      if (!process.env.AZURE_OPENAI_API_INSTANCE_NAME) {
        missingCredentials.push("AZURE_OPENAI_API_INSTANCE_NAME");
      }
      if (!process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME) {
        missingCredentials.push("AZURE_OPENAI_API_DEPLOYMENT_NAME");
      }
      if (!process.env.AZURE_OPENAI_API_VERSION) {
        missingCredentials.push("AZURE_OPENAI_API_VERSION");
      }
      if (missingCredentials.length > 0) {
        throw new MissingCredentialsError("microsoft", missingCredentials);
      }
      return new AzureOpenAIEmbeddings({
        ...baseConfig,
        azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
        azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
        azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
        azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
        deploymentName: model
      });
    }
    default:
      throw new UnsupportedProviderError(provider);
  }
}
const LogLevel = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};
const LOG_LEVEL_MAP = {
  ERROR: LogLevel.ERROR,
  WARN: LogLevel.WARN,
  INFO: LogLevel.INFO,
  DEBUG: LogLevel.DEBUG
};
function getLogLevelFromEnv() {
  const envLevel = process.env.LOG_LEVEL?.toUpperCase();
  return envLevel && envLevel in LOG_LEVEL_MAP ? LOG_LEVEL_MAP[envLevel] : LogLevel.INFO;
}
let currentLogLevel = getLogLevelFromEnv();
function setLogLevel(level) {
  currentLogLevel = level;
}
const logger = {
  /**
   * Logs a debug message if the current log level is DEBUG or higher.
   * @param message - The message to log.
   */
  debug: (message) => {
    if (currentLogLevel >= LogLevel.DEBUG && !process.env.VITEST_WORKER_ID) {
      console.debug(message);
    }
  },
  /**
   * Logs an info message if the current log level is INFO or higher.
   * @param message - The message to log.
   */
  info: (message) => {
    if (currentLogLevel >= LogLevel.INFO && !process.env.VITEST_WORKER_ID) {
      console.log(message);
    }
  },
  /**
   * Logs a warning message if the current log level is WARN or higher.
   * @param message - The message to log.
   */
  warn: (message) => {
    if (currentLogLevel >= LogLevel.WARN && !process.env.VITEST_WORKER_ID) {
      console.warn(message);
    }
  },
  /**
   * Logs an error message if the current log level is ERROR or higher (always logs).
   * @param message - The message to log.
   */
  error: (message) => {
    if (currentLogLevel >= LogLevel.ERROR && !process.env.VITEST_WORKER_ID) {
      console.error(message);
    }
  }
};
let projectRoot = null;
function getProjectRoot() {
  if (projectRoot) {
    return projectRoot;
  }
  const currentFilePath = fileURLToPath(import.meta.url);
  let currentDir = path.dirname(currentFilePath);
  while (true) {
    const packageJsonPath = path.join(currentDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      projectRoot = currentDir;
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error("Could not find project root containing package.json.");
    }
    currentDir = parentDir;
  }
}
function resolveStorePath(storePath) {
  let dbDir;
  if (storePath) {
    dbDir = path.resolve(storePath);
  } else {
    const projectRoot2 = getProjectRoot();
    const oldDbDir = path.join(projectRoot2, ".store");
    const oldDbPath = path.join(oldDbDir, "documents.db");
    const oldDbExists = fs.existsSync(oldDbPath);
    if (oldDbExists) {
      dbDir = oldDbDir;
    } else {
      const standardPaths = envPaths("docs-mcp-server", { suffix: "" });
      dbDir = standardPaths.data;
    }
  }
  try {
    fs.mkdirSync(dbDir, { recursive: true });
  } catch (error) {
    logger.warn(`⚠️  Failed to create database directory ${dbDir}: ${error}`);
  }
  return dbDir;
}
class TelemetryConfig {
  static instance;
  enabled = true;
  // Default to enabled
  constructor() {
  }
  isEnabled() {
    return this.enabled;
  }
  setEnabled(enabled) {
    this.enabled = enabled;
  }
  static getInstance() {
    if (!TelemetryConfig.instance) {
      TelemetryConfig.instance = new TelemetryConfig();
    }
    return TelemetryConfig.instance;
  }
}
function generateInstallationId(storePath) {
  try {
    const dataDir = resolveStorePath(storePath);
    const installationIdPath = path.join(dataDir, "installation.id");
    if (fs.existsSync(installationIdPath)) {
      const existingId = fs.readFileSync(installationIdPath, "utf8").trim();
      if (existingId) {
        return existingId;
      }
    }
    const newId = randomUUID();
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(installationIdPath, newId, "utf8");
    return newId;
  } catch {
    return randomUUID();
  }
}
function shouldEnableTelemetry() {
  return TelemetryConfig.getInstance().isEnabled();
}
var EventType = /* @__PURE__ */ ((EventType2) => {
  EventType2["JOB_STATUS_CHANGE"] = "JOB_STATUS_CHANGE";
  EventType2["JOB_PROGRESS"] = "JOB_PROGRESS";
  EventType2["LIBRARY_CHANGE"] = "LIBRARY_CHANGE";
  EventType2["JOB_LIST_CHANGE"] = "JOB_LIST_CHANGE";
  return EventType2;
})(EventType || {});
const ServerEventName = {
  [
    "JOB_STATUS_CHANGE"
    /* JOB_STATUS_CHANGE */
  ]: "job-status-change",
  [
    "JOB_PROGRESS"
    /* JOB_PROGRESS */
  ]: "job-progress",
  [
    "LIBRARY_CHANGE"
    /* LIBRARY_CHANGE */
  ]: "library-change",
  [
    "JOB_LIST_CHANGE"
    /* JOB_LIST_CHANGE */
  ]: "job-list-change"
};
var PipelineJobStatus = /* @__PURE__ */ ((PipelineJobStatus2) => {
  PipelineJobStatus2["QUEUED"] = "queued";
  PipelineJobStatus2["RUNNING"] = "running";
  PipelineJobStatus2["COMPLETED"] = "completed";
  PipelineJobStatus2["FAILED"] = "failed";
  PipelineJobStatus2["CANCELLING"] = "cancelling";
  PipelineJobStatus2["CANCELLED"] = "cancelled";
  return PipelineJobStatus2;
})(PipelineJobStatus || {});
function camelToSnakeCase(str) {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
function convertPropertiesToSnakeCase(obj) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = camelToSnakeCase(key);
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      result[snakeKey] = convertPropertiesToSnakeCase(value);
    } else if (Array.isArray(value)) {
      result[snakeKey] = value.map(
        (item) => item && typeof item === "object" && !(item instanceof Date) ? convertPropertiesToSnakeCase(item) : item
      );
    } else {
      result[snakeKey] = value;
    }
  }
  return result;
}
function addPostHogStandardProperties(properties) {
  const result = { ...properties };
  if (properties.sessionId) {
    result.$session_id = properties.sessionId;
    delete result.sessionId;
  }
  if (properties.startTime) {
    result.$start_timestamp = properties.startTime.toISOString();
    delete result.startTime;
  }
  if (properties.appVersion) {
    result.$app_version = properties.appVersion;
    delete result.appVersion;
  }
  return result;
}
class PostHogClient {
  client;
  enabled;
  // PostHog configuration
  static CONFIG = {
    host: "https://app.posthog.com",
    // Performance optimizations
    flushAt: 20,
    // Batch size - send after 20 events
    flushInterval: 1e4,
    // 10 seconds - send after time
    // Privacy settings
    disableGeoip: true,
    // Don't collect IP geolocation
    disableSessionRecording: true,
    // Never record sessions
    disableSurveys: true,
    // No user surveys
    // Data handling
    persistence: "memory"
    // No disk persistence for privacy
  };
  constructor(enabled) {
    this.enabled = enabled;
    if (!this.enabled) {
      return;
    }
    {
      logger.debug("PostHog API key not provided");
      this.enabled = false;
      return;
    }
  }
  /**
   * Send event to PostHog
   */
  capture(distinctId, event, properties) {
    if (!this.enabled || !this.client) return;
    try {
      const enhancedProperties = addPostHogStandardProperties(properties);
      const snakeCaseProperties = convertPropertiesToSnakeCase(enhancedProperties);
      this.client.capture({
        distinctId,
        event,
        properties: snakeCaseProperties
      });
      logger.debug(`PostHog event captured: ${event}`);
    } catch (error) {
      logger.debug(
        `PostHog capture error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  /**
   * Capture exception using PostHog's native error tracking
   */
  captureException(distinctId, error, properties) {
    if (!this.enabled || !this.client) return;
    try {
      const enhancedProperties = addPostHogStandardProperties(properties || {});
      const snakeCaseProperties = convertPropertiesToSnakeCase(enhancedProperties);
      this.client.captureException({
        error,
        distinctId,
        properties: snakeCaseProperties
      });
      logger.debug(`PostHog exception captured: ${error.constructor.name}`);
    } catch (captureError) {
      logger.debug(
        `PostHog captureException error: ${captureError instanceof Error ? captureError.message : "Unknown error"}`
      );
    }
  }
  /**
   * Graceful shutdown with event flushing
   */
  async shutdown() {
    if (this.client) {
      try {
        await this.client.shutdown();
        logger.debug("PostHog client shutdown complete");
      } catch (error) {
        logger.debug(
          `PostHog shutdown error: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }
  }
  /**
   * Check if client is enabled and ready
   */
  isEnabled() {
    return this.enabled && !!this.client;
  }
}
var TelemetryEvent = /* @__PURE__ */ ((TelemetryEvent2) => {
  TelemetryEvent2["APP_STARTED"] = "app_started";
  TelemetryEvent2["APP_SHUTDOWN"] = "app_shutdown";
  TelemetryEvent2["CLI_COMMAND"] = "cli_command";
  TelemetryEvent2["TOOL_USED"] = "tool_used";
  TelemetryEvent2["PIPELINE_JOB_STARTED"] = "pipeline_job_started";
  TelemetryEvent2["PIPELINE_JOB_COMPLETED"] = "pipeline_job_completed";
  TelemetryEvent2["PIPELINE_JOB_FAILED"] = "pipeline_job_failed";
  return TelemetryEvent2;
})(TelemetryEvent || {});
class Telemetry {
  postHogClient;
  enabled;
  distinctId;
  globalContext = {};
  /**
   * Create a new Telemetry instance with proper initialization
   * This is the recommended way to create Telemetry instances
   */
  static create() {
    const config = TelemetryConfig.getInstance();
    const shouldEnable = config.isEnabled() && false;
    const telemetry2 = new Telemetry(shouldEnable);
    if (telemetry2.isEnabled()) {
      logger.debug("Telemetry enabled");
    } else if (!config.isEnabled()) {
      logger.debug("Telemetry disabled (user preference)");
    } else {
      logger.debug("Telemetry disabled (no API key configured)");
    }
    return telemetry2;
  }
  /**
   * Private constructor - use Telemetry.create() instead
   */
  constructor(enabled = true) {
    this.enabled = enabled;
    this.distinctId = generateInstallationId();
    this.postHogClient = new PostHogClient(this.enabled);
  }
  /**
   * Set global application context that will be included in all events
   */
  setGlobalContext(context) {
    this.globalContext = { ...context };
  }
  /**
   * Get current global context
   */
  getGlobalContext() {
    return { ...this.globalContext };
  }
  track(event, properties = {}) {
    if (!this.enabled) return;
    const enrichedProperties = {
      ...this.globalContext,
      ...properties,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    logger.debug(`Tracking event: ${event}`);
    this.postHogClient.capture(this.distinctId, event, enrichedProperties);
  }
  /**
   * Capture exception using PostHog's native error tracking with global context
   */
  captureException(error, properties = {}) {
    if (!this.enabled) return;
    const enrichedProperties = {
      ...this.globalContext,
      ...properties,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    logger.debug(
      `Capturing exception: ${error instanceof Error ? error.message : String(error)}`
    );
    this.postHogClient.captureException(
      this.distinctId,
      error instanceof Error ? error : new Error(String(error)),
      enrichedProperties
    );
  }
  /**
   * Graceful shutdown with event flushing
   */
  async shutdown() {
    if (!this.enabled) return;
    await this.postHogClient.shutdown();
  }
  /**
   * Check if telemetry is enabled
   */
  isEnabled() {
    return this.enabled;
  }
}
let telemetryInstance = null;
function getTelemetryInstance() {
  if (!telemetryInstance) {
    telemetryInstance = Telemetry.create();
  }
  return telemetryInstance;
}
function initTelemetry(options) {
  TelemetryConfig.getInstance().setEnabled(options.enabled);
  generateInstallationId(options.storePath);
  telemetryInstance = Telemetry.create();
}
const telemetry = new Proxy({}, {
  get(target, prop) {
    if (!target.isEnabled) {
      const instance = getTelemetryInstance();
      Object.setPrototypeOf(target, Object.getPrototypeOf(instance));
      Object.assign(target, instance);
    }
    return target[prop];
  }
});
class TelemetryService {
  eventBus;
  unsubscribers = [];
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.setupEventListeners();
  }
  /**
   * Sets up event listeners for pipeline events.
   */
  setupEventListeners() {
    const unsubStatusChange = this.eventBus.on(
      EventType.JOB_STATUS_CHANGE,
      this.handleJobStatusChange.bind(this)
    );
    const unsubProgress = this.eventBus.on(
      EventType.JOB_PROGRESS,
      this.handleJobProgress.bind(this)
    );
    this.unsubscribers.push(unsubStatusChange, unsubProgress);
    logger.debug("TelemetryService initialized and listening to events");
  }
  /**
   * Handles job status change events and tracks them to analytics.
   * Only tracks events for meaningful state transitions: started, completed, and failed.
   */
  handleJobStatusChange(job) {
    const duration = job.startedAt ? Date.now() - job.startedAt.getTime() : null;
    const queueWaitTime = job.startedAt && job.createdAt ? job.startedAt.getTime() - job.createdAt.getTime() : null;
    switch (job.status) {
      case PipelineJobStatus.RUNNING:
        telemetry.track(TelemetryEvent.PIPELINE_JOB_STARTED, {
          jobId: job.id,
          library: job.library,
          hasVersion: !!job.version,
          maxPagesConfigured: job.progressMaxPages || 0,
          queueWaitTimeMs: queueWaitTime
        });
        break;
      case PipelineJobStatus.COMPLETED:
        telemetry.track(TelemetryEvent.PIPELINE_JOB_COMPLETED, {
          jobId: job.id,
          library: job.library,
          durationMs: duration,
          pagesProcessed: job.progressPages || 0,
          maxPagesConfigured: job.progressMaxPages || 0,
          hasVersion: !!job.version,
          throughputPagesPerSecond: duration && job.progressPages ? Math.round(job.progressPages / duration * 1e3) : 0
        });
        break;
      case PipelineJobStatus.FAILED:
        telemetry.track(TelemetryEvent.PIPELINE_JOB_FAILED, {
          jobId: job.id,
          library: job.library,
          durationMs: duration,
          pagesProcessed: job.progressPages || 0,
          maxPagesConfigured: job.progressMaxPages || 0,
          hasVersion: !!job.version,
          hasError: !!job.error,
          errorMessage: job.error?.message
        });
        break;
    }
  }
  /**
   * Handles job progress events. Currently a no-op but can be extended
   * for progress-specific telemetry tracking.
   */
  handleJobProgress(_event) {
  }
  /**
   * Cleans up event listeners.
   */
  shutdown() {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
    logger.debug("TelemetryService shut down");
  }
}
class EventBusService {
  emitter;
  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
  }
  /**
   * Emit an event to all subscribers.
   */
  emit(eventType, payload) {
    logger.debug(`Event emitted: ${eventType}`);
    this.emitter.emit(eventType, payload);
  }
  /**
   * Subscribe to events of a specific type.
   * Returns an unsubscribe function.
   */
  on(eventType, listener) {
    this.emitter.on(eventType, listener);
    return () => this.emitter.off(eventType, listener);
  }
  /**
   * Subscribe to events once (auto-unsubscribes after first event).
   */
  once(eventType, listener) {
    this.emitter.once(eventType, listener);
  }
  /**
   * Remove a specific listener.
   */
  off(eventType, listener) {
    this.emitter.off(eventType, listener);
  }
  /**
   * Remove all listeners for a specific event type, or all listeners if no type specified.
   */
  removeAllListeners(eventType) {
    if (eventType === void 0) {
      this.emitter.removeAllListeners();
    } else {
      this.emitter.removeAllListeners(eventType);
    }
  }
  /**
   * Get the count of listeners for a specific event type.
   */
  listenerCount(eventType) {
    return this.emitter.listenerCount(eventType);
  }
}
const DEFAULT_CONFIG = {
  app: {
    storePath: "",
    telemetryEnabled: true,
    readOnly: false,
    embeddingModel: "text-embedding-3-small"
  },
  server: {
    protocol: "auto",
    host: "127.0.0.1",
    ports: {
      default: 6280,
      worker: 8080,
      mcp: 6280,
      web: 6281
    },
    heartbeatMs: 3e4
  },
  auth: {
    enabled: false,
    issuerUrl: "",
    audience: ""
  },
  scraper: {
    maxPages: 1e3,
    maxDepth: 3,
    maxConcurrency: 3,
    pageTimeoutMs: 5e3,
    browserTimeoutMs: 3e4,
    fetcher: {
      maxRetries: 6,
      baseDelayMs: 1e3,
      maxCacheItems: 200,
      maxCacheItemSizeBytes: 500 * 1024
    }
  },
  splitter: {
    minChunkSize: 500,
    preferredChunkSize: 1500,
    maxChunkSize: 5e3,
    treeSitterSizeLimit: 3e4,
    json: {
      maxNestingDepth: 5,
      maxChunks: 1e3
    }
  },
  embeddings: {
    batchSize: 100,
    batchChars: 5e4,
    requestTimeoutMs: 3e4,
    initTimeoutMs: 3e4,
    vectorDimension: 1536
  },
  db: {
    migrationMaxRetries: 5,
    migrationRetryDelayMs: 300
  },
  search: {
    overfetchFactor: 2,
    weightVec: 1,
    weightFts: 1,
    vectorMultiplier: 10
  },
  sandbox: {
    defaultTimeoutMs: 5e3
  },
  assembly: {
    maxParentChainDepth: 10,
    childLimit: 3,
    precedingSiblingsLimit: 1,
    subsequentSiblingsLimit: 2
  }
};
const AppConfigSchema = z.object({
  app: z.object({
    storePath: z.string().default(DEFAULT_CONFIG.app.storePath),
    telemetryEnabled: z.coerce.boolean().default(DEFAULT_CONFIG.app.telemetryEnabled),
    readOnly: z.coerce.boolean().default(DEFAULT_CONFIG.app.readOnly),
    embeddingModel: z.string().default(DEFAULT_CONFIG.app.embeddingModel)
  }).default(DEFAULT_CONFIG.app),
  server: z.object({
    protocol: z.string().default(DEFAULT_CONFIG.server.protocol),
    host: z.string().default(DEFAULT_CONFIG.server.host),
    ports: z.object({
      default: z.coerce.number().int().default(DEFAULT_CONFIG.server.ports.default),
      worker: z.coerce.number().int().default(DEFAULT_CONFIG.server.ports.worker),
      mcp: z.coerce.number().int().default(DEFAULT_CONFIG.server.ports.mcp),
      web: z.coerce.number().int().default(DEFAULT_CONFIG.server.ports.web)
    }).default(DEFAULT_CONFIG.server.ports),
    heartbeatMs: z.coerce.number().int().default(DEFAULT_CONFIG.server.heartbeatMs)
  }).default(DEFAULT_CONFIG.server),
  auth: z.object({
    enabled: z.coerce.boolean().default(DEFAULT_CONFIG.auth.enabled),
    issuerUrl: z.string().default(DEFAULT_CONFIG.auth.issuerUrl),
    audience: z.string().default(DEFAULT_CONFIG.auth.audience)
  }).default(DEFAULT_CONFIG.auth),
  scraper: z.object({
    maxPages: z.coerce.number().int().default(DEFAULT_CONFIG.scraper.maxPages),
    maxDepth: z.coerce.number().int().default(DEFAULT_CONFIG.scraper.maxDepth),
    maxConcurrency: z.coerce.number().int().default(DEFAULT_CONFIG.scraper.maxConcurrency),
    pageTimeoutMs: z.coerce.number().int().default(DEFAULT_CONFIG.scraper.pageTimeoutMs),
    browserTimeoutMs: z.coerce.number().int().default(DEFAULT_CONFIG.scraper.browserTimeoutMs),
    fetcher: z.object({
      maxRetries: z.coerce.number().int().default(DEFAULT_CONFIG.scraper.fetcher.maxRetries),
      baseDelayMs: z.coerce.number().int().default(DEFAULT_CONFIG.scraper.fetcher.baseDelayMs),
      maxCacheItems: z.coerce.number().int().default(DEFAULT_CONFIG.scraper.fetcher.maxCacheItems),
      maxCacheItemSizeBytes: z.coerce.number().int().default(DEFAULT_CONFIG.scraper.fetcher.maxCacheItemSizeBytes)
    }).default(DEFAULT_CONFIG.scraper.fetcher)
  }).default(DEFAULT_CONFIG.scraper),
  splitter: z.object({
    minChunkSize: z.coerce.number().int().default(DEFAULT_CONFIG.splitter.minChunkSize),
    preferredChunkSize: z.coerce.number().int().default(DEFAULT_CONFIG.splitter.preferredChunkSize),
    maxChunkSize: z.coerce.number().int().default(DEFAULT_CONFIG.splitter.maxChunkSize),
    treeSitterSizeLimit: z.coerce.number().int().default(DEFAULT_CONFIG.splitter.treeSitterSizeLimit),
    json: z.object({
      maxNestingDepth: z.coerce.number().int().default(DEFAULT_CONFIG.splitter.json.maxNestingDepth),
      maxChunks: z.coerce.number().int().default(DEFAULT_CONFIG.splitter.json.maxChunks)
    }).default(DEFAULT_CONFIG.splitter.json)
  }).default(DEFAULT_CONFIG.splitter),
  embeddings: z.object({
    batchSize: z.coerce.number().int().default(DEFAULT_CONFIG.embeddings.batchSize),
    batchChars: z.coerce.number().int().default(DEFAULT_CONFIG.embeddings.batchChars),
    requestTimeoutMs: z.coerce.number().int().default(DEFAULT_CONFIG.embeddings.requestTimeoutMs),
    initTimeoutMs: z.coerce.number().int().default(DEFAULT_CONFIG.embeddings.initTimeoutMs),
    vectorDimension: z.coerce.number().int().default(DEFAULT_CONFIG.embeddings.vectorDimension)
  }).default(DEFAULT_CONFIG.embeddings),
  db: z.object({
    migrationMaxRetries: z.coerce.number().int().default(DEFAULT_CONFIG.db.migrationMaxRetries),
    migrationRetryDelayMs: z.coerce.number().int().default(DEFAULT_CONFIG.db.migrationRetryDelayMs)
  }).default(DEFAULT_CONFIG.db),
  search: z.object({
    overfetchFactor: z.coerce.number().default(DEFAULT_CONFIG.search.overfetchFactor),
    weightVec: z.coerce.number().default(DEFAULT_CONFIG.search.weightVec),
    weightFts: z.coerce.number().default(DEFAULT_CONFIG.search.weightFts),
    vectorMultiplier: z.coerce.number().int().default(DEFAULT_CONFIG.search.vectorMultiplier)
  }).default(DEFAULT_CONFIG.search),
  sandbox: z.object({
    defaultTimeoutMs: z.coerce.number().int().default(DEFAULT_CONFIG.sandbox.defaultTimeoutMs)
  }).default(DEFAULT_CONFIG.sandbox),
  assembly: z.object({
    maxParentChainDepth: z.coerce.number().int().default(DEFAULT_CONFIG.assembly.maxParentChainDepth),
    childLimit: z.coerce.number().int().default(DEFAULT_CONFIG.assembly.childLimit),
    precedingSiblingsLimit: z.coerce.number().int().default(DEFAULT_CONFIG.assembly.precedingSiblingsLimit),
    subsequentSiblingsLimit: z.coerce.number().int().default(DEFAULT_CONFIG.assembly.subsequentSiblingsLimit)
  }).default(DEFAULT_CONFIG.assembly)
});
const defaults = AppConfigSchema.parse({});
const configMappings = [
  { path: ["server", "protocol"], env: ["DOCS_MCP_PROTOCOL"], cli: "protocol" },
  { path: ["app", "storePath"], env: ["DOCS_MCP_STORE_PATH"], cli: "storePath" },
  { path: ["app", "telemetryEnabled"], env: ["DOCS_MCP_TELEMETRY"] },
  // Handled via --no-telemetry in CLI usually
  { path: ["app", "readOnly"], env: ["DOCS_MCP_READ_ONLY"], cli: "readOnly" },
  // Ports - Special handling for shared env vars is done in mapping logic
  {
    path: ["server", "ports", "default"],
    env: ["DOCS_MCP_PORT", "PORT"],
    cli: "port"
  },
  {
    path: ["server", "ports", "worker"],
    env: ["DOCS_MCP_PORT", "PORT"],
    cli: "port"
  },
  {
    path: ["server", "ports", "mcp"],
    env: ["DOCS_MCP_PORT", "PORT"],
    cli: "port"
  },
  {
    path: ["server", "ports", "web"],
    env: ["DOCS_MCP_WEB_PORT", "DOCS_MCP_PORT", "PORT"],
    cli: "port"
  },
  { path: ["server", "host"], env: ["DOCS_MCP_HOST", "HOST"], cli: "host" },
  {
    path: ["app", "embeddingModel"],
    env: ["DOCS_MCP_EMBEDDING_MODEL"],
    cli: "embeddingModel"
  },
  { path: ["auth", "enabled"], env: ["DOCS_MCP_AUTH_ENABLED"], cli: "authEnabled" },
  {
    path: ["auth", "issuerUrl"],
    env: ["DOCS_MCP_AUTH_ISSUER_URL"],
    cli: "authIssuerUrl"
  },
  {
    path: ["auth", "audience"],
    env: ["DOCS_MCP_AUTH_AUDIENCE"],
    cli: "authAudience"
  }
  // Add other mappings as needed for CLI/Env overrides
];
const systemPaths = envPaths("docs-mcp-server", { suffix: "" });
function loadConfig(cliArgs = {}, options = {}) {
  const explicitPath = cliArgs.config || options.configPath || process.env.DOCS_MCP_CONFIG;
  let configPath;
  let isReadOnlyConfig = false;
  if (explicitPath) {
    configPath = explicitPath;
    isReadOnlyConfig = true;
  } else {
    configPath = path.join(systemPaths.config, "config.yaml");
    isReadOnlyConfig = false;
  }
  logger.debug(`Using config file: ${configPath}`);
  const fileConfig = loadConfigFile(configPath) || {};
  const baseConfig = deepMerge(defaults, fileConfig);
  if (!isReadOnlyConfig) {
    try {
      saveConfigFile(configPath, baseConfig);
    } catch (error) {
      console.warn(`Failed to save config file to ${configPath}: ${error}`);
    }
  }
  const envConfig = mapEnvToConfig();
  const cliConfig = mapCliToConfig(cliArgs);
  const mergedInput = deepMerge(
    baseConfig,
    deepMerge(envConfig, cliConfig)
  );
  if (!getAtPath(mergedInput, ["app", "embeddingModel"]) && process.env.OPENAI_API_KEY) {
    setAtPath(mergedInput, ["app", "embeddingModel"], "text-embedding-3-small");
  }
  return AppConfigSchema.parse(mergedInput);
}
function loadConfigFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, "utf8");
    if (filePath.endsWith(".json")) {
      return JSON.parse(content);
    }
    return yaml.parse(content) || {};
  } catch (error) {
    console.warn(`Failed to parse config file ${filePath}: ${error}`);
    return null;
  }
}
function saveConfigFile(filePath, config) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  let content;
  if (filePath.endsWith(".json")) {
    content = JSON.stringify(config, null, 2);
  } else {
    content = yaml.stringify(config);
  }
  logger.debug(`Updating config file at ${filePath}`);
  fs.writeFileSync(filePath, content, "utf8");
}
function mapEnvToConfig() {
  const config = {};
  for (const mapping of configMappings) {
    if (mapping.env) {
      for (const envVar of mapping.env) {
        if (process.env[envVar] !== void 0) {
          setAtPath(config, mapping.path, process.env[envVar]);
          break;
        }
      }
    }
  }
  return config;
}
function mapCliToConfig(args) {
  const config = {};
  for (const mapping of configMappings) {
    if (mapping.cli && args[mapping.cli] !== void 0) {
      setAtPath(config, mapping.path, args[mapping.cli]);
    }
  }
  return config;
}
function setAtPath(obj, pathArr, value) {
  let current = obj;
  for (let i = 0; i < pathArr.length - 1; i++) {
    const key = pathArr[i];
    if (current[key] === void 0 || typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key];
  }
  current[pathArr[pathArr.length - 1]] = value;
}
function getAtPath(obj, pathArr) {
  let current = obj;
  for (const key of pathArr) {
    if (typeof current !== "object" || current === null) return void 0;
    current = current[key];
  }
  return current;
}
function deepMerge(target, source) {
  if (typeof target !== "object" || target === null) return source;
  if (typeof source !== "object" || source === null) return target;
  const t2 = target;
  const s = source;
  const output = { ...t2 };
  for (const key of Object.keys(s)) {
    const sValue = s[key];
    const tValue = t2[key];
    if (typeof sValue === "object" && sValue !== null && typeof tValue === "object" && tValue !== null && key in t2) {
      output[key] = deepMerge(tValue, sValue);
    } else {
      output[key] = sValue;
    }
  }
  return output;
}
function createConfigCommand(cli) {
  cli.command(
    "config",
    "Fetch a URL and transform it into Markdown format",
    (yargs2) => yargs2,
    (argv) => {
      const config = loadConfig(argv, {
        configPath: argv.config,
        searchDir: argv.storePath
      });
      console.log(JSON.stringify(config, null, 2));
    }
  );
}
function createAuthMiddleware(authManager) {
  return async (request, reply) => {
    try {
      const authContext = await authManager.createAuthContext(
        request.headers.authorization || "",
        request
      );
      request.auth = authContext;
      const isAuthEnabled = authManager.authConfig.enabled;
      if (!isAuthEnabled) {
        logger.debug("Authentication disabled, allowing request");
        return;
      }
      if (!authContext.authenticated) {
        const hasAuthHeader = !!request.headers.authorization;
        if (hasAuthHeader) {
          logger.debug("Token validation failed");
          reply.status(401).header(
            "WWW-Authenticate",
            'Bearer realm="MCP Server", error="invalid_token"'
          ).send({
            error: "invalid_token",
            error_description: "The access token is invalid"
          });
          return;
        } else {
          logger.debug("Missing authorization header");
          reply.status(401).header("WWW-Authenticate", 'Bearer realm="MCP Server"').send({
            error: "unauthorized",
            error_description: "Authorization header required"
          });
          return;
        }
      }
      logger.debug(
        `Authentication successful for subject: ${authContext.subject || "anonymous"}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication failed";
      logger.debug(`Authentication error: ${message}`);
      reply.status(401).header("WWW-Authenticate", 'Bearer realm="MCP Server", error="invalid_token"').send({
        error: "invalid_token",
        error_description: "Token validation failed"
      });
    }
  };
}
class ProxyAuthManager {
  constructor(config) {
    this.config = config;
  }
  proxyProvider = null;
  discoveredEndpoints = null;
  jwks = null;
  /**
   * Get the authentication configuration
   */
  get authConfig() {
    return this.config;
  }
  /**
   * Initialize the proxy auth manager with the configured OAuth provider.
   */
  async initialize() {
    if (!this.config.enabled) {
      logger.debug("Authentication disabled, skipping proxy auth manager initialization");
      return;
    }
    if (!this.config.issuerUrl || !this.config.audience) {
      throw new Error("Issuer URL and Audience are required when auth is enabled");
    }
    try {
      logger.info("🔐 Initializing OAuth2 proxy authentication...");
      this.discoveredEndpoints = await this.discoverEndpoints();
      if (this.discoveredEndpoints.jwksUri) {
        this.jwks = createRemoteJWKSet(new URL(this.discoveredEndpoints.jwksUri));
        logger.debug(`JWKS configured from: ${this.discoveredEndpoints.jwksUri}`);
      }
      const capabilities = [];
      if (this.discoveredEndpoints.jwksUri) capabilities.push("JWT validation via JWKS");
      if (this.discoveredEndpoints.userinfoUrl)
        capabilities.push("opaque token validation via userinfo");
      logger.debug(`Token validation capabilities: ${capabilities.join(", ")}`);
      if (capabilities.length === 0) {
        logger.warn(
          "⚠️  No token validation mechanisms available - authentication may fail"
        );
      }
      this.proxyProvider = new ProxyOAuthServerProvider({
        endpoints: {
          authorizationUrl: this.discoveredEndpoints.authorizationUrl,
          tokenUrl: this.discoveredEndpoints.tokenUrl,
          revocationUrl: this.discoveredEndpoints.revocationUrl,
          registrationUrl: this.discoveredEndpoints.registrationUrl
        },
        verifyAccessToken: this.verifyAccessToken.bind(this),
        getClient: this.getClient.bind(this)
      });
      logger.info("✅ OAuth2 proxy authentication initialized successfully");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error(`❌ Failed to initialize OAuth2 proxy authentication: ${message}`);
      throw new Error(`Proxy authentication initialization failed: ${message}`);
    }
  }
  /**
   * Register OAuth2 endpoints on the Fastify server.
   * This manually implements the necessary OAuth2 endpoints using the proxy provider.
   */
  registerRoutes(server, baseUrl) {
    if (!this.proxyProvider) {
      throw new Error("Proxy provider not initialized");
    }
    server.get("/.well-known/oauth-authorization-server", async (_request, reply) => {
      const metadata = {
        issuer: baseUrl.origin,
        authorization_endpoint: `${baseUrl.origin}/oauth/authorize`,
        token_endpoint: `${baseUrl.origin}/oauth/token`,
        revocation_endpoint: `${baseUrl.origin}/oauth/revoke`,
        registration_endpoint: `${baseUrl.origin}/oauth/register`,
        scopes_supported: ["profile", "email"],
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: [
          "client_secret_basic",
          "client_secret_post",
          "none"
        ],
        code_challenge_methods_supported: ["S256"]
      };
      reply.type("application/json").send(metadata);
    });
    server.get("/.well-known/oauth-protected-resource", async (request, reply) => {
      const baseUrl2 = `${request.protocol}://${request.headers.host}`;
      const metadata = {
        resource: `${baseUrl2}/sse`,
        authorization_servers: [this.config.issuerUrl],
        scopes_supported: ["profile", "email"],
        bearer_methods_supported: ["header"],
        resource_name: "Documentation MCP Server",
        resource_documentation: "https://github.com/arabold/docs-mcp-server#readme",
        // Enhanced metadata for better discoverability
        resource_server_metadata_url: `${baseUrl2}/.well-known/oauth-protected-resource`,
        authorization_server_metadata_url: `${this.config.issuerUrl}/.well-known/openid-configuration`,
        jwks_uri: `${this.config.issuerUrl}/.well-known/jwks.json`,
        // Supported MCP transports
        mcp_transports: [
          {
            transport: "sse",
            endpoint: `${baseUrl2}/sse`,
            description: "Server-Sent Events transport"
          },
          {
            transport: "http",
            endpoint: `${baseUrl2}/mcp`,
            description: "Streaming HTTP transport"
          }
        ]
      };
      reply.type("application/json").send(metadata);
    });
    server.get("/oauth/authorize", async (request, reply) => {
      const endpoints = await this.discoverEndpoints();
      const params = new URLSearchParams(request.query);
      if (!params.has("resource")) {
        const resourceUrl = `${request.protocol}://${request.headers.host}/sse`;
        params.set("resource", resourceUrl);
      }
      const redirectUrl = `${endpoints.authorizationUrl}?${params.toString()}`;
      reply.redirect(redirectUrl);
    });
    server.post("/oauth/token", async (request, reply) => {
      const endpoints = await this.discoverEndpoints();
      const tokenBody = new URLSearchParams(request.body);
      if (!tokenBody.has("resource")) {
        const resourceUrl = `${request.protocol}://${request.headers.host}/sse`;
        tokenBody.set("resource", resourceUrl);
      }
      const response = await fetch(endpoints.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: tokenBody.toString()
      });
      const data = await response.json();
      reply.status(response.status).type("application/json").send(data);
    });
    server.post("/oauth/revoke", async (request, reply) => {
      const endpoints = await this.discoverEndpoints();
      if (endpoints.revocationUrl) {
        const response = await fetch(endpoints.revocationUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams(request.body).toString()
        });
        reply.status(response.status).send();
      } else {
        reply.status(404).send({ error: "Revocation not supported" });
      }
    });
    server.post("/oauth/register", async (request, reply) => {
      const endpoints = await this.discoverEndpoints();
      if (endpoints.registrationUrl) {
        const response = await fetch(endpoints.registrationUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(request.body)
        });
        const data = await response.json();
        reply.status(response.status).type("application/json").send(data);
      } else {
        reply.status(404).send({ error: "Dynamic client registration not supported" });
      }
    });
    logger.debug("OAuth2 endpoints registered on Fastify server");
  }
  /**
   * Discover OAuth endpoints from the OAuth2 authorization server.
   * Uses OAuth2 discovery (RFC 8414) with OIDC discovery fallback.
   * Supports both JWT and opaque token validation methods.
   */
  async discoverEndpoints() {
    const oauthDiscoveryUrl = `${this.config.issuerUrl}/.well-known/oauth-authorization-server`;
    try {
      const oauthResponse = await fetch(oauthDiscoveryUrl);
      if (oauthResponse.ok) {
        const config2 = await oauthResponse.json();
        logger.debug(
          `Successfully discovered OAuth2 endpoints from: ${oauthDiscoveryUrl}`
        );
        const userinfoEndpoint = await this.discoverUserinfoEndpoint();
        if (userinfoEndpoint) {
          config2.userinfo_endpoint = userinfoEndpoint;
        }
        return this.buildEndpointsFromConfig(config2);
      }
    } catch (error) {
      logger.debug(`OAuth2 discovery failed: ${error}, trying OIDC discovery`);
    }
    const oidcDiscoveryUrl = `${this.config.issuerUrl}/.well-known/openid-configuration`;
    const oidcResponse = await fetch(oidcDiscoveryUrl);
    if (!oidcResponse.ok) {
      throw new Error(
        `Failed to fetch configuration from both ${oauthDiscoveryUrl} and ${oidcDiscoveryUrl}`
      );
    }
    const config = await oidcResponse.json();
    logger.debug(`Successfully discovered OIDC endpoints from: ${oidcDiscoveryUrl}`);
    return this.buildEndpointsFromConfig(config);
  }
  /**
   * Try to discover userinfo endpoint for opaque token validation
   */
  async discoverUserinfoEndpoint() {
    try {
      const oidcDiscoveryUrl = `${this.config.issuerUrl}/.well-known/openid-configuration`;
      const response = await fetch(oidcDiscoveryUrl);
      if (response.ok) {
        const config = await response.json();
        return config.userinfo_endpoint || null;
      }
    } catch (error) {
      logger.debug(`Failed to fetch userinfo endpoint: ${error}`);
    }
    return null;
  }
  /**
   * Build endpoint configuration from discovery response.
   */
  buildEndpointsFromConfig(config) {
    return {
      authorizationUrl: config.authorization_endpoint,
      tokenUrl: config.token_endpoint,
      revocationUrl: config.revocation_endpoint,
      registrationUrl: config.registration_endpoint,
      jwksUri: config.jwks_uri,
      userinfoUrl: config.userinfo_endpoint
    };
  }
  /**
   * Get supported resource URLs for this MCP server instance.
   * This enables self-discovering resource validation per MCP Authorization spec.
   */
  getSupportedResources(request) {
    const baseUrl = `${request.protocol}://${request.headers.host}`;
    return [
      `${baseUrl}/sse`,
      // SSE transport
      `${baseUrl}/mcp`,
      // Streaming HTTP transport
      `${baseUrl}`
      // Server root
    ];
  }
  /**
   * Verify an access token using hybrid validation approach.
   * First tries JWT validation with JWKS, falls back to userinfo endpoint for opaque tokens.
   * This provides universal compatibility with all OAuth2 providers and token formats.
   */
  async verifyAccessToken(token, request) {
    logger.debug(`Attempting to verify token: ${token.substring(0, 20)}...`);
    if (this.jwks) {
      try {
        logger.debug("Attempting JWT validation with JWKS...");
        const { payload } = await jwtVerify(token, this.jwks, {
          issuer: this.config.issuerUrl,
          audience: this.config.audience
        });
        logger.debug(
          `JWT validation successful. Subject: ${payload.sub}, Audience: ${payload.aud}`
        );
        if (!payload.sub) {
          throw new Error("JWT payload missing subject claim");
        }
        return {
          token,
          clientId: payload.sub,
          scopes: ["*"]
          // Full access for all authenticated users
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.debug(
          `JWT validation failed: ${errorMessage}, trying userinfo fallback...`
        );
      }
    }
    if (this.discoveredEndpoints?.userinfoUrl) {
      try {
        logger.debug("Attempting userinfo endpoint validation...");
        const response = await fetch(this.discoveredEndpoints.userinfoUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json"
          }
        });
        if (!response.ok) {
          throw new Error(
            `Userinfo request failed: ${response.status} ${response.statusText}`
          );
        }
        const userinfo = await response.json();
        logger.debug(
          `Token validation successful. User: ${userinfo.sub}, Email: ${userinfo.email}`
        );
        if (!userinfo.sub) {
          throw new Error("Userinfo response missing subject");
        }
        if (request) {
          const supportedResources = this.getSupportedResources(request);
          logger.debug(`Supported resources: ${JSON.stringify(supportedResources)}`);
        }
        return {
          token,
          clientId: userinfo.sub,
          scopes: ["*"]
          // Full access for all authenticated users
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.debug(`Userinfo validation failed: ${errorMessage}`);
      }
    }
    logger.debug("All token validation strategies exhausted");
    throw new Error("Invalid access token");
  }
  /**
   * Get client information for the given client ID.
   * This is called by the proxy provider for client validation.
   */
  async getClient(clientId) {
    return {
      client_id: clientId,
      redirect_uris: [`${this.config.audience}/callback`]
      // Add other client metadata as needed
    };
  }
  /**
   * Create an authentication context from a token (for compatibility with existing middleware).
   * Uses binary authentication - valid token grants full access.
   */
  async createAuthContext(authorization, request) {
    if (!this.config.enabled) {
      return {
        authenticated: false,
        scopes: /* @__PURE__ */ new Set()
      };
    }
    try {
      logger.debug(
        `Processing authorization header: ${authorization.substring(0, 20)}...`
      );
      const match = authorization.match(/^Bearer\s+(.+)$/i);
      if (!match) {
        logger.debug("Authorization header does not match Bearer token pattern");
        throw new Error("Invalid authorization header format");
      }
      const token = match[1];
      logger.debug(`Extracted token: ${token.substring(0, 20)}...`);
      const authInfo = await this.verifyAccessToken(token, request);
      logger.debug(`Authentication successful for client: ${authInfo.clientId}`);
      return {
        authenticated: true,
        scopes: /* @__PURE__ */ new Set(["*"]),
        // Full access for authenticated users
        subject: authInfo.clientId
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.debug(`Authentication failed: ${errorMessage}`);
      return {
        authenticated: false,
        scopes: /* @__PURE__ */ new Set()
      };
    }
  }
}
class RemoteEventProxy {
  constructor(remoteWorkerUrl, localEventBus) {
    this.remoteWorkerUrl = remoteWorkerUrl;
    this.localEventBus = localEventBus;
  }
  trpcClient = null;
  wsClient = null;
  subscription = null;
  isConnected = false;
  /**
   * Start subscribing to remote events and forwarding them locally.
   */
  async connect() {
    if (this.isConnected) {
      logger.warn("Remote event proxy already connected");
      return;
    }
    logger.debug(`Connecting to remote worker at ${this.remoteWorkerUrl}`);
    try {
      const url = new URL(this.remoteWorkerUrl);
      const baseUrl = `${url.protocol}//${url.host}`;
      const wsUrl = baseUrl.replace(/^http/, "ws");
      this.wsClient = createWSClient({
        url: wsUrl
      });
      this.trpcClient = createTRPCClient({
        links: [
          splitLink({
            condition: (op) => op.type === "subscription",
            true: wsLink({ client: this.wsClient, transformer: superjson }),
            false: httpBatchLink({ url: this.remoteWorkerUrl, transformer: superjson })
          })
        ]
      });
      this.subscription = this.trpcClient.events.subscribe.subscribe(
        {},
        // Subscribe to all event types
        {
          onData: (data) => {
            logger.debug(`Received remote event: ${data.type}`);
            this.localEventBus.emit(data.type, data.payload);
          },
          onError: (error) => {
            logger.error(`❌ Remote event subscription error: ${error}`);
            this.isConnected = false;
            this.scheduleReconnect();
          },
          onStarted: () => {
            logger.debug("Remote event subscription started");
            this.isConnected = true;
          },
          onComplete: () => {
            logger.debug("Remote event subscription completed");
            this.isConnected = false;
          }
        }
      );
    } catch (error) {
      logger.error(`❌ Failed to connect to remote worker: ${error}`);
      this.scheduleReconnect();
    }
  }
  /**
   * Disconnect from the remote worker and stop forwarding events.
   */
  disconnect() {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
    }
    this.isConnected = false;
    logger.info("🚫 Disconnected from remote worker");
  }
  /**
   * Check if the proxy is currently connected to the remote worker.
   */
  isActive() {
    return this.isConnected;
  }
  /**
   * Schedule a reconnection attempt after a delay.
   */
  scheduleReconnect() {
    logger.info("🔄 Scheduling reconnect to remote worker in 5 seconds...");
    setTimeout(() => {
      if (!this.isConnected) {
        this.connect();
      }
    }, 5e3);
  }
}
class ToolError extends Error {
  constructor(message, toolName) {
    super(message);
    this.toolName = toolName;
    this.name = this.constructor.name;
  }
}
class ValidationError extends ToolError {
}
function createResponse(text) {
  return {
    content: [
      {
        type: "text",
        text
      }
    ],
    isError: false
  };
}
function createError(errorOrText) {
  const text = errorOrText instanceof Error ? errorOrText.message : String(errorOrText);
  return {
    content: [
      {
        type: "text",
        text
      }
    ],
    isError: true
  };
}
function createMcpServerInstance(tools, config) {
  const readOnly = config.app.readOnly;
  const server = new McpServer(
    {
      name: "docs-mcp-server",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  );
  if (!readOnly) {
    server.tool(
      "scrape_docs",
      "Scrape and index documentation from a URL for a library. Use this tool to index a new library or a new version.",
      {
        url: z$1.string().url().describe("Documentation root URL to scrape."),
        library: z$1.string().trim().describe("Library name."),
        version: z$1.string().trim().optional().describe("Library version (optional)."),
        maxPages: z$1.number().optional().default(config.scraper.maxPages).describe(
          `Maximum number of pages to scrape (default: ${config.scraper.maxPages}).`
        ),
        maxDepth: z$1.number().optional().default(config.scraper.maxDepth).describe(`Maximum navigation depth (default: ${config.scraper.maxDepth}).`),
        scope: z$1.enum(["subpages", "hostname", "domain"]).optional().default("subpages").describe("Crawling boundary: 'subpages', 'hostname', or 'domain'."),
        followRedirects: z$1.boolean().optional().default(true).describe("Follow HTTP redirects (3xx responses).")
      },
      {
        title: "Scrape New Library Documentation",
        destructiveHint: true,
        // replaces existing docs
        openWorldHint: true
        // requires internet access
      },
      async ({ url, library, version, maxPages, maxDepth, scope, followRedirects }) => {
        telemetry.track(TelemetryEvent.TOOL_USED, {
          tool: "scrape_docs",
          context: "mcp_server",
          library,
          version,
          url: new URL(url).hostname,
          // Privacy-safe URL tracking
          maxPages,
          maxDepth,
          scope
        });
        try {
          const result = await tools.scrape.execute({
            url,
            library,
            version,
            waitForCompletion: false,
            // Don't wait for completion
            // onProgress: undefined, // Explicitly undefined or omitted
            options: {
              maxPages,
              maxDepth,
              scope,
              followRedirects
            }
          });
          if ("jobId" in result) {
            return createResponse(`🚀 Scraping job started with ID: ${result.jobId}.`);
          }
          return createResponse(
            `Scraping finished immediately (unexpectedly) with ${result.pagesScraped} pages.`
          );
        } catch (error) {
          return createError(error);
        }
      }
    );
    server.tool(
      "refresh_version",
      "Re-scrape a previously indexed library version, updating only changed pages.",
      {
        library: z$1.string().trim().describe("Library name."),
        version: z$1.string().trim().optional().describe("Library version (optional, refreshes latest if omitted).")
      },
      {
        title: "Refresh Library Version",
        destructiveHint: false,
        // Only updates changed content
        openWorldHint: true
        // requires internet access
      },
      async ({ library, version }) => {
        telemetry.track(TelemetryEvent.TOOL_USED, {
          tool: "refresh_version",
          context: "mcp_server",
          library,
          version
        });
        try {
          const result = await tools.refresh.execute({
            library,
            version,
            waitForCompletion: false
            // Don't wait for completion
          });
          if ("jobId" in result) {
            return createResponse(`🔄 Refresh job started with ID: ${result.jobId}.`);
          }
          return createResponse(
            `Refresh finished immediately (unexpectedly) with ${result.pagesRefreshed} pages.`
          );
        } catch (error) {
          return createError(error);
        }
      }
    );
  }
  server.tool(
    "search_docs",
    'Search up-to-date documentation for a library or package. Examples:\n\n- {library: "react", query: "hooks lifecycle"} -> matches latest version of React\n- {library: "react", version: "18.0.0", query: "hooks lifecycle"} -> matches React 18.0.0 or earlier\n- {library: "typescript", version: "5.x", query: "ReturnType example"} -> any TypeScript 5.x.x version\n- {library: "typescript", version: "5.2.x", query: "ReturnType example"} -> any TypeScript 5.2.x version',
    {
      library: z$1.string().trim().describe("Library name."),
      version: z$1.string().trim().optional().describe("Library version (exact or X-Range, optional)."),
      query: z$1.string().trim().describe("Documentation search query."),
      limit: z$1.number().optional().default(5).describe("Maximum number of results.")
    },
    {
      title: "Search Library Documentation",
      readOnlyHint: true,
      destructiveHint: false
    },
    async ({ library, version, query, limit }) => {
      telemetry.track(TelemetryEvent.TOOL_USED, {
        tool: "search_docs",
        context: "mcp_server",
        library,
        version,
        query: query.substring(0, 100),
        // Truncate query for privacy
        limit
      });
      try {
        const result = await tools.search.execute({
          library,
          version,
          query,
          limit,
          exactMatch: false
          // Always false for MCP interface
        });
        const formattedResults = result.results.map(
          (r, i) => `
------------------------------------------------------------
Result ${i + 1}: ${r.url}

${r.content}
`
        );
        if (formattedResults.length === 0) {
          return createResponse(
            `No results found for '${query}' in ${library}. Try to use a different or more general query.`
          );
        }
        return createResponse(formattedResults.join(""));
      } catch (error) {
        return createError(error);
      }
    }
  );
  server.tool(
    "list_libraries",
    "List all indexed libraries.",
    {
      // no params
    },
    {
      title: "List Libraries",
      readOnlyHint: true,
      destructiveHint: false
    },
    async () => {
      telemetry.track(TelemetryEvent.TOOL_USED, {
        tool: "list_libraries",
        context: "mcp_server"
      });
      try {
        const result = await tools.listLibraries.execute();
        if (result.libraries.length === 0) {
          return createResponse("No libraries indexed yet.");
        }
        return createResponse(
          `Indexed libraries:

${result.libraries.map((lib) => `- ${lib.name}`).join("\n")}`
        );
      } catch (error) {
        return createError(error);
      }
    }
  );
  server.tool(
    "find_version",
    "Find the best matching version for a library. Use to identify available or closest versions.",
    {
      library: z$1.string().trim().describe("Library name."),
      targetVersion: z$1.string().trim().optional().describe("Version pattern to match (exact or X-Range, optional).")
    },
    {
      title: "Find Library Version",
      readOnlyHint: true,
      destructiveHint: false
    },
    async ({ library, targetVersion }) => {
      telemetry.track(TelemetryEvent.TOOL_USED, {
        tool: "find_version",
        context: "mcp_server",
        library,
        targetVersion
      });
      try {
        const result = await tools.findVersion.execute({
          library,
          targetVersion
        });
        return createResponse(result.message);
      } catch (error) {
        return createError(error);
      }
    }
  );
  if (!readOnly) {
    server.tool(
      "list_jobs",
      "List all indexing jobs. Optionally filter by status.",
      {
        status: z$1.enum(["queued", "running", "completed", "failed", "cancelling", "cancelled"]).optional().describe("Filter jobs by status (optional).")
      },
      {
        title: "List Indexing Jobs",
        readOnlyHint: true,
        destructiveHint: false
      },
      async ({ status }) => {
        telemetry.track(TelemetryEvent.TOOL_USED, {
          tool: "list_jobs",
          context: "mcp_server",
          status
        });
        try {
          const result = await tools.listJobs.execute({
            status
          });
          const formattedJobs = result.jobs.map(
            (job) => `- ID: ${job.id}
  Status: ${job.status}
  Library: ${job.library}
  Version: ${job.version}
  Created: ${job.createdAt}${job.startedAt ? `
  Started: ${job.startedAt}` : ""}${job.finishedAt ? `
  Finished: ${job.finishedAt}` : ""}${job.error ? `
  Error: ${job.error}` : ""}`
          ).join("\n\n");
          return createResponse(
            result.jobs.length > 0 ? `Current Jobs:

${formattedJobs}` : "No jobs found."
          );
        } catch (error) {
          return createError(error);
        }
      }
    );
    server.tool(
      "get_job_info",
      "Get details for a specific indexing job. Use the 'list_jobs' tool to find the job ID.",
      {
        jobId: z$1.string().uuid().describe("Job ID to query.")
      },
      {
        title: "Get Indexing Job Info",
        readOnlyHint: true,
        destructiveHint: false
      },
      async ({ jobId }) => {
        telemetry.track(TelemetryEvent.TOOL_USED, {
          tool: "get_job_info",
          context: "mcp_server",
          jobId
        });
        try {
          const result = await tools.getJobInfo.execute({ jobId });
          const job = result.job;
          const formattedJob = `- ID: ${job.id}
  Status: ${job.status}
  Library: ${job.library}@${job.version}
  Created: ${job.createdAt}${job.startedAt ? `
  Started: ${job.startedAt}` : ""}${job.finishedAt ? `
  Finished: ${job.finishedAt}` : ""}${job.error ? `
  Error: ${job.error}` : ""}`;
          return createResponse(`Job Info:

${formattedJob}`);
        } catch (error) {
          return createError(error);
        }
      }
    );
    server.tool(
      "cancel_job",
      "Cancel a queued or running indexing job. Use the 'list_jobs' tool to find the job ID.",
      {
        jobId: z$1.string().uuid().describe("Job ID to cancel.")
      },
      {
        title: "Cancel Indexing Job",
        destructiveHint: true
      },
      async ({ jobId }) => {
        telemetry.track(TelemetryEvent.TOOL_USED, {
          tool: "cancel_job",
          context: "mcp_server",
          jobId
        });
        try {
          const result = await tools.cancelJob.execute({ jobId });
          return createResponse(result.message);
        } catch (error) {
          return createError(error);
        }
      }
    );
    server.tool(
      "remove_docs",
      "Remove indexed documentation for a library version. Use only if explicitly instructed.",
      {
        library: z$1.string().trim().describe("Library name."),
        version: z$1.string().trim().optional().describe("Library version (optional, removes latest if omitted).")
      },
      {
        title: "Remove Library Documentation",
        destructiveHint: true
      },
      async ({ library, version }) => {
        telemetry.track(TelemetryEvent.TOOL_USED, {
          tool: "remove_docs",
          context: "mcp_server",
          library,
          version
        });
        try {
          const result = await tools.remove.execute({ library, version });
          return createResponse(result.message);
        } catch (error) {
          return createError(error);
        }
      }
    );
  }
  server.tool(
    "fetch_url",
    "Fetch a single URL and convert its content to Markdown. Use this tool to read the content of any web page.",
    {
      url: z$1.string().url().describe("URL to fetch and convert to Markdown."),
      followRedirects: z$1.boolean().optional().default(true).describe("Follow HTTP redirects (3xx responses).")
    },
    {
      title: "Fetch URL",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true
      // requires internet access
    },
    async ({ url, followRedirects }) => {
      telemetry.track(TelemetryEvent.TOOL_USED, {
        tool: "fetch_url",
        context: "mcp_server",
        url: new URL(url).hostname,
        // Privacy-safe URL tracking
        followRedirects
      });
      try {
        const result = await tools.fetchUrl.execute({ url, followRedirects });
        return createResponse(result);
      } catch (error) {
        return createError(error);
      }
    }
  );
  server.resource(
    "libraries",
    "docs://libraries",
    {
      description: "List all indexed libraries"
    },
    async (uri) => {
      const result = await tools.listLibraries.execute();
      return {
        contents: result.libraries.map((lib) => ({
          uri: new URL(lib.name, uri).href,
          text: lib.name
        }))
      };
    }
  );
  server.resource(
    "versions",
    new ResourceTemplate("docs://libraries/{library}/versions", {
      list: void 0
    }),
    {
      description: "List all indexed versions for a library"
    },
    async (uri, { library }) => {
      const result = await tools.listLibraries.execute();
      const lib = result.libraries.find((l) => l.name === library);
      if (!lib) {
        return { contents: [] };
      }
      return {
        contents: lib.versions.map((v) => ({
          uri: new URL(v.version, uri).href,
          text: v.version
        }))
      };
    }
  );
  if (!readOnly) {
    server.resource(
      "jobs",
      "docs://jobs",
      {
        description: "List indexing jobs, optionally filtering by status.",
        mimeType: "application/json"
      },
      async (uri) => {
        const statusParam = uri.searchParams.get("status");
        let statusFilter;
        if (statusParam) {
          const validation = z$1.nativeEnum(PipelineJobStatus).safeParse(statusParam);
          if (validation.success) {
            statusFilter = validation.data;
          } else {
            logger.warn(`⚠️  Invalid status parameter received: ${statusParam}`);
          }
        }
        const result = await tools.listJobs.execute({ status: statusFilter });
        return {
          contents: result.jobs.map((job) => ({
            uri: new URL(job.id, uri).href,
            mimeType: "application/json",
            text: JSON.stringify({
              id: job.id,
              library: job.library,
              version: job.version,
              status: job.status,
              error: job.error || void 0
            })
          }))
        };
      }
    );
    server.resource(
      "job",
      // A distinct name for this specific resource type
      new ResourceTemplate("docs://jobs/{jobId}", { list: void 0 }),
      {
        description: "Get details for a specific indexing job by ID.",
        mimeType: "application/json"
      },
      async (uri, { jobId }) => {
        if (typeof jobId !== "string" || jobId.length === 0) {
          logger.warn(`⚠️  Invalid jobId received in URI: ${jobId}`);
          return { contents: [] };
        }
        try {
          const result = await tools.getJobInfo.execute({ jobId });
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: "application/json",
                text: JSON.stringify({
                  id: result.job.id,
                  library: result.job.library,
                  version: result.job.version,
                  status: result.job.status,
                  error: result.job.error || void 0
                })
              }
            ]
          };
        } catch (error) {
          if (error instanceof ToolError) {
            logger.warn(`⚠️  Job not found for resource request: ${jobId}`);
          } else {
            logger.error(
              `❌ Unexpected error in job resource handler: ${error instanceof Error ? error.message : String(error)}`
            );
          }
          return { contents: [] };
        }
      }
    );
  }
  return server;
}
class ScraperError extends Error {
  constructor(message, isRetryable = false, cause) {
    super(message);
    this.isRetryable = isRetryable;
    this.cause = cause;
    this.name = this.constructor.name;
    if (cause?.stack) {
      this.stack = `${this.stack}
Caused by: ${cause.stack}`;
    }
  }
}
class InvalidUrlError extends ScraperError {
  constructor(url, cause) {
    super(`Invalid URL: ${url}`, false, cause);
  }
}
class RedirectError extends ScraperError {
  constructor(originalUrl, redirectUrl, statusCode) {
    super(
      `Redirect detected from ${originalUrl} to ${redirectUrl} (status: ${statusCode})`,
      false
    );
    this.originalUrl = originalUrl;
    this.redirectUrl = redirectUrl;
    this.statusCode = statusCode;
  }
}
class ChallengeError extends ScraperError {
  constructor(url, statusCode, challengeType) {
    super(
      `Challenge detected for ${url} (status: ${statusCode}, type: ${challengeType})`,
      false
    );
    this.url = url;
    this.statusCode = statusCode;
    this.challengeType = challengeType;
  }
}
class MimeTypeUtils {
  /**
   * Parses a Content-Type header string into its MIME type and charset.
   * @param contentTypeHeader The Content-Type header string (e.g., "text/html; charset=utf-8").
   * @returns A ParsedContentType object, or a default if parsing fails.
   */
  static parseContentType(contentTypeHeader) {
    if (!contentTypeHeader) {
      return { mimeType: "application/octet-stream" };
    }
    const parts = contentTypeHeader.split(";").map((part) => part.trim());
    const mimeType = parts[0].toLowerCase();
    let charset;
    for (let i = 1; i < parts.length; i++) {
      const param = parts[i];
      if (param.toLowerCase().startsWith("charset=")) {
        charset = param.substring("charset=".length).toLowerCase();
        break;
      }
    }
    return { mimeType, charset };
  }
  /**
   * Checks if a MIME type represents HTML content.
   */
  static isHtml(mimeType) {
    return mimeType === "text/html" || mimeType === "application/xhtml+xml";
  }
  /**
   * Checks if a MIME type represents Markdown content.
   */
  static isMarkdown(mimeType) {
    return mimeType === "text/markdown" || mimeType === "text/x-markdown";
  }
  /**
   * Checks if a MIME type represents plain text content.
   * This includes basic text/* types but excludes structured formats like JSON, XML, etc.
   */
  static isText(mimeType) {
    if (!mimeType) {
      return false;
    }
    const normalizedMimeType = mimeType.toLowerCase();
    if (normalizedMimeType.startsWith("text/")) {
      if (MimeTypeUtils.isJson(normalizedMimeType) || MimeTypeUtils.isMarkdown(normalizedMimeType)) {
        return false;
      }
      return true;
    }
    return false;
  }
  /**
   * Checks if a MIME type represents content that is safe for text processing.
   * This includes all text/* types and specific application types that are text-based.
   * Used by TextPipeline as a fallback for content that other pipelines don't handle.
   */
  static isSafeForTextProcessing(mimeType) {
    if (!mimeType) {
      return false;
    }
    const normalizedMimeType = mimeType.toLowerCase();
    if (normalizedMimeType.startsWith("text/")) {
      return true;
    }
    if (MimeTypeUtils.isJson(normalizedMimeType)) {
      return true;
    }
    if (MimeTypeUtils.isSourceCode(normalizedMimeType)) {
      return true;
    }
    return false;
  }
  /**
   * Checks if a MIME type represents JSON content.
   */
  static isJson(mimeType) {
    return mimeType === "application/json" || mimeType === "text/json" || mimeType === "text/x-json";
  }
  /**
   * Checks if a MIME type represents source code that should be wrapped in code blocks.
   */
  static isSourceCode(mimeType) {
    return MimeTypeUtils.extractLanguageFromMimeType(mimeType) !== "";
  }
  /**
   * Checks if content appears to be binary based on the presence of null bytes.
   * This is a reliable heuristic since text files should not contain null bytes.
   * @param content The content to check (string or Buffer)
   * @returns true if the content appears to be binary
   */
  static isBinary(content) {
    if (typeof content === "string") {
      return content.includes("\0");
    }
    return content.includes(0);
  }
  /**
   * Detects MIME type from file path, with special handling for common source code extensions
   * that the mime package doesn't handle well or gets wrong.
   *
   * @param filePath - The file path to detect MIME type for
   * @returns The detected MIME type or null if unknown
   */
  static detectMimeTypeFromPath(filePath) {
    const extension = filePath.toLowerCase().split(".").pop();
    const customMimeTypes = {
      ts: "text/x-typescript",
      tsx: "text/x-tsx",
      js: "text/javascript",
      jsx: "text/x-jsx",
      cjs: "text/javascript",
      // CommonJS modules
      mjs: "text/javascript",
      // ES modules
      py: "text/x-python",
      pyw: "text/x-python",
      pyi: "text/x-python",
      go: "text/x-go",
      rs: "text/x-rust",
      kt: "text/x-kotlin",
      scala: "text/x-scala",
      swift: "text/x-swift",
      rb: "text/x-ruby",
      php: "text/x-php",
      cs: "text/x-csharp",
      cpp: "text/x-c++src",
      cxx: "text/x-c++src",
      cc: "text/x-c++src",
      hpp: "text/x-c++hdr",
      hxx: "text/x-c++hdr",
      h: "text/x-chdr",
      c: "text/x-csrc",
      sh: "text/x-shellscript",
      bash: "text/x-shellscript",
      zsh: "text/x-shellscript",
      fish: "text/x-shellscript",
      ps1: "text/x-powershell",
      sql: "text/x-sql",
      graphql: "text/x-graphql",
      gql: "text/x-graphql",
      proto: "text/x-proto",
      dockerfile: "text/x-dockerfile"
    };
    if (extension && customMimeTypes[extension]) {
      return customMimeTypes[extension];
    }
    const detectedType = mime.getType(filePath);
    return MimeTypeUtils.normalizeMimeType(detectedType);
  }
  /**
   * Normalizes MIME types that are incorrectly detected by the mime package.
   * This handles cases like 'application/node' for .cjs files.
   *
   * @param mimeType - The MIME type to normalize
   * @returns The normalized MIME type
   */
  static normalizeMimeType(mimeType) {
    if (!mimeType) {
      return null;
    }
    const mimeTypeNormalization = {
      "application/node": "text/javascript"
      // .cjs files are detected as this
    };
    return mimeTypeNormalization[mimeType] || mimeType;
  }
  /**
   * Extracts the programming language identifier from a MIME type for code block formatting.
   *
   * @param mimeType - The MIME type to extract language from
   * @returns The language identifier (e.g., "typescript", "python") or empty string if unknown
   */
  static extractLanguageFromMimeType(mimeType) {
    const mimeToLanguage = {
      "text/x-typescript": "typescript",
      "text/typescript": "typescript",
      "application/typescript": "typescript",
      "text/x-tsx": "tsx",
      "text/javascript": "javascript",
      "application/javascript": "javascript",
      "application/x-javascript": "javascript",
      "text/x-jsx": "jsx",
      "text/x-python": "python",
      "text/x-java": "java",
      "text/x-c": "c",
      "text/x-csrc": "c",
      "text/x-chdr": "c",
      "text/x-c++": "cpp",
      "text/x-c++src": "cpp",
      "text/x-c++hdr": "cpp",
      "text/x-csharp": "csharp",
      "text/x-go": "go",
      "text/x-rust": "rust",
      "text/x-php": "php",
      "text/x-ruby": "ruby",
      "text/x-swift": "swift",
      "text/x-kotlin": "kotlin",
      "text/x-scala": "scala",
      "text/x-yaml": "yaml",
      "application/x-yaml": "yaml",
      "application/yaml": "yaml",
      "text/x-json": "json",
      "application/json": "json",
      "text/x-xml": "xml",
      "text/xml": "xml",
      "application/xml": "xml",
      "text/x-sql": "sql",
      "text/x-sh": "bash",
      "text/x-shellscript": "bash",
      "application/x-sh": "bash",
      "text/x-powershell": "powershell",
      "text/x-graphql": "graphql",
      "text/x-proto": "protobuf",
      "text/x-dockerfile": "dockerfile"
    };
    return mimeToLanguage[mimeType] || "";
  }
}
class FingerprintGenerator {
  headerGenerator;
  /**
   * Creates an instance of FingerprintGenerator.
   * @param options Optional configuration for the header generator.
   */
  constructor(options) {
    const defaultOptions = {
      browsers: [{ name: "chrome", minVersion: 100 }, "firefox", "safari"],
      devices: ["desktop", "mobile"],
      operatingSystems: ["windows", "linux", "macos", "android", "ios"],
      locales: ["en-US", "en"],
      httpVersion: "2"
    };
    this.headerGenerator = new HeaderGenerator({
      ...defaultOptions,
      ...options
    });
  }
  /**
   * Generates a set of realistic HTTP headers.
   * @returns A set of realistic HTTP headers.
   */
  generateHeaders() {
    return this.headerGenerator.getHeaders();
  }
}
var FetchStatus = /* @__PURE__ */ ((FetchStatus2) => {
  FetchStatus2["SUCCESS"] = "success";
  FetchStatus2["NOT_MODIFIED"] = "not_modified";
  FetchStatus2["NOT_FOUND"] = "not_found";
  return FetchStatus2;
})(FetchStatus || {});
class BrowserFetcher {
  browser = null;
  page = null;
  fingerprintGenerator;
  defaultTimeoutMs;
  constructor(scraperConfig) {
    this.defaultTimeoutMs = scraperConfig.browserTimeoutMs;
    this.fingerprintGenerator = new FingerprintGenerator();
  }
  canFetch(source) {
    return source.startsWith("http://") || source.startsWith("https://");
  }
  async fetch(source, options) {
    try {
      await this.ensureBrowserReady();
      if (!this.page) {
        throw new ScraperError("Failed to create browser page", false);
      }
      if (options?.headers) {
        await this.page.setExtraHTTPHeaders(options.headers);
      }
      const timeout = options?.timeout || this.defaultTimeoutMs;
      logger.debug(`Navigating to ${source} with browser...`);
      const response = await this.page.goto(source, {
        waitUntil: "networkidle",
        timeout
      });
      if (!response) {
        throw new ScraperError(`Failed to navigate to ${source}`, false);
      }
      if (options?.followRedirects === false && response.status() >= 300 && response.status() < 400) {
        const location = response.headers().location;
        if (location) {
          throw new ScraperError(`Redirect blocked: ${source} -> ${location}`, false);
        }
      }
      const finalUrl = this.page.url();
      const content = await this.page.content();
      const contentBuffer = Buffer.from(content, "utf-8");
      const contentType = response.headers()["content-type"] || "text/html";
      const { mimeType, charset } = MimeTypeUtils.parseContentType(contentType);
      const etag = response.headers().etag;
      return {
        content: contentBuffer,
        mimeType,
        charset,
        encoding: void 0,
        // Browser handles encoding automatically
        source: finalUrl,
        etag,
        status: FetchStatus.SUCCESS
      };
    } catch (error) {
      if (options?.signal?.aborted) {
        throw new ScraperError("Browser fetch cancelled", false);
      }
      logger.error(`❌ Browser fetch failed for ${source}: ${error}`);
      throw new ScraperError(
        `Browser fetch failed for ${source}: ${error instanceof Error ? error.message : String(error)}`,
        false,
        error instanceof Error ? error : void 0
      );
    }
  }
  static async launchBrowser() {
    return chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || void 0,
      args: ["--no-sandbox"]
    });
  }
  async ensureBrowserReady() {
    if (!this.browser) {
      logger.debug("Launching browser...");
      this.browser = await BrowserFetcher.launchBrowser();
    }
    if (!this.page) {
      this.page = await this.browser.newPage();
      const dynamicHeaders = this.fingerprintGenerator.generateHeaders();
      await this.page.setExtraHTTPHeaders(dynamicHeaders);
      await this.page.setViewportSize({ width: 1920, height: 1080 });
    }
  }
  /**
   * Close the browser and clean up resources
   */
  async close() {
    try {
      if (this.page) {
        await this.page.close();
        this.page = null;
      }
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      logger.debug("Browser closed successfully");
    } catch (error) {
      logger.warn(`⚠️  Error closing browser: ${error}`);
    }
  }
}
class FileFetcher {
  canFetch(source) {
    return source.startsWith("file://");
  }
  /**
   * Fetches the content of a file given a file:// URL, decoding percent-encoded paths as needed.
   * Uses enhanced MIME type detection for better source code file recognition.
   * Supports conditional fetching via ETag comparison for efficient refresh operations.
   */
  async fetch(source, options) {
    let filePath = source.replace(/^file:\/\/\/?/, "");
    filePath = decodeURIComponent(filePath);
    if (!filePath.startsWith("/") && process.platform !== "win32") {
      filePath = `/${filePath}`;
    }
    try {
      const stats = await fs$1.stat(filePath);
      const currentEtag = crypto.createHash("md5").update(stats.mtime.toISOString()).digest("hex");
      if (options?.etag && options.etag === currentEtag) {
        return {
          content: Buffer.from(""),
          mimeType: "text/plain",
          source,
          etag: currentEtag,
          lastModified: stats.mtime.toISOString(),
          status: FetchStatus.NOT_MODIFIED
        };
      }
      const content = await fs$1.readFile(filePath);
      const detectedMimeType = MimeTypeUtils.detectMimeTypeFromPath(filePath);
      const mimeType = detectedMimeType || "application/octet-stream";
      return {
        content,
        mimeType,
        source,
        etag: currentEtag,
        lastModified: stats.mtime.toISOString(),
        status: FetchStatus.SUCCESS
        // Don't assume charset for text files - let the pipeline detect it
      };
    } catch (error) {
      if (error.code === "ENOENT") {
        return {
          content: Buffer.from(""),
          mimeType: "text/plain",
          source,
          status: FetchStatus.NOT_FOUND
        };
      }
      throw new ScraperError(
        `Failed to read file ${filePath}: ${error.message ?? "Unknown error"}`,
        false,
        error instanceof Error ? error : void 0
      );
    }
  }
}
class PipelineError extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
    this.name = this.constructor.name;
    if (cause?.stack) {
      this.stack = `${this.stack}
Caused by: ${cause.stack}`;
    }
  }
}
class PipelineStateError extends PipelineError {
}
class CancellationError extends PipelineError {
  constructor(message = "Operation cancelled") {
    super(message);
  }
}
class HttpFetcher {
  maxRetriesDefault;
  baseDelayDefaultMs;
  retryableStatusCodes = [
    408,
    // Request Timeout
    429,
    // Too Many Requests
    500,
    // Internal Server Error
    502,
    // Bad Gateway
    503,
    // Service Unavailable
    504,
    // Gateway Timeout
    525
    // SSL Handshake Failed (Cloudflare specific)
  ];
  nonRetryableErrorCodes = [
    "ENOTFOUND",
    // DNS resolution failed - domain doesn't exist
    "ECONNREFUSED",
    // Connection refused - service not running
    "ENOENT",
    // No such file or directory
    "EACCES",
    // Permission denied
    "EINVAL",
    // Invalid argument
    "EMFILE",
    // Too many open files
    "ENFILE",
    // File table overflow
    "EPERM"
    // Operation not permitted
  ];
  fingerprintGenerator;
  constructor(scraperConfig) {
    this.maxRetriesDefault = scraperConfig.fetcher.maxRetries;
    this.baseDelayDefaultMs = scraperConfig.fetcher.baseDelayMs;
    this.fingerprintGenerator = new FingerprintGenerator();
  }
  canFetch(source) {
    return source.startsWith("http://") || source.startsWith("https://");
  }
  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async fetch(source, options) {
    const maxRetries = options?.maxRetries ?? this.maxRetriesDefault;
    const baseDelay = options?.retryDelay ?? this.baseDelayDefaultMs;
    const followRedirects = options?.followRedirects ?? true;
    const result = await this.performFetch(
      source,
      options,
      maxRetries,
      baseDelay,
      followRedirects
    );
    return result;
  }
  async performFetch(source, options, maxRetries = this.maxRetriesDefault, baseDelay = this.baseDelayDefaultMs, followRedirects = true) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const fingerprint = this.fingerprintGenerator.generateHeaders();
        const headers = {
          ...fingerprint,
          ...options?.headers
          // User-provided headers override generated ones
        };
        if (options?.etag) {
          headers["If-None-Match"] = options.etag;
          logger.debug(
            `Conditional request for ${source} with If-None-Match: ${options.etag}`
          );
        }
        const config = {
          responseType: "arraybuffer",
          headers: {
            ...headers,
            // Override Accept-Encoding to exclude zstd which Axios doesn't handle automatically
            // This prevents servers from sending zstd-compressed content that would appear as binary garbage
            "Accept-Encoding": "gzip, deflate, br"
          },
          timeout: options?.timeout,
          signal: options?.signal,
          // Pass signal to axios
          // Axios follows redirects by default, we need to explicitly disable it if needed
          maxRedirects: followRedirects ? 5 : 0,
          decompress: true,
          // Allow 304 responses to be handled as successful responses
          validateStatus: (status) => {
            return status >= 200 && status < 300 || status === 304;
          }
        };
        const response = await axios.get(source, config);
        if (response.status === 304) {
          logger.debug(`HTTP 304 Not Modified for ${source}`);
          return {
            content: Buffer.from(""),
            mimeType: "text/plain",
            source,
            status: FetchStatus.NOT_MODIFIED
          };
        }
        const contentTypeHeader = response.headers["content-type"];
        const { mimeType, charset } = MimeTypeUtils.parseContentType(contentTypeHeader);
        const contentEncoding = response.headers["content-encoding"];
        let content;
        if (response.data instanceof ArrayBuffer) {
          content = Buffer.from(response.data);
        } else if (Buffer.isBuffer(response.data)) {
          content = response.data;
        } else if (typeof response.data === "string") {
          content = Buffer.from(response.data, "utf-8");
        } else {
          content = Buffer.from(response.data);
        }
        const finalUrl = (
          // Node follow-redirects style
          response.request?.res?.responseUrl || // Some adapters may expose directly
          response.request?.responseUrl || // Fallback to axios recorded config URL
          response.config?.url || source
        );
        const etag = response.headers.etag || response.headers.ETag;
        if (etag) {
          logger.debug(`Received ETag for ${source}: ${etag}`);
        }
        const lastModified = response.headers["last-modified"];
        const lastModifiedISO = lastModified ? new Date(lastModified).toISOString() : void 0;
        return {
          content,
          mimeType,
          charset,
          encoding: contentEncoding,
          source: finalUrl,
          etag,
          lastModified: lastModifiedISO,
          status: FetchStatus.SUCCESS
        };
      } catch (error) {
        const axiosError = error;
        const status = axiosError.response?.status;
        const code = axiosError.code;
        if (options?.signal?.aborted || code === "ERR_CANCELED") {
          throw new CancellationError("HTTP fetch cancelled");
        }
        if (status === 404) {
          logger.debug(`Resource not found (404): ${source}`);
          return {
            content: Buffer.from(""),
            mimeType: "text/plain",
            source,
            status: FetchStatus.NOT_FOUND
          };
        }
        if (!followRedirects && status && status >= 300 && status < 400) {
          const location = axiosError.response?.headers?.location;
          if (location) {
            throw new RedirectError(source, location, status);
          }
        }
        if (status === 403) {
          const cfMitigated = axiosError.response?.headers?.["cf-mitigated"];
          const server = axiosError.response?.headers?.server;
          let responseBody = "";
          if (axiosError.response?.data) {
            try {
              if (typeof axiosError.response.data === "string") {
                responseBody = axiosError.response.data;
              } else if (Buffer.isBuffer(axiosError.response.data)) {
                responseBody = axiosError.response.data.toString("utf-8");
              } else if (axiosError.response.data instanceof ArrayBuffer) {
                responseBody = Buffer.from(axiosError.response.data).toString("utf-8");
              }
            } catch {
            }
          }
          const isCloudflareChallenge = cfMitigated === "challenge" || server === "cloudflare" || responseBody.includes("Enable JavaScript and cookies to continue") || responseBody.includes("Just a moment...") || responseBody.includes("cf_chl_opt");
          if (isCloudflareChallenge) {
            throw new ChallengeError(source, status, "cloudflare");
          }
        }
        if (attempt < maxRetries && (status === void 0 || this.retryableStatusCodes.includes(status)) && !this.nonRetryableErrorCodes.includes(code ?? "")) {
          const delay = baseDelay * 2 ** attempt;
          logger.warn(
            `⚠️  Attempt ${attempt + 1}/${maxRetries + 1} failed for ${source} (Status: ${status}, Code: ${code}). Retrying in ${delay}ms...`
          );
          await this.delay(delay);
          continue;
        }
        throw new ScraperError(
          `Failed to fetch ${source} after ${attempt + 1} attempts: ${axiosError.message ?? "Unknown error"}`,
          true,
          error instanceof Error ? error : void 0
        );
      }
    }
    throw new ScraperError(
      `Failed to fetch ${source} after ${maxRetries + 1} attempts`,
      true
    );
  }
}
class AutoDetectFetcher {
  httpFetcher;
  browserFetcher;
  fileFetcher = new FileFetcher();
  constructor(scraperConfig) {
    this.httpFetcher = new HttpFetcher(scraperConfig);
    this.browserFetcher = new BrowserFetcher(scraperConfig);
  }
  /**
   * Check if this fetcher can handle the given source.
   * Returns true for any URL that any of the underlying fetchers can handle.
   */
  canFetch(source) {
    return this.httpFetcher.canFetch(source) || this.browserFetcher.canFetch(source) || this.fileFetcher.canFetch(source);
  }
  /**
   * Fetch content from the source, automatically selecting the appropriate fetcher
   * and handling fallbacks when challenges are detected.
   */
  async fetch(source, options) {
    if (this.fileFetcher.canFetch(source)) {
      logger.debug(`Using FileFetcher for: ${source}`);
      return this.fileFetcher.fetch(source, options);
    }
    if (this.httpFetcher.canFetch(source)) {
      try {
        logger.debug(`Using HttpFetcher for: ${source}`);
        return await this.httpFetcher.fetch(source, options);
      } catch (error) {
        if (error instanceof ChallengeError) {
          logger.info(
            `🔄 Challenge detected for ${source}, falling back to browser fetcher...`
          );
          return this.browserFetcher.fetch(source, options);
        }
        throw error;
      }
    }
    throw new Error(`No suitable fetcher found for URL: ${source}`);
  }
  /**
   * Close all underlying fetchers to prevent resource leaks.
   */
  async close() {
    await Promise.allSettled([
      this.browserFetcher.close()
      // HttpFetcher and FileFetcher don't need explicit cleanup
    ]);
  }
}
class CancelJobTool {
  pipeline;
  /**
   * Creates an instance of CancelJobTool.
   * @param pipeline The pipeline instance.
   */
  constructor(pipeline) {
    this.pipeline = pipeline;
  }
  /**
   * Executes the tool to attempt cancellation of a specific job.
   * @param input - The input parameters, containing the jobId.
   * @returns A promise that resolves with the outcome message.
   * @throws {ValidationError} If the jobId is invalid.
   * @throws {ToolError} If the job is not found or cancellation fails.
   */
  async execute(input) {
    if (!input.jobId || typeof input.jobId !== "string" || input.jobId.trim() === "") {
      throw new ValidationError(
        "Job ID is required and must be a non-empty string.",
        this.constructor.name
      );
    }
    try {
      const job = await this.pipeline.getJob(input.jobId);
      if (!job) {
        logger.warn(`❓ [CancelJobTool] Job not found: ${input.jobId}`);
        throw new ToolError(
          `Job with ID ${input.jobId} not found.`,
          this.constructor.name
        );
      }
      if (job.status === PipelineJobStatus.COMPLETED || // Use enum member
      job.status === PipelineJobStatus.FAILED || // Use enum member
      job.status === PipelineJobStatus.CANCELLED) {
        logger.debug(`Job ${input.jobId} is already in a final state: ${job.status}.`);
        return {
          message: `Job ${input.jobId} is already ${job.status}. No action taken.`,
          finalStatus: job.status
        };
      }
      await this.pipeline.cancelJob(input.jobId);
      const updatedJob = await this.pipeline.getJob(input.jobId);
      const finalStatus = updatedJob?.status ?? "UNKNOWN (job disappeared?)";
      logger.debug(
        `Cancellation requested for job ${input.jobId}. Current status: ${finalStatus}`
      );
      return {
        message: `Cancellation requested for job ${input.jobId}. Current status: ${finalStatus}.`,
        finalStatus
      };
    } catch (error) {
      logger.error(`❌ Error cancelling job ${input.jobId}: ${error}`);
      throw new ToolError(
        `Failed to cancel job ${input.jobId}: ${error instanceof Error ? error.message : String(error)}`,
        this.constructor.name
      );
    }
  }
}
class ClearCompletedJobsTool {
  pipeline;
  /**
   * Creates an instance of ClearCompletedJobsTool.
   * @param pipeline The pipeline instance.
   */
  constructor(pipeline) {
    this.pipeline = pipeline;
  }
  /**
   * Executes the tool to clear all completed jobs from the pipeline.
   * @param input - The input parameters (currently unused).
   * @returns A promise that resolves with the outcome of the clear operation.
   * @throws {ToolError} If the clear operation fails.
   */
  async execute(_input) {
    try {
      const clearedCount = await this.pipeline.clearCompletedJobs();
      const message = clearedCount > 0 ? `Successfully cleared ${clearedCount} completed job${clearedCount === 1 ? "" : "s"} from the queue.` : "No completed jobs to clear.";
      logger.debug(message);
      return {
        message,
        clearedCount
      };
    } catch (error) {
      const errorMessage = `Failed to clear completed jobs: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`❌ ${errorMessage}`);
      throw new ToolError(errorMessage, this.constructor.name);
    }
  }
}
function createJSDOM(html, options) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("error", () => {
  });
  virtualConsole.on("warn", () => {
  });
  virtualConsole.on("info", () => {
  });
  virtualConsole.on("debug", () => {
  });
  virtualConsole.on("log", () => {
  });
  const defaultOptions = {
    virtualConsole
  };
  const finalOptions = { ...defaultOptions, ...options };
  return new JSDOM(html, finalOptions);
}
const fullTrim = (str) => {
  return str.replace(/^[\s\r\n\t]+|[\s\r\n\t]+$/g, "");
};
const defaultNormalizerOptions = {
  ignoreCase: true,
  removeHash: true,
  removeTrailingSlash: true,
  removeQuery: false,
  removeIndex: true
};
function normalizeUrl(url, options = defaultNormalizerOptions) {
  try {
    const parsedUrl = new URL(url);
    const finalOptions = { ...defaultNormalizerOptions, ...options };
    const normalized = new URL(parsedUrl.origin + parsedUrl.pathname);
    if (finalOptions.removeIndex) {
      normalized.pathname = normalized.pathname.replace(
        /\/index\.(html|htm|asp|php|jsp)$/i,
        "/"
      );
    }
    if (finalOptions.removeTrailingSlash && normalized.pathname.length > 1) {
      normalized.pathname = normalized.pathname.replace(/\/+$/, "");
    }
    const preservedHash = !finalOptions.removeHash ? parsedUrl.hash : "";
    const preservedSearch = !finalOptions.removeQuery ? parsedUrl.search : "";
    let result = normalized.origin + normalized.pathname;
    if (preservedSearch) {
      result += preservedSearch;
    }
    if (preservedHash) {
      result += preservedHash;
    }
    if (finalOptions.ignoreCase) {
      result = result.toLowerCase();
    }
    return result;
  } catch {
    return url;
  }
}
function validateUrl(url) {
  try {
    new URL(url);
  } catch (error) {
    throw new InvalidUrlError(url, error instanceof Error ? error : void 0);
  }
}
function extractPrimaryDomain(hostname) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || /^[0-9a-fA-F:]+$/.test(hostname)) {
    return hostname;
  }
  if (!hostname.includes(".")) {
    return hostname;
  }
  const domain = psl.get(hostname.toLowerCase());
  return domain || hostname;
}
class GreedySplitter {
  baseSplitter;
  minChunkSize;
  preferredChunkSize;
  maxChunkSize;
  /**
   * Combines a base document splitter with size constraints to produce optimally-sized chunks.
   * The base splitter handles the initial semantic splitting, while this class handles
   * the concatenation strategy.
   */
  constructor(baseSplitter, minChunkSize, preferredChunkSize, maxChunkSize) {
    this.baseSplitter = baseSplitter;
    this.minChunkSize = minChunkSize;
    this.preferredChunkSize = preferredChunkSize;
    this.maxChunkSize = maxChunkSize;
  }
  /**
   * Uses a greedy concatenation strategy to build optimally-sized chunks. Small chunks
   * are combined until they reach the minimum size, but splits are preserved at major
   * section boundaries to maintain document structure. This balances the need for
   * context with semantic coherence.
   */
  async splitText(markdown, contentType) {
    const initialChunks = await this.baseSplitter.splitText(markdown, contentType);
    const concatenatedChunks = [];
    let currentChunk = null;
    for (const nextChunk of initialChunks) {
      if (nextChunk.content.length > this.maxChunkSize) {
        logger.warn(
          `⚠ Chunk from base splitter exceeds max size: ${nextChunk.content.length} > ${this.maxChunkSize}`
        );
      }
      if (currentChunk) {
        const combinedSize = currentChunk.content.length + nextChunk.content.length;
        if (combinedSize > this.maxChunkSize) {
          concatenatedChunks.push(currentChunk);
          currentChunk = this.cloneChunk(nextChunk);
          continue;
        }
        if (currentChunk.content.length >= this.minChunkSize && this.startsNewMajorSection(nextChunk) && !this.isSameSection(currentChunk, nextChunk)) {
          concatenatedChunks.push(currentChunk);
          currentChunk = this.cloneChunk(nextChunk);
          continue;
        }
        if (combinedSize > this.preferredChunkSize && currentChunk.content.length >= this.minChunkSize && nextChunk.content.length >= this.minChunkSize) {
          concatenatedChunks.push(currentChunk);
          currentChunk = this.cloneChunk(nextChunk);
          continue;
        }
        currentChunk.content += `${currentChunk.content.endsWith("\n") ? "" : "\n"}${nextChunk.content}`;
        currentChunk.section = this.mergeSectionInfo(currentChunk, nextChunk);
        currentChunk.types = this.mergeTypes(currentChunk.types, nextChunk.types);
      } else {
        currentChunk = this.cloneChunk(nextChunk);
      }
    }
    if (currentChunk) {
      concatenatedChunks.push(currentChunk);
    }
    return concatenatedChunks;
  }
  cloneChunk(chunk) {
    return {
      types: [...chunk.types],
      content: chunk.content,
      section: {
        level: chunk.section.level,
        path: [...chunk.section.path]
      }
    };
  }
  /**
   * H1 and H2 headings represent major conceptual breaks in the document.
   * Preserving these splits helps maintain the document's logical structure.
   */
  startsNewMajorSection(chunk) {
    return chunk.section.level === 1 || chunk.section.level === 2;
  }
  /**
   * Checks if two chunks belong to the same section by comparing their paths.
   * Returns true if the paths are identical or if one is a parent of the other.
   */
  isSameSection(chunk1, chunk2) {
    const path1 = chunk1.section.path;
    const path2 = chunk2.section.path;
    if (path1.length === path2.length && path1.every((part, i) => part === path2[i])) {
      return true;
    }
    return this.isPathIncluded(path1, path2) || this.isPathIncluded(path2, path1);
  }
  /**
   * Checks if one path is a prefix of another path, indicating a parent-child relationship
   */
  isPathIncluded(parentPath, childPath) {
    if (parentPath.length >= childPath.length) return false;
    return parentPath.every((part, i) => part === childPath[i]);
  }
  /**
   * Merges section metadata when concatenating chunks, following these rules:
   * 1. Level: Always uses the lowest (most general) level between chunks
   * 2. Path selection:
   *    - For parent-child relationships (one path includes the other), uses the child's path
   *    - For siblings/unrelated sections, uses the common parent path
   *    - If no common path exists, uses the root path ([])
   */
  mergeSectionInfo(currentChunk, nextChunk) {
    const level = Math.min(currentChunk.section.level, nextChunk.section.level);
    if (currentChunk.section.level === nextChunk.section.level && currentChunk.section.path.length === nextChunk.section.path.length && currentChunk.section.path.every((p, i) => p === nextChunk.section.path[i])) {
      return currentChunk.section;
    }
    if (this.isPathIncluded(currentChunk.section.path, nextChunk.section.path)) {
      return {
        path: nextChunk.section.path,
        level
      };
    }
    if (this.isPathIncluded(nextChunk.section.path, currentChunk.section.path)) {
      return {
        path: currentChunk.section.path,
        level
      };
    }
    const commonPath = this.findCommonPrefix(
      currentChunk.section.path,
      nextChunk.section.path
    );
    return {
      path: commonPath,
      level
    };
  }
  mergeTypes(currentTypes, nextTypes) {
    return [.../* @__PURE__ */ new Set([...currentTypes, ...nextTypes])];
  }
  /**
   * Returns longest common prefix between two paths
   */
  findCommonPrefix(path1, path2) {
    const common = [];
    for (let i = 0; i < Math.min(path1.length, path2.length); i++) {
      if (path1[i] === path2[i]) {
        common.push(path1[i]);
      } else {
        break;
      }
    }
    return common;
  }
}
class SplitterError extends Error {
}
class MinimumChunkSizeError extends SplitterError {
  constructor(size, maxSize) {
    super(
      `Cannot split content any further. Content requires minimum chunk size of ${size} bytes, but maximum allowed is ${maxSize} bytes.`
    );
  }
}
class ContentSplitterError extends SplitterError {
}
class CodeContentSplitter {
  constructor(options) {
    this.options = options;
  }
  async split(content) {
    const language = content.match(/^```(\w+)\n/)?.[1];
    const strippedContent = content.replace(/^```(\w*)\n/, "").replace(/```\s*$/, "");
    const lines = strippedContent.split("\n");
    const chunks = [];
    let currentChunkLines = [];
    for (const line of lines) {
      const singleLineSize = this.wrap(line, language).length;
      if (singleLineSize > this.options.chunkSize) {
        throw new MinimumChunkSizeError(singleLineSize, this.options.chunkSize);
      }
      currentChunkLines.push(line);
      const newChunkContent = this.wrap(currentChunkLines.join("\n"), language);
      const newChunkSize = newChunkContent.length;
      if (newChunkSize > this.options.chunkSize && currentChunkLines.length > 1) {
        const lastLine = currentChunkLines.pop();
        chunks.push(this.wrap(currentChunkLines.join("\n"), language));
        currentChunkLines = [lastLine];
      }
    }
    if (currentChunkLines.length > 0) {
      chunks.push(this.wrap(currentChunkLines.join("\n"), language));
    }
    return chunks;
  }
  wrap(content, language) {
    return `\`\`\`${language || ""}
${content.replace(/\n+$/, "")}
\`\`\``;
  }
}
class TableContentSplitter {
  constructor(options) {
    this.options = options;
  }
  /**
   * Splits table content into chunks while preserving table structure
   */
  async split(content) {
    const parsedTable = this.parseTable(content);
    if (!parsedTable) {
      return [content];
    }
    const { headers, rows } = parsedTable;
    const chunks = [];
    let currentRows = [];
    for (const row of rows) {
      const singleRowSize = this.wrap(row, headers).length;
      if (singleRowSize > this.options.chunkSize) {
        throw new MinimumChunkSizeError(singleRowSize, this.options.chunkSize);
      }
      const newChunkContent = this.wrap([...currentRows, row].join("\n"), headers);
      const newChunkSize = newChunkContent.length;
      if (newChunkSize > this.options.chunkSize && currentRows.length > 0) {
        chunks.push(this.wrap(currentRows.join("\n"), headers));
        currentRows = [row];
      } else {
        currentRows.push(row);
      }
    }
    if (currentRows.length > 0) {
      chunks.push(this.wrap(currentRows.join("\n"), headers));
    }
    return chunks;
  }
  wrap(content, headers) {
    const headerRow = `| ${headers.join(" | ")} |`;
    const separatorRow = `|${headers.map(() => "---").join("|")}|`;
    return [headerRow, separatorRow, content].join("\n");
  }
  parseTable(content) {
    const lines = content.trim().split("\n");
    if (lines.length < 3) return null;
    const headers = this.parseRow(lines[0]);
    if (!headers) return null;
    const separator = lines[1];
    if (!this.isValidSeparator(separator)) return null;
    const rows = lines.slice(2).filter((row) => row.trim() !== "");
    return { headers, separator, rows };
  }
  /**
   * Parses a table row into cells
   */
  parseRow(row) {
    if (!row.includes("|")) return null;
    return row.split("|").map((cell) => cell.trim()).filter((cell) => cell !== "");
  }
  /**
   * Validates the separator row of the table
   */
  isValidSeparator(separator) {
    return separator.includes("|") && /^\|?[\s-|]+\|?$/.test(separator);
  }
}
class TextContentSplitter {
  constructor(options) {
    this.options = options;
  }
  /**
   * Splits text content into chunks while trying to preserve semantic boundaries.
   * Prefers paragraph breaks, then line breaks, finally falling back to word boundaries.
   * Always preserves formatting - trimming should be done by higher-level splitters if needed.
   */
  async split(content) {
    if (content.length <= this.options.chunkSize) {
      return [content];
    }
    const words = content.split(/\s+/);
    const longestWord = words.reduce(
      (max, word) => word.length > max.length ? word : max
    );
    if (longestWord.length > this.options.chunkSize) {
      throw new MinimumChunkSizeError(longestWord.length, this.options.chunkSize);
    }
    const paragraphChunks = this.splitByParagraphs(content);
    if (this.areChunksValid(paragraphChunks)) {
      return paragraphChunks;
    }
    const lineChunks = this.splitByLines(content);
    if (this.areChunksValid(lineChunks)) {
      return this.mergeChunks(lineChunks, "");
    }
    const wordChunks = await this.splitByWords(content);
    return this.mergeChunks(wordChunks, " ");
  }
  /**
   * Checks if all chunks are within the maximum size limit
   */
  areChunksValid(chunks) {
    return chunks.every((chunk) => chunk.length <= this.options.chunkSize);
  }
  /**
   * Splits text into chunks by paragraph boundaries (double newlines)
   * Preserves all formatting and whitespace including the paragraph separators
   */
  splitByParagraphs(text) {
    const chunks = [];
    let startPos = 0;
    const paragraphRegex = /\n\s*\n/g;
    let match = paragraphRegex.exec(text);
    while (match !== null) {
      const endPos = match.index + match[0].length;
      const chunk = text.slice(startPos, endPos);
      if (chunk.length > 2) {
        chunks.push(chunk);
      }
      startPos = endPos;
      match = paragraphRegex.exec(text);
    }
    if (startPos < text.length) {
      const remainingChunk = text.slice(startPos);
      if (remainingChunk.length > 2) {
        chunks.push(remainingChunk);
      }
    }
    return chunks.filter(Boolean);
  }
  /**
   * Splits text into chunks by line boundaries
   * Preserves all formatting and whitespace, including newlines at the end of each line
   */
  splitByLines(text) {
    const chunks = [];
    let startPos = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") {
        const chunk = text.slice(startPos, i + 1);
        chunks.push(chunk);
        startPos = i + 1;
      }
    }
    if (startPos < text.length) {
      chunks.push(text.slice(startPos));
    }
    return chunks;
  }
  /**
   * Uses LangChain's recursive splitter for word-based splitting as a last resort
   */
  async splitByWords(text) {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: this.options.chunkSize,
      chunkOverlap: 0
    });
    const chunks = await splitter.splitText(text);
    return chunks;
  }
  /**
   * Attempts to merge small chunks with previous chunks to minimize fragmentation.
   * Only merges if combined size is within maxChunkSize.
   */
  mergeChunks(chunks, separator) {
    const mergedChunks = [];
    let currentChunk = null;
    for (const chunk of chunks) {
      if (currentChunk === null) {
        currentChunk = chunk;
        continue;
      }
      const currentChunkSize = this.getChunkSize(currentChunk);
      const nextChunkSize = this.getChunkSize(chunk);
      if (currentChunkSize + nextChunkSize + separator.length <= this.options.chunkSize) {
        currentChunk = `${currentChunk}${separator}${chunk}`;
      } else {
        mergedChunks.push(currentChunk);
        currentChunk = chunk;
      }
    }
    if (currentChunk) {
      mergedChunks.push(currentChunk);
    }
    return mergedChunks;
  }
  getChunkSize(chunk) {
    return chunk.length;
  }
  wrap(content) {
    return content;
  }
}
class SemanticMarkdownSplitter {
  constructor(preferredChunkSize, maxChunkSize) {
    this.preferredChunkSize = preferredChunkSize;
    this.maxChunkSize = maxChunkSize;
    this.turndownService = new TurndownService({
      headingStyle: "atx",
      hr: "---",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      emDelimiter: "_",
      strongDelimiter: "**",
      linkStyle: "inlined"
    });
    this.turndownService.addRule("table", {
      filter: ["table"],
      replacement: (_content, node) => {
        const table = node;
        const headers = Array.from(table.querySelectorAll("th")).map(
          (th) => th.textContent?.trim() || ""
        );
        const rows = Array.from(table.querySelectorAll("tr")).filter(
          (tr) => !tr.querySelector("th")
        );
        if (headers.length === 0 && rows.length === 0) return "";
        let markdown = "\n";
        if (headers.length > 0) {
          markdown += `| ${headers.join(" | ")} |
`;
          markdown += `|${headers.map(() => "---").join("|")}|
`;
        }
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll("td")).map(
            (td) => td.textContent?.trim() || ""
          );
          markdown += `| ${cells.join(" | ")} |
`;
        }
        return markdown;
      }
    });
    this.textSplitter = new TextContentSplitter({
      chunkSize: this.preferredChunkSize
    });
    this.codeSplitter = new CodeContentSplitter({
      chunkSize: this.maxChunkSize
    });
    this.tableSplitter = new TableContentSplitter({
      chunkSize: this.maxChunkSize
    });
  }
  turndownService;
  textSplitter;
  codeSplitter;
  tableSplitter;
  /**
   * Main entry point for splitting markdown content
   */
  async splitText(markdown, _contentType) {
    const html = await this.markdownToHtml(markdown);
    const dom = await this.parseHtml(html);
    const sections = await this.splitIntoSections(dom);
    return this.splitSectionContent(sections);
  }
  /**
   * Step 1: Split document into sections based on H1-H6 headings,
   * as well as code blocks and tables.
   */
  async splitIntoSections(dom) {
    const body = dom.querySelector("body");
    if (!body) {
      throw new Error("Invalid HTML structure: no body element found");
    }
    let currentSection = this.createRootSection();
    const sections = [];
    const stack = [currentSection];
    for (const element of Array.from(body.children)) {
      const headingMatch = element.tagName.match(/H([1-6])/);
      if (headingMatch) {
        const level = Number.parseInt(headingMatch[1], 10);
        const title = fullTrim(element.textContent || "");
        while (stack.length > 1 && stack[stack.length - 1].level >= level) {
          stack.pop();
        }
        currentSection = {
          level,
          path: [
            ...stack.slice(1).reduce((acc, s) => {
              const lastPath = s.path[s.path.length - 1];
              if (lastPath) acc.push(lastPath);
              return acc;
            }, []),
            title
          ],
          content: [
            {
              type: "heading",
              text: `${"#".repeat(level)} ${title}`
            }
          ]
        };
        sections.push(currentSection);
        stack.push(currentSection);
      } else if (element.tagName === "PRE") {
        const code = element.querySelector("code");
        const language = code?.className.replace("language-", "") || "";
        const content = code?.textContent || element.textContent || "";
        const markdown = `${"```"}${language}
${content}
${"```"}`;
        currentSection = {
          level: currentSection.level,
          path: currentSection.path,
          content: [
            {
              type: "code",
              text: markdown
            }
          ]
        };
        sections.push(currentSection);
      } else if (element.tagName === "TABLE") {
        const markdown = fullTrim(this.turndownService.turndown(element.outerHTML));
        currentSection = {
          level: currentSection.level,
          path: currentSection.path,
          content: [
            {
              type: "table",
              text: markdown
            }
          ]
        };
        sections.push(currentSection);
      } else {
        const markdown = fullTrim(this.turndownService.turndown(element.innerHTML));
        if (markdown) {
          currentSection = {
            level: currentSection.level,
            path: currentSection.path,
            content: [
              {
                type: "text",
                text: markdown
              }
            ]
          };
          sections.push(currentSection);
        }
      }
    }
    return sections;
  }
  /**
   * Step 2: Split section content into smaller chunks
   */
  async splitSectionContent(sections) {
    const chunks = [];
    for (const section of sections) {
      for (const content of section.content) {
        let splitContent = [];
        try {
          switch (content.type) {
            case "heading":
            case "text": {
              splitContent = await this.textSplitter.split(fullTrim(content.text));
              break;
            }
            case "code": {
              splitContent = await this.codeSplitter.split(content.text);
              break;
            }
            case "table": {
              splitContent = await this.tableSplitter.split(content.text);
              break;
            }
          }
        } catch (err) {
          if (err instanceof MinimumChunkSizeError) {
            logger.warn(
              `⚠ Cannot split ${content.type} chunk normally, using RecursiveCharacterTextSplitter: ${err.message}`
            );
            const splitter = new RecursiveCharacterTextSplitter({
              chunkSize: this.maxChunkSize,
              chunkOverlap: Math.min(20, Math.floor(this.maxChunkSize * 0.1)),
              // Use more aggressive separators including empty string as last resort
              separators: [
                "\n\n",
                "\n",
                " ",
                "	",
                ".",
                ",",
                ";",
                ":",
                "-",
                "(",
                ")",
                "[",
                "]",
                "{",
                "}",
                ""
              ]
            });
            const chunks2 = await splitter.splitText(content.text);
            if (chunks2.length === 0) {
              splitContent = [content.text.substring(0, this.maxChunkSize)];
            } else {
              splitContent = chunks2;
            }
          } else {
            const errMessage = err instanceof Error ? err.message : String(err);
            throw new ContentSplitterError(
              `Failed to split ${content.type} content: ${errMessage}`
            );
          }
        }
        chunks.push(
          ...splitContent.map(
            (text) => ({
              types: [content.type],
              content: text,
              section: {
                level: section.level,
                path: section.path
              }
            })
          )
        );
      }
    }
    return chunks;
  }
  /**
   * Helper to create the root section
   */
  createRootSection() {
    return {
      level: 0,
      path: [],
      content: []
    };
  }
  /**
   * Convert markdown to HTML using remark
   */
  async markdownToHtml(markdown) {
    const html = await unified().use(remarkParse).use(remarkGfm).use(remarkHtml).process(markdown);
    return `<!DOCTYPE html>
      <html>
        <body>
          ${String(html)}
        </body>
      </html>`;
  }
  /**
   * Parse HTML
   */
  async parseHtml(html) {
    const { window: window2 } = createJSDOM(html);
    return window2.document;
  }
}
class HtmlCheerioParserMiddleware {
  async process(context, next) {
    try {
      logger.debug(`Parsing HTML content with Cheerio from ${context.source}`);
      const $ = cheerio.load(context.content);
      context.dom = $;
      await next();
    } catch (error) {
      logger.error(
        `❌ Failed to parse HTML with Cheerio for ${context.source}: ${error}`
      );
      context.errors.push(
        error instanceof Error ? error : new Error(`Cheerio HTML parsing failed: ${String(error)}`)
      );
      return;
    }
  }
}
class HtmlLinkExtractorMiddleware {
  /**
   * Processes the context to extract links from the sanitized HTML body.
   * @param context The current middleware context.
   * @param next Function to call the next middleware.
   */
  async process(context, next) {
    const $ = context.dom;
    if (!$) {
      logger.warn(
        `⏭️ Skipping ${this.constructor.name}: context.dom is missing. Ensure HtmlCheerioParserMiddleware runs before this.`
      );
      await next();
      return;
    }
    try {
      let docBase = context.source;
      try {
        const baseEl = $("base[href]").first();
        const rawBase = baseEl.attr("href");
        if (rawBase && rawBase.trim() !== "") {
          try {
            const trimmed = rawBase.trim();
            const candidate = new URL(trimmed, context.source);
            const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
            const protocolRelative = trimmed.startsWith("//");
            const firstSlash = trimmed.indexOf("/");
            const firstColon = trimmed.indexOf(":");
            const colonBeforeSlash = firstColon !== -1 && (firstSlash === -1 || firstColon < firstSlash);
            const suspiciousColon = colonBeforeSlash && !hasScheme && !protocolRelative;
            if (suspiciousColon || trimmed.startsWith(":")) {
              logger.debug(
                `Ignoring suspicious <base href> value (colon misuse): ${rawBase}`
              );
            } else {
              docBase = candidate.href;
            }
          } catch {
            logger.debug(`Ignoring invalid <base href> value: ${rawBase}`);
          }
        }
      } catch {
      }
      const linkElements = $("a[href]");
      logger.debug(
        `Found ${linkElements.length} potential links in ${context.source} (base=${docBase})`
      );
      const extractedLinks = [];
      linkElements.each((_index, element) => {
        const href = $(element).attr("href");
        if (href && href.trim() !== "") {
          try {
            const urlObj = new URL(href, docBase);
            if (!["http:", "https:", "file:"].includes(urlObj.protocol)) {
              logger.debug(`Ignoring link with invalid protocol: ${href}`);
              return;
            }
            extractedLinks.push(urlObj.href);
          } catch (_e) {
            logger.debug(`Ignoring invalid URL syntax: ${href}`);
          }
        }
      });
      context.links = [...new Set(extractedLinks)];
      logger.debug(
        `Extracted ${context.links.length} unique, valid links from ${context.source}`
      );
    } catch (error) {
      logger.error(`❌ Error extracting links from ${context.source}: ${error}`);
      context.errors.push(
        new Error(
          `Failed to extract links from HTML: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
    await next();
  }
}
class HtmlMetadataExtractorMiddleware {
  /**
   * Processes the context to extract the HTML title.
   * @param context The current processing context.
   * @param next Function to call the next middleware.
   */
  async process(context, next) {
    const $ = context.dom;
    if (!$) {
      logger.warn(
        `⏭️ Skipping ${this.constructor.name}: context.dom is missing. Ensure HtmlCheerioParserMiddleware runs before this.`
      );
      await next();
      return;
    }
    try {
      let title = $("title").first().text().trim();
      if (!title) {
        title = $("h1").first().text().trim();
      }
      title = title || "Untitled";
      title = title.replace(/\s+/g, " ").trim();
      context.title = title;
      logger.debug(`Extracted title: "${title}" from ${context.source}`);
    } catch (error) {
      logger.error(`❌ Error extracting metadata from ${context.source}: ${error}`);
      context.errors.push(
        new Error(
          `Failed to extract metadata from HTML: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
    await next();
  }
}
class HtmlNormalizationMiddleware {
  // Known tracking/analytics domains and patterns to filter out
  trackingPatterns = [
    "adroll.com",
    "doubleclick.net",
    "google-analytics.com",
    "googletagmanager.com",
    "analytics.twitter.com",
    "twitter.com/1/i/adsct",
    "t.co/1/i/adsct",
    "bat.bing.com",
    "pixel.rubiconproject.com",
    "casalemedia.com",
    "tremorhub.com",
    "rlcdn.com",
    "facebook.com/tr",
    "linkedin.com/px",
    "quantserve.com",
    "scorecardresearch.com",
    "hotjar.com",
    "mouseflow.com",
    "crazyegg.com",
    "clarity.ms"
  ];
  async process(context, next) {
    if (!context.dom) {
      logger.debug(
        `Skipping HTML normalization for ${context.source} - no DOM available`
      );
      await next();
      return;
    }
    try {
      logger.debug(`Normalizing HTML URLs and links for ${context.source}`);
      const $ = context.dom;
      const baseUrl = context.source;
      this.normalizeImageUrls($, baseUrl);
      this.normalizeLinks($, baseUrl);
      logger.debug(`Successfully normalized HTML content for ${context.source}`);
    } catch (error) {
      logger.error(`❌ Failed to normalize HTML for ${context.source}: ${error}`);
      context.errors.push(
        error instanceof Error ? error : new Error(`HTML normalization failed: ${String(error)}`)
      );
    }
    await next();
  }
  /**
   * Checks if an image should be kept based on its source URL.
   * Filters out tracking pixels and analytics beacons.
   */
  shouldKeepImage(src) {
    const srcLower = src.toLowerCase();
    return !this.trackingPatterns.some((pattern) => srcLower.includes(pattern));
  }
  /**
   * Normalizes image URLs by converting relative URLs to absolute URLs.
   * Removes tracking/analytics images.
   * Preserves data URIs (inline images).
   */
  normalizeImageUrls($, baseUrl) {
    $("img").each((_index, element) => {
      const $img = $(element);
      const src = $img.attr("src");
      if (!src) {
        $img.remove();
        return;
      }
      if (src.startsWith("data:")) {
        return;
      }
      if (!this.shouldKeepImage(src)) {
        $img.remove();
        return;
      }
      try {
        new URL(src);
      } catch {
        try {
          const absoluteUrl = new URL(src, baseUrl).href;
          $img.attr("src", absoluteUrl);
        } catch (error) {
          logger.debug(`Failed to resolve relative image URL: ${src} - ${error}`);
          $img.remove();
        }
      }
    });
  }
  /**
   * Normalizes links by:
   * - Converting relative URLs to absolute URLs
   * - Unwrapping anchor links (preserving text content)
   * - Unwrapping non-HTTP links (preserving text content)
   */
  normalizeLinks($, baseUrl) {
    $("a").each((_index, element) => {
      const $link = $(element);
      const href = $link.attr("href");
      if (!href) {
        this.unwrapElement($, $link);
        return;
      }
      if (href.startsWith("#")) {
        this.unwrapElement($, $link);
        return;
      }
      try {
        const url = new URL(href);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          this.unwrapElement($, $link);
          return;
        }
      } catch {
        try {
          const absoluteUrl = new URL(href, baseUrl).href;
          $link.attr("href", absoluteUrl);
        } catch (error) {
          logger.debug(`Failed to resolve relative link URL: ${href} - ${error}`);
          this.unwrapElement($, $link);
        }
      }
    });
  }
  /**
   * Unwraps an element by replacing it with its HTML content.
   * This preserves the inner HTML (including nested elements) while removing the wrapping tag.
   */
  unwrapElement(_$, $element) {
    const htmlContent = $element.html() || $element.text();
    $element.replaceWith(htmlContent);
  }
}
var ScrapeMode = /* @__PURE__ */ ((ScrapeMode2) => {
  ScrapeMode2["Fetch"] = "fetch";
  ScrapeMode2["Playwright"] = "playwright";
  ScrapeMode2["Auto"] = "auto";
  return ScrapeMode2;
})(ScrapeMode || {});
class SimpleMemoryCache {
  cache;
  maxSize;
  constructor(maxSize) {
    if (maxSize <= 0) {
      throw new Error("maxSize must be positive");
    }
    this.cache = /* @__PURE__ */ new Map();
    this.maxSize = maxSize;
  }
  /**
   * Retrieve a value from the cache.
   * Marks the key as recently used (moves to end of Map).
   */
  get(key) {
    const value = this.cache.get(key);
    if (value !== void 0) {
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }
  /**
   * Store a value in the cache.
   * If cache is full, evicts the oldest entry first.
   */
  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== void 0) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, value);
  }
  /**
   * Check if a key exists in the cache.
   * Marks the key as recently used (moves to end of Map) to maintain LRU semantics.
   */
  has(key) {
    const exists = this.cache.has(key);
    if (exists) {
      const value = this.cache.get(key);
      if (value !== void 0) {
        this.cache.delete(key);
        this.cache.set(key, value);
      }
    }
    return exists;
  }
  /**
   * Get current cache size.
   */
  get size() {
    return this.cache.size;
  }
  /**
   * Clear all entries from the cache.
   */
  clear() {
    this.cache.clear();
  }
}
class HtmlPlaywrightMiddleware {
  browser = null;
  config;
  // Static LRU cache for all fetched resources, shared across instances
  static resourceCache = new SimpleMemoryCache(
    defaults.scraper.fetcher.maxCacheItems
  );
  constructor(config) {
    this.config = config;
  }
  /**
   * Initializes the Playwright browser instance.
   * Consider making this more robust (e.g., lazy initialization, singleton).
   */
  async ensureBrowser() {
    if (!this.browser || !this.browser.isConnected()) {
      logger.debug("Launching new Playwright browser instance (Chromium)");
      this.browser = await BrowserFetcher.launchBrowser();
      this.browser.on("disconnected", () => {
        logger.debug("Playwright browser instance disconnected.");
        this.browser = null;
      });
    }
    return this.browser;
  }
  /**
   * Closes the Playwright browser instance if it exists.
   * Should be called during application shutdown.
   */
  async closeBrowser() {
    if (this.browser?.isConnected()) {
      logger.debug("Closing Playwright browser instance...");
      await this.browser.close();
      this.browser = null;
    }
  }
  /**
   * Injects the shadow DOM extractor script into the page.
   * This script performs non-invasive extraction that preserves document structure.
   * The extraction function is called just-in-time when content is actually needed, ensuring we capture
   * the final state of all shadow DOMs after page loading is complete.
   * Returns an array of shadow mappings directly (empty array = no shadow DOMs found).
   */
  async injectShadowDOMExtractor(page) {
    await page.addInitScript(`
      window.shadowExtractor = {
        extract() {
          // Extract shadow DOM mappings
          const shadowMappings = [];
          
          function createShadowMapping(root, depth = 0) {
            if (depth > 15) return;
            
            // Use TreeWalker to traverse in document order
            const walker = document.createTreeWalker(
              root,
              NodeFilter.SHOW_ELEMENT,
              null,
              false
            );
            
            let currentNode = walker.nextNode();
            while (currentNode) {
              const element = currentNode;
              if (element.shadowRoot) {
                try {
                  // Extract shadow DOM content without modifying anything
                  const shadowChildren = Array.from(element.shadowRoot.children);
                  const shadowHTML = shadowChildren.map(child => child.outerHTML).join('\\n');
                  
                  if (shadowHTML.trim()) {
                    // Get position info for precise insertion later
                    const rect = element.getBoundingClientRect();
                    const elementIndex = Array.from(element.parentNode?.children || []).indexOf(element);
                    
                    shadowMappings.push({
                      shadowContent: shadowHTML,
                      hostTagName: element.tagName,
                      hostClasses: element.className || '',
                      hostId: element.id || '',
                      hostOuterHTML: element.outerHTML,
                      elementIndex: elementIndex,
                      parentTagName: element.parentNode?.tagName || '',
                      positionTop: rect.top,
                      positionLeft: rect.left
                    });
                  }
                  
                  // Recursively process nested shadow DOMs
                  createShadowMapping(element.shadowRoot, depth + 1);
                  
                } catch (error) {
                  console.debug('Shadow DOM access error:', error);
                }
              }
              currentNode = walker.nextNode();
            }
          }
          
          createShadowMapping(document);
          
          return shadowMappings;
        }
      };
      
    `);
  }
  /**
   * Extracts content using either shadow DOM non-invasive extraction or standard page.content() method.
   * Returns the extracted content and the method used.
   *
   * Performs just-in-time shadow DOM extraction after all page loading is complete.
   */
  async extractContentWithShadowDOMSupport(page) {
    const [shadowMappings, originalPageContent] = await Promise.all([
      page.evaluate(() => {
        return window.shadowExtractor?.extract() || [];
      }),
      page.content()
    ]);
    if (shadowMappings.length === 0) {
      logger.debug("No shadow DOMs detected - using page.content()");
      return { content: originalPageContent, method: "page.content()" };
    } else {
      logger.debug(
        `Shadow DOMs detected - found ${shadowMappings.length} shadow host(s)`
      );
      logger.debug("Combining content outside browser (non-invasive)");
      const finalContent = this.combineContentSafely(originalPageContent, shadowMappings);
      return { content: finalContent, method: "non-invasive shadow DOM extraction" };
    }
  }
  /**
   * Waits for common loading indicators (spinners, loaders) that are currently visible to disappear from the page or frame.
   * Only waits for selectors that are present and visible at the time of check.
   *
   * @param pageOrFrame The Playwright page or frame instance to operate on.
   */
  async waitForLoadingToComplete(pageOrFrame) {
    const commonLoadingSelectors = [
      '[class*="loading"]',
      '[class*="spinner"]',
      '[class*="loader"]',
      '[id*="loading"]',
      '[class*="preload"]',
      "#loading",
      '[aria-label*="loading" i]',
      '[aria-label*="spinner" i]'
    ];
    const waitPromises = [];
    for (const selector of commonLoadingSelectors) {
      try {
        const isVisible = await pageOrFrame.isVisible(selector).catch(() => false);
        if (isVisible) {
          waitPromises.push(
            pageOrFrame.waitForSelector(selector, {
              state: "hidden",
              timeout: this.config.pageTimeoutMs
            }).catch(() => {
            })
          );
        }
      } catch {
      }
    }
    if (waitPromises.length > 0) {
      await Promise.all(waitPromises);
    }
  }
  /**
   * Waits for all iframes on the page to load their content.
   * For each iframe, waits for the body to appear and loading indicators to disappear.
   *
   * @param page The Playwright page instance to operate on.
   */
  async waitForIframesToLoad(page) {
    try {
      const iframes = await page.$$("iframe");
      if (iframes.length === 0) {
        return;
      }
      logger.debug(`Found ${iframes.length} iframe(s) on ${page.url()}`);
      const iframePromises = iframes.map(
        (iframe, index) => this.processIframe(page, iframe, index)
      );
      await Promise.all(iframePromises);
      logger.debug(`Finished waiting for all iframes to load`);
    } catch (error) {
      logger.debug(`Error during iframe loading for ${page.url()}: ${error}`);
    }
  }
  /**
   * Processes a single iframe: validates, extracts content, and replaces in main page.
   *
   * @param page The main page containing the iframe
   * @param iframe The iframe element handle
   * @param index The iframe index for logging/identification
   */
  async processIframe(page, iframe, index) {
    try {
      const src = await iframe.getAttribute("src");
      if (this.shouldSkipIframeSrc(src)) {
        logger.debug(`Skipping iframe ${index + 1} - no valid src (${src})`);
        return;
      }
      logger.debug(`Waiting for iframe ${index + 1} to load: ${src}`);
      const frame = await iframe.contentFrame();
      if (!frame) {
        logger.debug(`Could not access content frame for iframe ${index + 1}`);
        return;
      }
      try {
        await frame.waitForSelector("body", {
          timeout: this.config.pageTimeoutMs
        });
      } catch {
        logger.debug(
          `Timeout waiting for body in iframe ${index + 1} - skipping content extraction`
        );
        return;
      }
      try {
        await this.waitForLoadingToComplete(frame);
      } catch {
        logger.debug(
          `Timeout waiting for loading indicators in iframe ${index + 1} - proceeding anyway`
        );
      }
      let content = null;
      try {
        content = await this.extractIframeContent(frame);
      } catch (error) {
        logger.debug(`Error extracting content from iframe ${index + 1}: ${error}`);
        return;
      }
      if (content && content.trim().length > 0) {
        await this.replaceIframeWithContent(page, index, content);
        logger.debug(
          `Successfully extracted and replaced content for iframe ${index + 1}: ${src}`
        );
      } else {
        logger.debug(`Iframe ${index + 1} body content is empty: ${src}`);
      }
      logger.debug(`Successfully loaded iframe ${index + 1}: ${src}`);
    } catch (error) {
      logger.debug(`Error processing iframe ${index + 1}: ${error}`);
    }
  }
  /**
   * Determines if an iframe src should be skipped during processing.
   *
   * @param src The iframe src attribute value
   * @returns true if the iframe should be skipped
   */
  shouldSkipIframeSrc(src) {
    return !src || src.startsWith("data:") || src.startsWith("javascript:") || src === "about:blank";
  }
  /**
   * Extracts the body innerHTML from an iframe.
   *
   * @param frame The iframe's content frame
   * @returns The extracted HTML content or null if extraction fails
   */
  async extractIframeContent(frame) {
    try {
      return await frame.$eval("body", (el) => el.innerHTML);
    } catch (error) {
      logger.debug(`Error extracting iframe content: ${error}`);
      return null;
    }
  }
  /**
   * Replaces an iframe element with its extracted content in the main page.
   *
   * @param page The main page containing the iframe
   * @param index The iframe index (0-based)
   * @param content The extracted content to replace the iframe with
   */
  async replaceIframeWithContent(page, index, content) {
    await page.evaluate(
      (args) => {
        const [iframeIndex, bodyContent] = args;
        const iframe = document.querySelectorAll("iframe")[iframeIndex];
        if (iframe && bodyContent) {
          const replacement = document.createElement("div");
          replacement.innerHTML = bodyContent;
          iframe.parentNode?.replaceChild(replacement, iframe);
        }
      },
      [index, content]
    );
  }
  /**
   * Waits for and processes framesets on the page by extracting content from each frame
   * and replacing the frameset with merged content.
   *
   * @param page The Playwright page instance to operate on.
   */
  async waitForFramesetsToLoad(page) {
    try {
      const framesets = await page.$$("frameset");
      if (framesets.length === 0) {
        return;
      }
      logger.debug(`Found ${framesets.length} frameset(s) on ${page.url()}`);
      const frameUrls = await this.extractFrameUrls(page);
      if (frameUrls.length === 0) {
        logger.debug("No frame URLs found in framesets");
        return;
      }
      logger.debug(`Found ${frameUrls.length} frame(s) to process`);
      const frameContents = [];
      for (const frameInfo of frameUrls) {
        try {
          const content = await this.fetchFrameContent(page, frameInfo.src);
          if (content && content.trim().length > 0) {
            frameContents.push({
              url: frameInfo.src,
              content,
              name: frameInfo.name
            });
            logger.debug(`Successfully fetched content from frame: ${frameInfo.src}`);
          } else {
            logger.debug(`Frame content is empty: ${frameInfo.src}`);
          }
        } catch (error) {
          logger.debug(`Error fetching frame content from ${frameInfo.src}: ${error}`);
        }
      }
      if (frameContents.length > 0) {
        await this.mergeFrameContents(page, frameContents);
        logger.debug(
          `Successfully merged ${frameContents.length} frame(s) into main page`
        );
      }
      logger.debug(`Finished processing framesets`);
    } catch (error) {
      logger.debug(`Error during frameset processing for ${page.url()}: ${error}`);
    }
  }
  /**
   * Extracts frame URLs from all framesets on the page in document order.
   *
   * @param page The Playwright page instance to operate on.
   * @returns Array of frame information objects with src and optional name.
   */
  async extractFrameUrls(page) {
    try {
      return await page.evaluate(() => {
        const frames = [];
        const frameElements = document.querySelectorAll("frame");
        for (const frame of frameElements) {
          const src = frame.getAttribute("src");
          if (src?.trim() && !src.startsWith("javascript:") && src !== "about:blank") {
            const name = frame.getAttribute("name") || void 0;
            frames.push({ src: src.trim(), name });
          }
        }
        return frames;
      });
    } catch (error) {
      logger.debug(`Error extracting frame URLs: ${error}`);
      return [];
    }
  }
  /**
   * Sets up caching route interception for a Playwright page.
   * This handles:
   * - Aborting non-essential resources (images, fonts, media)
   * - Caching GET requests to speed up subsequent loads
   * - Forwarding custom headers and credentials for same-origin requests
   *
   * @param page The Playwright page to set up routing for
   * @param customHeaders Custom headers to forward with requests
   * @param credentials Optional credentials for same-origin requests
   * @param origin The origin for same-origin credential checking
   */
  async setupCachingRouteInterception(page, customHeaders = {}, credentials, origin) {
    await page.route("**/*", async (route) => {
      const reqUrl = route.request().url();
      const reqOrigin = (() => {
        try {
          return new URL(reqUrl).origin;
        } catch {
          return null;
        }
      })();
      const resourceType = route.request().resourceType();
      if (["image", "font", "media"].includes(resourceType)) {
        return route.abort();
      }
      if (route.request().method() === "GET") {
        const cached = HtmlPlaywrightMiddleware.resourceCache.get(reqUrl);
        if (cached !== void 0) {
          logger.debug(`✓ Cache hit for ${resourceType}: ${reqUrl}`);
          return route.fulfill({
            status: 200,
            contentType: cached.contentType,
            body: cached.body
          });
        }
        const headers2 = mergePlaywrightHeaders(
          route.request().headers(),
          customHeaders,
          credentials,
          origin,
          reqOrigin ?? void 0
        );
        try {
          const response = await route.fetch({ headers: headers2 });
          const body = await response.text();
          if (response.status() >= 200 && response.status() < 300 && body.length > 0) {
            const contentSizeBytes = Buffer.byteLength(body, "utf8");
            if (contentSizeBytes <= this.config.fetcher.maxCacheItemSizeBytes) {
              const contentType = response.headers()["content-type"] || "application/octet-stream";
              HtmlPlaywrightMiddleware.resourceCache.set(reqUrl, { body, contentType });
              logger.debug(
                `Cached ${resourceType}: ${reqUrl} (${contentSizeBytes} bytes, cache size: ${HtmlPlaywrightMiddleware.resourceCache.size})`
              );
            } else {
              logger.debug(
                `Resource too large to cache: ${reqUrl} (${contentSizeBytes} bytes > ${this.config.fetcher.maxCacheItemSizeBytes} bytes limit)`
              );
            }
          }
          return route.fulfill({ response });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.debug(
            `Network error fetching ${resourceType} ${reqUrl}: ${errorMessage}`
          );
          return route.abort("failed");
        }
      }
      const headers = mergePlaywrightHeaders(
        route.request().headers(),
        customHeaders,
        credentials,
        origin,
        reqOrigin ?? void 0
      );
      try {
        return await route.continue({ headers });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.debug(`Network error for ${resourceType} ${reqUrl}: ${errorMessage}`);
        return route.abort("failed");
      }
    });
  }
  /**
   * Fetches content from a frame URL by navigating to it in a new page.
   * Uses LRU cache to avoid re-fetching identical frames across multiple pages.
   *
   * @param parentPage The parent page (used to resolve relative URLs and share context)
   * @param frameUrl The URL of the frame to fetch content from
   * @returns The HTML content of the frame
   */
  async fetchFrameContent(parentPage, frameUrl) {
    const resolvedUrl = new URL(frameUrl, parentPage.url()).href;
    const cached = HtmlPlaywrightMiddleware.resourceCache.get(resolvedUrl);
    if (cached !== void 0) {
      logger.debug(`✓ Cache hit for frame: ${resolvedUrl}`);
      return cached.body;
    }
    logger.debug(`Cache miss for frame: ${resolvedUrl}`);
    let framePage = null;
    try {
      framePage = await parentPage.context().newPage();
      await this.setupCachingRouteInterception(framePage);
      logger.debug(`Fetching frame content from: ${resolvedUrl}`);
      await framePage.goto(resolvedUrl, {
        waitUntil: "load",
        timeout: this.config.pageTimeoutMs
      });
      await framePage.waitForSelector("body", {
        timeout: this.config.pageTimeoutMs
      });
      await this.waitForLoadingToComplete(framePage);
      const bodyContent = await framePage.$eval(
        "body",
        (el) => el.innerHTML
      );
      const content = bodyContent || "";
      const contentSizeBytes = Buffer.byteLength(content, "utf8");
      if (contentSizeBytes <= this.config.fetcher.maxCacheItemSizeBytes) {
        HtmlPlaywrightMiddleware.resourceCache.set(resolvedUrl, {
          body: content,
          contentType: "text/html"
        });
        logger.debug(
          `Cached frame content: ${resolvedUrl} (${contentSizeBytes} bytes, cache size: ${HtmlPlaywrightMiddleware.resourceCache.size})`
        );
      } else {
        logger.debug(
          `Frame content too large to cache: ${resolvedUrl} (${contentSizeBytes} bytes > ${this.config.fetcher.maxCacheItemSizeBytes} bytes limit)`
        );
      }
      logger.debug(`Successfully fetched frame content from: ${resolvedUrl}`);
      return content;
    } catch (error) {
      logger.debug(`Error fetching frame content from ${frameUrl}: ${error}`);
      return "";
    } finally {
      if (framePage) {
        await framePage.unroute("**/*");
        await framePage.close();
      }
    }
  }
  /**
   * Merges frame contents and replaces the frameset structure with the merged content.
   *
   * @param page The main page containing the frameset
   * @param frameContents Array of frame content objects with URL, content, and optional name
   */
  async mergeFrameContents(page, frameContents) {
    try {
      const mergedContent = frameContents.map((frame, index) => {
        const frameName = frame.name ? ` (${frame.name})` : "";
        const frameHeader = `<!-- Frame ${index + 1}${frameName}: ${frame.url} -->`;
        return `${frameHeader}
<div data-frame-url="${frame.url}" data-frame-name="${frame.name || ""}">
${frame.content}
</div>`;
      }).join("\n\n");
      await page.evaluate((mergedHtml) => {
        const framesets = document.querySelectorAll("frameset");
        if (framesets.length > 0) {
          const body = document.createElement("body");
          body.innerHTML = mergedHtml;
          const firstFrameset = framesets[0];
          if (firstFrameset.parentNode) {
            firstFrameset.parentNode.replaceChild(body, firstFrameset);
          }
          for (let i = 1; i < framesets.length; i++) {
            const frameset = framesets[i];
            if (frameset.parentNode) {
              frameset.parentNode.removeChild(frameset);
            }
          }
        }
      }, mergedContent);
      logger.debug("Successfully replaced frameset with merged content");
    } catch (error) {
      logger.debug(`Error merging frame contents: ${error}`);
    }
  }
  /**
   * Processes the context using Playwright, rendering dynamic content and propagating credentials for all same-origin requests.
   *
   * - Parses credentials from the URL (if present).
   * - Uses browser.newContext({ httpCredentials }) for HTTP Basic Auth on the main page and subresources.
   * - Injects Authorization header for all same-origin requests if credentials are present and not already set.
   * - Forwards all custom headers from context.options?.headers to Playwright requests.
   * - Waits for common loading indicators to disappear before extracting HTML.
   *
   * @param context The middleware context containing the HTML and source URL.
   * @param next The next middleware function in the pipeline.
   */
  async process(context, next) {
    const contentType = context.options?.headers?.["content-type"] || context.contentType;
    if (contentType && typeof contentType === "string" && !MimeTypeUtils.isHtml(contentType)) {
      logger.debug(
        `Skipping Playwright rendering for ${context.source} - content type '${contentType}' is not HTML`
      );
      await next();
      return;
    }
    const scrapeMode = context.options?.scrapeMode ?? ScrapeMode.Auto;
    const shouldRunPlaywright = scrapeMode === ScrapeMode.Playwright || scrapeMode === ScrapeMode.Auto;
    if (!shouldRunPlaywright) {
      logger.debug(
        `Skipping Playwright rendering for ${context.source} as scrapeMode is '${scrapeMode}'.`
      );
      await next();
      return;
    }
    logger.debug(
      `Running Playwright rendering for ${context.source} (scrapeMode: '${scrapeMode}')`
    );
    let page = null;
    let browserContext = null;
    let renderedHtml = null;
    const { credentials, origin } = extractCredentialsAndOrigin(context.source);
    const customHeaders = context.options?.headers ?? {};
    try {
      const browser = await this.ensureBrowser();
      if (credentials) {
        browserContext = await browser.newContext({ httpCredentials: credentials });
      } else {
        browserContext = await browser.newContext();
      }
      page = await browserContext.newPage();
      logger.debug(`Playwright: Processing ${context.source}`);
      await this.injectShadowDOMExtractor(page);
      await page.route("**/*", async (route) => {
        const reqUrl = route.request().url();
        if (reqUrl === context.source) {
          return route.fulfill({
            status: 200,
            contentType: "text/html; charset=utf-8",
            body: context.content
          });
        }
        const reqOrigin = (() => {
          try {
            return new URL(reqUrl).origin;
          } catch {
            return null;
          }
        })();
        const resourceType = route.request().resourceType();
        if (["image", "font", "media"].includes(resourceType)) {
          return route.abort();
        }
        if (route.request().method() === "GET") {
          const cached = HtmlPlaywrightMiddleware.resourceCache.get(reqUrl);
          if (cached !== void 0) {
            logger.debug(`✓ Cache hit for ${resourceType}: ${reqUrl}`);
            return route.fulfill({
              status: 200,
              contentType: cached.contentType,
              body: cached.body
            });
          }
          const headers2 = mergePlaywrightHeaders(
            route.request().headers(),
            customHeaders,
            credentials ?? void 0,
            origin ?? void 0,
            reqOrigin ?? void 0
          );
          try {
            const response = await route.fetch({ headers: headers2 });
            const body = await response.text();
            if (response.status() >= 200 && response.status() < 300 && body.length > 0) {
              const contentSizeBytes = Buffer.byteLength(body, "utf8");
              const maxCacheItemSizeBytes = this.config?.fetcher?.maxCacheItemSizeBytes ?? defaults.scraper.fetcher.maxCacheItemSizeBytes;
              if (contentSizeBytes <= maxCacheItemSizeBytes) {
                const contentType2 = response.headers()["content-type"] || "application/octet-stream";
                HtmlPlaywrightMiddleware.resourceCache.set(reqUrl, { body, contentType: contentType2 });
                logger.debug(
                  `Cached ${resourceType}: ${reqUrl} (${contentSizeBytes} bytes, cache size: ${HtmlPlaywrightMiddleware.resourceCache.size})`
                );
              } else {
                logger.debug(
                  `Resource too large to cache: ${reqUrl} (${contentSizeBytes} bytes > ${maxCacheItemSizeBytes} bytes limit)`
                );
              }
            }
            return route.fulfill({ response });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.debug(
              `Network error fetching ${resourceType} ${reqUrl}: ${errorMessage}`
            );
            return route.abort("failed");
          }
        }
        const headers = mergePlaywrightHeaders(
          route.request().headers(),
          customHeaders,
          credentials ?? void 0,
          origin ?? void 0,
          reqOrigin ?? void 0
        );
        try {
          return await route.continue({ headers });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.debug(`Network error for ${resourceType} ${reqUrl}: ${errorMessage}`);
          return route.abort("failed");
        }
      });
      await page.goto(context.source, { waitUntil: "load" });
      const pageTimeoutMs = this.config.pageTimeoutMs ?? defaults.scraper.pageTimeoutMs;
      await page.waitForSelector("body, frameset", {
        timeout: pageTimeoutMs
      });
      try {
        await page.waitForLoadState("networkidle", {
          timeout: pageTimeoutMs
        });
      } catch {
        logger.debug("Network idle timeout, proceeding anyway");
      }
      await this.waitForLoadingToComplete(page);
      await this.waitForIframesToLoad(page);
      await this.waitForFramesetsToLoad(page);
      const { content, method } = await this.extractContentWithShadowDOMSupport(page);
      renderedHtml = content;
      logger.debug(
        `Playwright: Successfully rendered content for ${context.source} using ${method}`
      );
    } catch (error) {
      logger.error(`❌ Playwright failed to render ${context.source}: ${error}`);
      context.errors.push(
        error instanceof Error ? error : new Error(`Playwright rendering failed: ${String(error)}`)
      );
    } finally {
      if (page) {
        await page.unroute("**/*");
        await page.close();
      }
      if (browserContext) {
        await browserContext.close();
      }
    }
    if (renderedHtml !== null) {
      context.content = renderedHtml;
      logger.debug(
        `Playwright middleware updated content for ${context.source}. Proceeding.`
      );
    } else {
      logger.warn(
        `⚠️  Playwright rendering resulted in null content for ${context.source}. Proceeding without content update.`
      );
    }
    await next();
  }
  /**
   * Safely combines original page content with shadow DOM content outside the browser context.
   * This avoids triggering any anti-scraping detection mechanisms.
   */
  combineContentSafely(originalContent, shadowMappings) {
    let combinedContent = originalContent;
    const bodyCloseIndex = combinedContent.lastIndexOf("</body>");
    if (bodyCloseIndex !== -1) {
      let shadowContentHTML = "\n<!-- SHADOW DOM CONTENT EXTRACTED SAFELY -->\n";
      const sortedMappings = shadowMappings.sort(
        (a, b) => b.shadowContent.length - a.shadowContent.length
      );
      sortedMappings.forEach((mapping) => {
        shadowContentHTML += `
<!-- SHADOW CONTENT: ${mapping.hostTagName} (${mapping.shadowContent.length} chars) -->
`;
        shadowContentHTML += mapping.shadowContent;
        shadowContentHTML += `
<!-- END SHADOW CONTENT: ${mapping.hostTagName} -->
`;
      });
      shadowContentHTML += "\n<!-- END ALL SHADOW DOM CONTENT -->\n";
      combinedContent = combinedContent.slice(0, bodyCloseIndex) + shadowContentHTML + combinedContent.slice(bodyCloseIndex);
    }
    return combinedContent;
  }
}
function extractCredentialsAndOrigin(urlString) {
  try {
    const url = new URL(urlString);
    const origin = url.origin;
    if (url.username && url.password) {
      return {
        credentials: { username: url.username, password: url.password },
        origin
      };
    }
    return { credentials: null, origin };
  } catch {
    return { credentials: null, origin: null };
  }
}
function mergePlaywrightHeaders(requestHeaders, customHeaders, credentials, origin, reqOrigin) {
  let headers = { ...requestHeaders };
  for (const [key, value] of Object.entries(customHeaders)) {
    if (key.toLowerCase() === "authorization" && headers.authorization) continue;
    headers[key] = value;
  }
  if (credentials && origin && reqOrigin === origin && !headers.authorization) {
    const basic = Buffer.from(`${credentials.username}:${credentials.password}`).toString(
      "base64"
    );
    headers = {
      ...headers,
      Authorization: `Basic ${basic}`
    };
  }
  return headers;
}
class HtmlSanitizerMiddleware {
  // Default selectors to remove
  defaultSelectorsToRemove = [
    "nav",
    "footer",
    "script",
    "style",
    "noscript",
    "svg",
    "link",
    "meta",
    "iframe",
    "header",
    "button",
    "input",
    "textarea",
    "select",
    // "form", // Keep commented
    ".ads",
    ".advertisement",
    ".banner",
    ".cookie-banner",
    ".cookie-consent",
    ".hidden",
    ".hide",
    ".modal",
    ".nav-bar",
    ".overlay",
    ".popup",
    ".promo",
    ".mw-editsection",
    ".side-bar",
    ".social-share",
    ".sticky",
    "#ads",
    "#banner",
    "#cookieBanner",
    "#modal",
    "#nav",
    "#overlay",
    "#popup",
    "#sidebar",
    "#socialMediaBox",
    "#stickyHeader",
    "#ad-container",
    ".ad-container",
    ".login-form",
    ".signup-form",
    ".tooltip",
    ".dropdown-menu",
    // ".alert", // Keep commented
    ".breadcrumb",
    ".pagination",
    // '[role="alert"]', // Keep commented
    '[role="banner"]',
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[role="region"][aria-label*="skip" i]',
    '[aria-modal="true"]',
    ".noprint"
  ];
  async process(context, next) {
    const $ = context.dom;
    if (!$) {
      logger.warn(
        `⏭️ Skipping ${this.constructor.name}: context.dom is missing. Ensure HtmlCheerioParserMiddleware runs before this.`
      );
      await next();
      return;
    }
    try {
      const bodyBeforeSanitization = $("body").html() || "";
      const textLengthBefore = $("body").text().trim().length;
      const selectorsToRemove = [
        ...context.options.excludeSelectors || [],
        // Use options from the context
        ...this.defaultSelectorsToRemove
      ];
      logger.debug(
        `Removing elements matching ${selectorsToRemove.length} selectors for ${context.source}`
      );
      let removedCount = 0;
      for (const selector of selectorsToRemove) {
        try {
          const elements = $(selector);
          const filteredElements = elements.filter(function() {
            const tagName = $(this).prop("tagName")?.toLowerCase();
            return tagName !== "html" && tagName !== "body";
          });
          const count = filteredElements.length;
          if (count > 0) {
            filteredElements.remove();
            removedCount += count;
          }
        } catch (selectorError) {
          logger.warn(
            `⚠️  Potentially invalid selector "${selector}" during element removal: ${selectorError}`
          );
          context.errors.push(
            new Error(`Invalid selector "${selector}": ${selectorError}`)
          );
        }
      }
      logger.debug(`Removed ${removedCount} elements for ${context.source}`);
      const textLengthAfter = $("body").text().trim().length;
      if (textLengthBefore > 0 && textLengthAfter === 0) {
        logger.warn(
          `⚠️  Sanitization removed all content from ${context.source}. Reverting to pre-sanitization state.`
        );
        $("body").html(bodyBeforeSanitization);
      }
    } catch (error) {
      logger.error(
        `❌ Error during HTML element removal for ${context.source}: ${error}`
      );
      context.errors.push(
        error instanceof Error ? error : new Error(`HTML element removal failed: ${String(error)}`)
      );
    }
    await next();
  }
}
class HtmlToMarkdownMiddleware {
  turndownService;
  constructor() {
    this.turndownService = new TurndownService({
      headingStyle: "atx",
      hr: "---",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      emDelimiter: "_",
      strongDelimiter: "**",
      linkStyle: "inlined"
    });
    this.turndownService.use(gfm);
    this.addCustomRules();
  }
  addCustomRules() {
    this.turndownService.addRule("pre", {
      filter: ["pre"],
      replacement: (_content, node) => {
        const element = node;
        let language = element.getAttribute("data-language") || "";
        if (!language) {
          const highlightElement = element.closest(
            '[class*="highlight-source-"], [class*="highlight-"], [class*="language-"]'
          ) || element.querySelector(
            '[class*="highlight-source-"], [class*="highlight-"], [class*="language-"]'
          );
          if (highlightElement) {
            const className = highlightElement.className;
            const match = className.match(
              /(?:highlight-source-|highlight-|language-)(\w+)/
            );
            if (match) language = match[1];
          }
        }
        const brElements = Array.from(element.querySelectorAll("br"));
        for (const br of brElements) {
          br.replaceWith("\n");
        }
        const text = element.textContent || "";
        return `
\`\`\`${language}
${text.replace(/^\n+|\n+$/g, "")}
\`\`\`
`;
      }
    });
    this.turndownService.addRule("anchor", {
      filter: ["a"],
      replacement: (content, node) => {
        const href = node.getAttribute("href");
        if (!content || content === "#") {
          return "";
        }
        if (!href) {
          return content;
        }
        return `[${content}](${href})`;
      }
    });
  }
  /**
   * Processes the context to convert the sanitized HTML body node to Markdown.
   * @param context The current processing context.
   * @param next Function to call the next middleware.
   */
  async process(context, next) {
    const $ = context.dom;
    if (!$) {
      logger.warn(
        `⏭️ Skipping ${this.constructor.name}: context.dom is missing. Ensure HtmlCheerioParserMiddleware ran correctly.`
      );
      await next();
      return;
    }
    try {
      logger.debug(`Converting HTML content to Markdown for ${context.source}`);
      const htmlToConvert = $("body").html() || $.html();
      const markdown = this.turndownService.turndown(htmlToConvert).trim();
      if (!markdown) {
        const warnMsg = `HTML to Markdown conversion resulted in empty content for ${context.source}.`;
        logger.warn(`⚠️  ${warnMsg}`);
        context.content = "";
      } else {
        context.content = markdown;
        logger.debug(`Successfully converted HTML to Markdown for ${context.source}`);
      }
      context.contentType = "text/markdown";
    } catch (error) {
      logger.error(
        `❌ Error converting HTML to Markdown for ${context.source}: ${error}`
      );
      context.errors.push(
        new Error(
          `Failed to convert HTML to Markdown: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
    await next();
  }
}
function detectCharsetFromHtml(htmlContent) {
  const charsetMatch = htmlContent.match(
    /<meta\s+charset\s*=\s*["']?([^"'>\s]+)["']?[^>]*>/i
  );
  if (charsetMatch) {
    return charsetMatch[1].toLowerCase();
  }
  const httpEquivMatch = htmlContent.match(
    /<meta\s+http-equiv\s*=\s*["']?content-type["']?\s+content\s*=\s*["']?[^"'>]*charset=([^"'>\s;]+)/i
  );
  if (httpEquivMatch) {
    return httpEquivMatch[1].toLowerCase();
  }
  return void 0;
}
function resolveCharset(httpCharset, htmlContent, mimeType) {
  if (!mimeType.includes("html")) {
    return httpCharset || "utf-8";
  }
  let htmlString;
  try {
    htmlString = typeof htmlContent === "string" ? htmlContent : htmlContent.toString("utf-8");
  } catch {
    htmlString = typeof htmlContent === "string" ? htmlContent : htmlContent.toString(httpCharset || "latin1");
  }
  const headContent = htmlString.substring(0, 1024);
  const metaCharset = detectCharsetFromHtml(headContent);
  if (metaCharset) {
    logger.debug(`Detected charset from HTML meta tag: ${metaCharset}`);
    return metaCharset;
  }
  if (httpCharset) {
    logger.debug(`Using charset from HTTP header: ${httpCharset}`);
    return httpCharset;
  }
  logger.debug("No charset detected, defaulting to UTF-8");
  return "utf-8";
}
const CHARSET_ALIASES = {
  "iso-8859-1": "latin1",
  "iso_8859-1": "latin1",
  "latin-1": "latin1",
  "windows-1252": "cp1252",
  "cp-1252": "cp1252",
  "ms-ansi": "cp1252",
  utf8: "utf-8",
  unicode: "utf-8",
  "us-ascii": "ascii",
  ascii: "ascii"
};
function normalizeCharset(charset) {
  const normalized = charset.toLowerCase().trim();
  return CHARSET_ALIASES[normalized] || normalized;
}
function convertToString(content, charset) {
  if (typeof content === "string") return content;
  const normalizedCharset = charset ? normalizeCharset(charset) : "utf-8";
  try {
    return iconv.decode(content, normalizedCharset);
  } catch {
    try {
      return iconv.decode(content, "utf-8");
    } catch {
      return iconv.decode(content, "latin1");
    }
  }
}
class BasePipeline {
  /**
   * Determines if this pipeline can process content with the given MIME type.
   * Must be implemented by derived classes.
   */
  canProcess(_mimeType, _content) {
    throw new Error("Method not implemented.");
  }
  /**
   * Processes the raw content through the pipeline.
   * Must be implemented by derived classes.
   */
  async process(_rawContent, _options, _fetcher) {
    throw new Error("Method not implemented.");
  }
  /**
   * Cleanup resources used by this pipeline.
   * Default implementation does nothing - override in derived classes as needed.
   */
  async close() {
  }
  /**
   * Executes a middleware stack on the given context.
   * This is a utility method used by derived pipeline classes.
   *
   * @param middleware - The middleware stack to execute
   * @param context - The context to process
   */
  async executeMiddlewareStack(middleware, context) {
    let index = -1;
    const dispatch = async (i) => {
      if (i <= index) throw new Error("next() called multiple times");
      index = i;
      const mw = middleware[i];
      if (!mw) return;
      await mw.process(context, dispatch.bind(null, i + 1));
    };
    try {
      await dispatch(0);
    } catch (error) {
      context.errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
class HtmlPipeline extends BasePipeline {
  playwrightMiddleware;
  standardMiddleware;
  greedySplitter;
  constructor(config) {
    super();
    const preferredChunkSize = config.splitter.preferredChunkSize;
    const maxChunkSize = config.splitter.maxChunkSize;
    const minChunkSize = config.splitter.minChunkSize;
    this.playwrightMiddleware = new HtmlPlaywrightMiddleware(config.scraper);
    this.standardMiddleware = [
      new HtmlCheerioParserMiddleware(),
      new HtmlMetadataExtractorMiddleware(),
      new HtmlLinkExtractorMiddleware(),
      new HtmlSanitizerMiddleware(),
      new HtmlNormalizationMiddleware(),
      new HtmlToMarkdownMiddleware()
    ];
    const semanticSplitter = new SemanticMarkdownSplitter(
      preferredChunkSize,
      maxChunkSize
    );
    this.greedySplitter = new GreedySplitter(
      semanticSplitter,
      minChunkSize,
      preferredChunkSize,
      maxChunkSize
    );
  }
  canProcess(mimeType) {
    return MimeTypeUtils.isHtml(mimeType);
  }
  async process(rawContent, options, fetcher) {
    const resolvedCharset = resolveCharset(
      rawContent.charset,
      rawContent.content,
      rawContent.mimeType
    );
    const contentString = convertToString(rawContent.content, resolvedCharset);
    const context = {
      content: contentString,
      contentType: rawContent.mimeType || "text/html",
      source: rawContent.source,
      // metadata: {},
      links: [],
      errors: [],
      options,
      fetcher
    };
    let middleware = [...this.standardMiddleware];
    if (options.scrapeMode === "playwright" || options.scrapeMode === "auto") {
      middleware = [this.playwrightMiddleware, ...middleware];
    }
    await this.executeMiddlewareStack(middleware, context);
    const chunks = await this.greedySplitter.splitText(
      typeof context.content === "string" ? context.content : ""
    );
    return {
      title: context.title,
      contentType: context.contentType,
      textContent: context.content,
      links: context.links,
      errors: context.errors,
      chunks
    };
  }
  /**
   * Cleanup resources used by this pipeline, specifically the Playwright browser instance.
   */
  async close() {
    await super.close();
    await this.playwrightMiddleware.closeBrowser();
  }
}
class TextDocumentSplitter {
  config;
  textSplitter;
  constructor(config) {
    this.config = config;
    this.textSplitter = new TextContentSplitter({
      chunkSize: this.config.maxChunkSize
    });
  }
  async splitText(content) {
    if (!content.trim()) {
      return [];
    }
    try {
      const chunks = await this.textSplitter.split(content);
      return chunks.map((chunk) => ({
        types: ["text"],
        content: chunk,
        section: {
          level: 0,
          path: []
        }
      }));
    } catch (error) {
      if (!(error instanceof MinimumChunkSizeError) && error instanceof Error) {
        console.warn(
          `Unexpected text splitting error: ${error.message}. Forcing character-based split.`
        );
      }
      const chunks = [];
      let offset = 0;
      while (offset < content.length) {
        const chunkContent = content.substring(offset, offset + this.config.maxChunkSize);
        chunks.push({
          types: ["text"],
          content: chunkContent,
          section: {
            level: 0,
            path: []
          }
        });
        offset += this.config.maxChunkSize;
      }
      return chunks;
    }
  }
}
class JsonDocumentSplitter {
  preserveFormatting;
  maxDepth;
  maxChunks;
  maxChunkSize;
  textFallbackSplitter;
  constructor(config, options = {}) {
    this.preserveFormatting = options.preserveFormatting ?? true;
    this.maxDepth = options.maxDepth ?? config.json?.maxNestingDepth ?? options.maxDepth ?? config.json?.maxNestingDepth ?? defaults.splitter.json.maxNestingDepth;
    this.maxChunks = options.maxChunks ?? config.json?.maxChunks ?? defaults.splitter.json.maxChunks;
    this.maxChunkSize = options.maxChunkSize ?? config.maxChunkSize;
    const textSplitterConfig = { ...config };
    if (options.maxChunkSize) {
      textSplitterConfig.maxChunkSize = options.maxChunkSize;
    }
    this.textFallbackSplitter = new TextDocumentSplitter(textSplitterConfig);
  }
  async splitText(content, _contentType) {
    try {
      const parsed = JSON.parse(content);
      const chunks = [];
      await this.processValue(parsed, ["root"], 1, 0, chunks, true);
      if (chunks.length > this.maxChunks) {
        return this.textFallbackSplitter.splitText(content);
      }
      return chunks;
    } catch {
      return [
        {
          types: ["code"],
          content: content.trim(),
          section: {
            level: 1,
            path: ["invalid-json"]
          }
        }
      ];
    }
  }
  async processValue(value, path2, level, indentLevel, chunks, isLastItem) {
    if (level > this.maxDepth) {
      await this.processValueAsText(value, path2, level, indentLevel, chunks, isLastItem);
      return;
    }
    if (Array.isArray(value)) {
      await this.processArray(value, path2, level, indentLevel, chunks, isLastItem);
    } else if (value !== null && typeof value === "object") {
      await this.processObject(value, path2, level, indentLevel, chunks, isLastItem);
    } else {
      await this.processPrimitive(value, path2, level, indentLevel, chunks, isLastItem);
    }
  }
  async processArray(array, path2, level, indentLevel, chunks, isLastItem) {
    const indent = this.getIndent(indentLevel);
    const comma = isLastItem ? "" : ",";
    chunks.push({
      types: ["code"],
      content: `${indent}[`,
      section: { level, path: [...path2] }
    });
    for (let index = 0; index < array.length; index++) {
      const item = array[index];
      const isLast = index === array.length - 1;
      const itemPath = [...path2, `[${index}]`];
      await this.processValue(item, itemPath, level + 1, indentLevel + 1, chunks, isLast);
    }
    chunks.push({
      types: ["code"],
      content: `${indent}]${comma}`,
      section: { level, path: [...path2] }
    });
  }
  async processObject(obj, path2, level, indentLevel, chunks, isLastItem) {
    const indent = this.getIndent(indentLevel);
    const comma = isLastItem ? "" : ",";
    const entries = Object.entries(obj);
    chunks.push({
      types: ["code"],
      content: `${indent}{`,
      section: { level, path: [...path2] }
    });
    for (let index = 0; index < entries.length; index++) {
      const [key, value] = entries[index];
      const isLast = index === entries.length - 1;
      const propertyPath = [...path2, key];
      await this.processProperty(
        key,
        value,
        propertyPath,
        level + 1,
        indentLevel + 1,
        chunks,
        isLast
      );
    }
    chunks.push({
      types: ["code"],
      content: `${indent}}${comma}`,
      section: { level, path: [...path2] }
    });
  }
  async processProperty(key, value, path2, level, indentLevel, chunks, isLastProperty) {
    const indent = this.getIndent(indentLevel);
    if (typeof value === "object" && value !== null) {
      chunks.push({
        types: ["code"],
        content: `${indent}"${key}": `,
        section: { level, path: path2 }
      });
      await this.processValue(value, path2, level, indentLevel, chunks, isLastProperty);
    } else {
      const comma = isLastProperty ? "" : ",";
      const formattedValue = JSON.stringify(value);
      const fullContent = `${indent}"${key}": ${formattedValue}${comma}`;
      if (fullContent.length > this.maxChunkSize) {
        const textChunks = await this.textFallbackSplitter.splitText(formattedValue);
        chunks.push({
          types: ["code"],
          content: `${indent}"${key}": `,
          section: { level, path: path2 }
        });
        textChunks.forEach((textChunk, index) => {
          const isLastChunk = index === textChunks.length - 1;
          const content = `${textChunk.content}${isLastChunk ? comma : ""}`;
          chunks.push({
            types: ["code"],
            content,
            section: { level, path: path2 }
          });
        });
      } else {
        chunks.push({
          types: ["code"],
          content: fullContent,
          section: { level, path: path2 }
        });
      }
    }
  }
  async processPrimitive(value, path2, level, indentLevel, chunks, isLastItem) {
    const indent = this.getIndent(indentLevel);
    const comma = isLastItem ? "" : ",";
    const formattedValue = JSON.stringify(value);
    const fullContent = `${indent}${formattedValue}${comma}`;
    if (fullContent.length > this.maxChunkSize) {
      const textChunks = await this.textFallbackSplitter.splitText(formattedValue);
      textChunks.forEach((textChunk, index) => {
        const isFirstChunk = index === 0;
        const isLastChunk = index === textChunks.length - 1;
        const valueContent = isFirstChunk ? `${indent}${textChunk.content}` : textChunk.content;
        const content = `${valueContent}${isLastChunk ? comma : ""}`;
        chunks.push({
          types: ["code"],
          content,
          section: { level, path: [...path2] }
        });
      });
    } else {
      chunks.push({
        types: ["code"],
        content: fullContent,
        section: { level, path: path2 }
      });
    }
  }
  getIndent(level) {
    return this.preserveFormatting ? "  ".repeat(level) : "";
  }
  /**
   * Process a value that has exceeded the maximum depth limit by serializing it as text.
   * This prevents excessive chunking of deeply nested structures.
   * If the serialized value is too large, splits it using the text fallback splitter.
   */
  async processValueAsText(value, path2, level, indentLevel, chunks, isLastItem) {
    const indent = this.getIndent(indentLevel);
    const comma = isLastItem ? "" : ",";
    let serialized;
    if (this.preserveFormatting) {
      const lines = JSON.stringify(value, null, 2).split("\n");
      serialized = lines.map((line, idx) => idx === 0 ? line : `${indent}${line}`).join("\n");
    } else {
      serialized = JSON.stringify(value);
    }
    const fullContent = `${indent}${serialized}${comma}`;
    if (fullContent.length > this.maxChunkSize) {
      const textChunks = await this.textFallbackSplitter.splitText(serialized);
      for (const textChunk of textChunks) {
        chunks.push({
          types: ["code"],
          content: textChunk.content,
          section: { level, path: [...path2] }
        });
      }
    } else {
      chunks.push({
        types: ["code"],
        content: fullContent,
        section: { level, path: [...path2] }
      });
    }
  }
}
class JsonPipeline extends BasePipeline {
  middleware;
  splitter;
  constructor(config) {
    super();
    this.middleware = [];
    this.splitter = new JsonDocumentSplitter(config.splitter, {
      preserveFormatting: true
    });
  }
  canProcess(mimeType) {
    if (!mimeType) return false;
    return MimeTypeUtils.isJson(mimeType);
  }
  async process(rawContent, options, fetcher) {
    const contentString = convertToString(rawContent.content, rawContent.charset);
    let parsedJson;
    let isValidJson = true;
    try {
      parsedJson = JSON.parse(contentString);
    } catch (_error) {
      isValidJson = false;
    }
    if (!isValidJson) {
      const fallbackChunks = await this.splitter.splitText(contentString);
      return {
        textContent: contentString,
        // metadata: {
        //   isValidJson: false,
        // },
        links: [],
        errors: [],
        chunks: fallbackChunks
      };
    }
    const metadata = this.extractMetadata(parsedJson);
    const context = {
      content: contentString,
      source: rawContent.source,
      title: metadata.title,
      contentType: rawContent.mimeType || "application/json",
      // metadata: {
      //   ...this.extractMetadata(parsedJson),
      //   isValidJson,
      //   jsonStructure: this.analyzeJsonStructure(parsedJson),
      // },
      links: [],
      // JSON files typically don't contain links
      errors: [],
      options,
      fetcher
    };
    await this.executeMiddlewareStack(this.middleware, context);
    const chunks = await this.splitter.splitText(context.content);
    return {
      title: context.title,
      contentType: context.contentType,
      textContent: context.content,
      links: context.links,
      errors: context.errors,
      chunks
    };
  }
  /**
   * Extracts metadata from JSON content only when meaningful values exist
   */
  extractMetadata(parsedJson) {
    const metadata = {};
    if (typeof parsedJson === "object" && parsedJson !== null) {
      const obj = parsedJson;
      const titleFields = ["title", "name", "displayName", "label"];
      for (const field of titleFields) {
        if (field in obj && typeof obj[field] === "string" && obj[field]) {
          metadata.title = obj[field];
          break;
        }
      }
      const descFields = ["description", "summary", "about", "info"];
      for (const field of descFields) {
        if (field in obj && typeof obj[field] === "string" && obj[field]) {
          metadata.description = obj[field];
          break;
        }
      }
    }
    return metadata;
  }
  /**
   * Calculates the maximum nesting depth of a JSON structure
   */
  calculateDepth(obj, currentDepth = 1) {
    if (Array.isArray(obj)) {
      let maxDepth = currentDepth;
      for (const item of obj) {
        if (typeof item === "object" && item !== null) {
          maxDepth = Math.max(maxDepth, this.calculateDepth(item, currentDepth + 1));
        }
      }
      return maxDepth;
    } else if (typeof obj === "object" && obj !== null) {
      let maxDepth = currentDepth;
      for (const value of Object.values(obj)) {
        if (typeof value === "object" && value !== null) {
          maxDepth = Math.max(maxDepth, this.calculateDepth(value, currentDepth + 1));
        }
      }
      return maxDepth;
    }
    return currentDepth;
  }
}
class MarkdownLinkExtractorMiddleware {
  /**
   * Processes the context. Currently a no-op regarding link extraction.
   * @param context The current processing context.
   * @param next Function to call the next middleware.
   */
  async process(context, next) {
    if (!Array.isArray(context.links)) {
      context.links = [];
    }
    await next();
  }
}
class MarkdownMetadataExtractorMiddleware {
  /**
   * Processes the context to extract the title from Markdown.
   * @param context The current processing context.
   * @param next Function to call the next middleware.
   */
  async process(context, next) {
    try {
      let title = "Untitled";
      const match = context.content.match(/^#\s+(.*)$/m);
      if (match?.[1]) {
        title = match[1].trim();
      }
      context.title = title;
    } catch (error) {
      context.errors.push(
        new Error(
          `Failed to extract metadata from Markdown: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
    await next();
  }
}
class MarkdownPipeline extends BasePipeline {
  middleware;
  greedySplitter;
  constructor(config) {
    super();
    const preferredChunkSize = config.splitter.preferredChunkSize;
    const maxChunkSize = config.splitter.maxChunkSize;
    const minChunkSize = config.splitter.minChunkSize;
    this.middleware = [
      new MarkdownMetadataExtractorMiddleware(),
      new MarkdownLinkExtractorMiddleware()
    ];
    const semanticSplitter = new SemanticMarkdownSplitter(
      preferredChunkSize,
      maxChunkSize
    );
    this.greedySplitter = new GreedySplitter(
      semanticSplitter,
      minChunkSize,
      preferredChunkSize,
      maxChunkSize
    );
  }
  canProcess(mimeType) {
    if (!mimeType) return false;
    return MimeTypeUtils.isMarkdown(mimeType);
  }
  async process(rawContent, options, fetcher) {
    const contentString = convertToString(rawContent.content, rawContent.charset);
    const context = {
      contentType: rawContent.mimeType || "text/markdown",
      content: contentString,
      source: rawContent.source,
      links: [],
      errors: [],
      options,
      fetcher
    };
    await this.executeMiddlewareStack(this.middleware, context);
    const chunks = await this.greedySplitter.splitText(
      typeof context.content === "string" ? context.content : "",
      rawContent.mimeType
    );
    return {
      title: context.title,
      contentType: context.contentType,
      textContent: typeof context.content === "string" ? context.content : "",
      links: context.links,
      errors: context.errors,
      chunks
    };
  }
}
var StructuralNodeType = /* @__PURE__ */ ((StructuralNodeType2) => {
  StructuralNodeType2["FUNCTION_DECLARATION"] = "function_declaration";
  StructuralNodeType2["ARROW_FUNCTION"] = "arrow_function";
  StructuralNodeType2["METHOD_DEFINITION"] = "method_definition";
  StructuralNodeType2["CONSTRUCTOR"] = "constructor";
  StructuralNodeType2["CLASS_DECLARATION"] = "class_declaration";
  StructuralNodeType2["OBJECT_EXPRESSION"] = "object_expression";
  StructuralNodeType2["INTERFACE_DECLARATION"] = "interface_declaration";
  StructuralNodeType2["TYPE_ALIAS_DECLARATION"] = "type_alias_declaration";
  StructuralNodeType2["NAMESPACE_DECLARATION"] = "namespace_declaration";
  StructuralNodeType2["ENUM_DECLARATION"] = "enum_declaration";
  StructuralNodeType2["JSX_ELEMENT"] = "jsx_element";
  StructuralNodeType2["JSX_FRAGMENT"] = "jsx_fragment";
  StructuralNodeType2["JSX_EXPRESSION"] = "jsx_expression";
  StructuralNodeType2["VARIABLE_DECLARATION"] = "variable_declaration";
  StructuralNodeType2["EXPORT_STATEMENT"] = "export_statement";
  StructuralNodeType2["IMPORT_STATEMENT"] = "import_statement";
  StructuralNodeType2["IF_STATEMENT"] = "if_statement";
  StructuralNodeType2["FOR_STATEMENT"] = "for_statement";
  StructuralNodeType2["WHILE_STATEMENT"] = "while_statement";
  StructuralNodeType2["SWITCH_STATEMENT"] = "switch_statement";
  return StructuralNodeType2;
})(StructuralNodeType || {});
const STRUCTURAL_DECL_TYPES$1 = /* @__PURE__ */ new Set([
  "class_definition",
  "import_statement",
  "import_from_statement"
]);
const CONTENT_DECL_TYPES$1 = /* @__PURE__ */ new Set(["function_definition", "async_function_definition"]);
function isCandidateBoundary$1(node) {
  return STRUCTURAL_DECL_TYPES$1.has(node.type) || CONTENT_DECL_TYPES$1.has(node.type);
}
function isLocalHelper$1(node) {
  const functionLike = /* @__PURE__ */ new Set(["function_definition", "async_function_definition"]);
  let ancestor = node.parent;
  while (ancestor) {
    if (functionLike.has(ancestor.type)) {
      return true;
    }
    if (ancestor.type === "class_definition" || ancestor.type === "module") {
      break;
    }
    ancestor = ancestor.parent;
  }
  return false;
}
function findDocumentationStart$1(node, source) {
  let startByte = node.startIndex;
  let startLine = node.startPosition.row + 1;
  if (node.type === "function_definition" || node.type === "async_function_definition" || node.type === "class_definition") {
    const body = node.childForFieldName("body");
    if (body && body.type === "block") {
      const firstChild = body.children.find((child) => child.type !== "newline");
      if (firstChild && firstChild.type === "expression_statement") {
        const expr = firstChild.childForFieldName("value") || firstChild.children[0];
        if (expr && expr.type === "string") ;
      }
    }
  }
  const parent = node.parent;
  if (!parent) {
    return { startLine, startByte };
  }
  const siblings = parent.children;
  const idx = siblings.indexOf(node);
  if (idx === -1) {
    return { startLine, startByte };
  }
  let sawComment = false;
  for (let i = idx - 1; i >= 0; i--) {
    const s = siblings[i];
    const text = source.slice(s.startIndex, s.endIndex);
    if (s.type === "comment") {
      sawComment = true;
      startByte = s.startIndex;
      startLine = s.startPosition.row + 1;
      continue;
    }
    if (/^\s*$/.test(text)) {
      if (sawComment) {
        startByte = s.startIndex;
        startLine = s.startPosition.row + 1;
      }
      continue;
    }
    break;
  }
  return { startLine, startByte };
}
function extractName$1(node) {
  switch (node.type) {
    case "function_definition":
    case "async_function_definition":
    case "class_definition": {
      const nameNode = node.childForFieldName("name");
      return nameNode?.text || `<anonymous_${node.type}>`;
    }
    case "import_statement": {
      const names = [];
      const dotted_names = node.children.filter(
        (c) => c.type === "dotted_name" || c.type === "identifier"
      );
      for (const name of dotted_names) {
        names.push(name.text);
      }
      return names.length > 0 ? `import ${names.join(", ")}` : "import";
    }
    case "import_from_statement": {
      const moduleNode = node.childForFieldName("module_name");
      const moduleName = moduleNode?.text || "?";
      return `from ${moduleName}`;
    }
    default:
      return node.type;
  }
}
function classifyBoundaryKind$1(node) {
  if (node.type === "class_definition") {
    return { boundaryType: "structural", simple: "class" };
  }
  if (node.type === "import_statement" || node.type === "import_from_statement") {
    return { boundaryType: "structural", simple: "module" };
  }
  if (node.type === "function_definition" || node.type === "async_function_definition") {
    return { boundaryType: "content", simple: "function" };
  }
  return { boundaryType: "content", simple: "other" };
}
class PythonParser {
  constructor(treeSitterSizeLimit = defaults.splitter.treeSitterSizeLimit) {
    this.treeSitterSizeLimit = treeSitterSizeLimit;
  }
  name = "python";
  fileExtensions = [".py", ".pyi", ".pyw"];
  mimeTypes = [
    "text/python",
    "text/x-python",
    "application/python",
    "application/x-python"
  ];
  createParser() {
    const parser = new Parser();
    parser.setLanguage(Python);
    return parser;
  }
  parse(source) {
    if (typeof source !== "string") {
      throw new Error(`PythonParser expected string input, got ${typeof source}`);
    }
    if (source == null) {
      throw new Error("PythonParser received null or undefined source");
    }
    const limit = this.treeSitterSizeLimit;
    if (source.length > limit) {
      let truncatedSource = source.slice(0, limit);
      const lastNewline = truncatedSource.lastIndexOf("\n");
      if (lastNewline > limit * 0.9) {
        truncatedSource = source.slice(0, lastNewline + 1);
      }
      try {
        const parser = this.createParser();
        const tree = parser.parse(truncatedSource);
        const errorNodes = [];
        this.collectErrorNodes(tree.rootNode, errorNodes);
        return {
          tree,
          hasErrors: true,
          // Mark as having errors due to truncation
          errorNodes
        };
      } catch (error) {
        throw new Error(
          `Failed to parse truncated Python file (${truncatedSource.length} chars): ${error.message}`
        );
      }
    }
    try {
      const parser = this.createParser();
      const tree = parser.parse(source);
      const errorNodes = [];
      this.collectErrorNodes(tree.rootNode, errorNodes);
      return {
        tree,
        hasErrors: errorNodes.length > 0,
        errorNodes
      };
    } catch (error) {
      throw new Error(
        `Failed to parse Python file (${source.length} chars): ${error.message}`
      );
    }
  }
  collectErrorNodes(node, acc) {
    if (node.hasError && node.type === "ERROR") {
      acc.push(node);
    }
    for (const c of node.children) {
      this.collectErrorNodes(c, acc);
    }
  }
  getNodeText(node, source) {
    return source.slice(node.startIndex, node.endIndex);
  }
  getNodeLines(node, _source) {
    return {
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1
    };
  }
  /**
   * Legacy structural node extraction (used by existing tests).
   * Produces a flat list (no parent/child linking beyond simple push).
   */
  extractStructuralNodes(tree, source) {
    const src = source ?? tree.rootNode.text;
    const out = [];
    const structuralTypes = /* @__PURE__ */ new Set([
      ...STRUCTURAL_DECL_TYPES$1,
      ...CONTENT_DECL_TYPES$1
    ]);
    const visit = (node) => {
      if (structuralTypes.has(node.type)) {
        if (this.shouldSkipStructuralNode(node)) {
          for (const child of node.children) visit(child);
          return;
        }
        const name = extractName$1(node);
        const { startLine, startByte } = findDocumentationStart$1(node, src);
        const endLine = node.endPosition.row + 1;
        const structuralNode = {
          type: this.classifyStructuralNode(node),
          name,
          startLine,
          endLine,
          startByte,
          endByte: node.endIndex,
          children: [],
          text: this.getNodeText(node, src),
          indentLevel: 0,
          modifiers: [],
          documentation: void 0
        };
        out.push(structuralNode);
        for (const child of node.children) visit(child);
        return;
      }
      for (const child of node.children) visit(child);
    };
    visit(tree.rootNode);
    return this.deduplicate(out);
  }
  /**
   * Boundary extraction: produces CodeBoundary[] directly from AST.
   */
  extractBoundaries(tree, source) {
    if (!source.trim()) return [];
    const boundaries = [];
    const walk = (node) => {
      if (isCandidateBoundary$1(node)) {
        if (this.shouldSkipStructuralNode(node)) {
          for (const c of node.children) walk(c);
          return;
        }
        if ((node.type === "function_definition" || node.type === "async_function_definition") && isLocalHelper$1(node)) {
          for (const c of node.children) walk(c);
          return;
        }
        const name = extractName$1(node);
        const docInfo = findDocumentationStart$1(node, source);
        const classification = classifyBoundaryKind$1(node);
        boundaries.push({
          type: classification.simple,
          boundaryType: classification.boundaryType,
          name,
          startLine: docInfo.startLine,
          endLine: node.endPosition.row + 1,
          startByte: docInfo.startByte,
          endByte: node.endIndex
        });
        for (const c of node.children) walk(c);
        return;
      }
      for (const c of node.children) walk(c);
    };
    walk(tree.rootNode);
    const seen = /* @__PURE__ */ new Set();
    return boundaries.filter((b) => {
      const key = `${b.startByte}:${b.endByte}:${b.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  /**
   * Determine if a structural node should be skipped in favor of children.
   */
  shouldSkipStructuralNode(_node) {
    return false;
  }
  classifyStructuralNode(node) {
    switch (node.type) {
      case "function_definition":
      case "async_function_definition":
        return StructuralNodeType.FUNCTION_DECLARATION;
      case "class_definition":
        return StructuralNodeType.CLASS_DECLARATION;
      case "import_statement":
      case "import_from_statement":
        return StructuralNodeType.IMPORT_STATEMENT;
      default:
        return StructuralNodeType.VARIABLE_DECLARATION;
    }
  }
  deduplicate(nodes) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const n of nodes) {
      const key = `${n.startByte}:${n.endByte}:${n.type}:${n.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
    out.sort((a, b) => a.startByte - b.startByte);
    return out;
  }
}
function detectTSX(source) {
  return /<[A-Za-z][A-Za-z0-9]*\s|<\/[A-Za-z]|React\./.test(source);
}
const STRUCTURAL_DECL_TYPES = /* @__PURE__ */ new Set([
  "class_declaration",
  "abstract_class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "module_declaration",
  "namespace_declaration",
  "internal_module",
  "import_statement",
  "export_statement"
]);
const CONTENT_DECL_TYPES = /* @__PURE__ */ new Set([
  "function_declaration",
  "method_definition",
  "method_signature",
  "abstract_method_signature",
  "constructor",
  "arrow_function",
  // Only emit arrow-function variables via their variable_declarator to avoid duplicates
  "variable_declarator"
]);
const MODIFIER_TOKENS = /* @__PURE__ */ new Set([
  "export",
  "default",
  "public",
  "private",
  "protected",
  "readonly",
  "abstract",
  "async",
  "static"
]);
function isCandidateBoundary(node) {
  return STRUCTURAL_DECL_TYPES.has(node.type) || CONTENT_DECL_TYPES.has(node.type);
}
function isLocalHelper(node) {
  const functionLike = /* @__PURE__ */ new Set([
    "function_declaration",
    "arrow_function",
    "method_definition",
    "method_signature",
    "abstract_method_signature",
    "constructor"
  ]);
  let ancestor = node.parent;
  while (ancestor) {
    if (functionLike.has(ancestor.type)) {
      if (ancestor.type === "method_definition" || ancestor.type === "constructor" || ancestor.type === "function_declaration" || ancestor.type === "arrow_function") {
        return true;
      }
    }
    if (ancestor.type === "class_declaration" || ancestor.type === "abstract_class_declaration" || ancestor.type === "namespace_declaration" || ancestor.type === "module_declaration" || ancestor.type === "internal_module" || ancestor.type === "interface_declaration" || ancestor.type === "enum_declaration") {
      break;
    }
    ancestor = ancestor.parent;
  }
  return false;
}
function findDocumentationStart(node, source) {
  let target = node;
  if (node.parent && node.parent.type === "export_statement") {
    target = node.parent;
  }
  const parent = target.parent;
  if (!parent) {
    return {
      startLine: target.startPosition.row + 1,
      startByte: target.startIndex
    };
  }
  const siblings = parent.children;
  const idx = siblings.indexOf(target);
  if (idx === -1) {
    return {
      startLine: target.startPosition.row + 1,
      startByte: target.startIndex
    };
  }
  let startByte = target.startIndex;
  let startLine = target.startPosition.row + 1;
  let sawComment = false;
  for (let i = idx - 1; i >= 0; i--) {
    const s = siblings[i];
    const text = source.slice(s.startIndex, s.endIndex);
    if (s.type === "comment") {
      sawComment = true;
      startByte = s.startIndex;
      startLine = s.startPosition.row + 1;
      continue;
    }
    if (/^\s*$/.test(text)) {
      if (sawComment) {
        startByte = s.startIndex;
        startLine = s.startPosition.row + 1;
      }
      continue;
    }
    break;
  }
  const lineStartIdx = source.lastIndexOf("\n", target.startIndex - 1) + 1;
  if (lineStartIdx >= 0) {
    const prefix = source.slice(lineStartIdx, target.startIndex);
    if (prefix.includes("/**")) {
      startLine = target.startPosition.row + 1;
      startByte = lineStartIdx;
    }
  }
  return { startLine, startByte };
}
function extractName(node) {
  switch (node.type) {
    case "function_declaration":
    case "class_declaration":
    case "abstract_class_declaration":
    case "interface_declaration":
    case "type_alias_declaration":
    case "enum_declaration":
    case "namespace_declaration":
    case "module_declaration":
    case "internal_module": {
      const nameNode = node.childForFieldName("name");
      return nameNode?.text || `<anonymous_${node.type}>`;
    }
    case "method_definition":
    case "method_signature":
    case "abstract_method_signature": {
      const nameNode = node.childForFieldName("name");
      const isStatic = node.children.some((c) => c.type === "static");
      const base = nameNode?.text || "method";
      return isStatic ? `static ${base}` : base;
    }
    case "constructor":
      return "constructor";
    case "arrow_function": {
      let parent = node.parent;
      while (parent) {
        if (parent.type === "variable_declarator") {
          const nameNode = parent.childForFieldName("name");
          return nameNode?.text || "<anonymous_arrow>";
        }
        parent = parent.parent;
      }
      return "<anonymous_arrow>";
    }
    case "variable_declaration":
    case "lexical_declaration": {
      const declarators = node.children.filter((c) => c.type === "variable_declarator");
      const names = [];
      for (const d of declarators) {
        const value = d.childForFieldName("value");
        if (value?.type === "arrow_function") {
          const nameNode = d.childForFieldName("name");
          if (nameNode) names.push(nameNode.text);
        }
      }
      if (names.length > 0) return names.join(", ");
      return "<variable_declaration>";
    }
    case "variable_declarator": {
      const nameNode = node.childForFieldName("name");
      return nameNode?.text || "<variable>";
    }
    case "import_statement":
    case "export_statement":
      return node.text.split("\n")[0].trim();
    default:
      return node.type;
  }
}
function extractModifiers(node) {
  const mods = /* @__PURE__ */ new Set();
  for (const c of node.children) {
    if (MODIFIER_TOKENS.has(c.type)) mods.add(c.type);
  }
  let prev = node.previousSibling;
  while (prev) {
    if (prev.type === "comment") {
      prev = prev.previousSibling;
      continue;
    }
    if (/^\s*$/.test(prev.text)) {
      prev = prev.previousSibling;
      continue;
    }
    if (MODIFIER_TOKENS.has(prev.type)) {
      mods.add(prev.type);
      prev = prev.previousSibling;
      continue;
    }
    break;
  }
  return Array.from(mods);
}
function classifyBoundaryKind(node) {
  if (node.type === "class_declaration" || node.type === "abstract_class_declaration") {
    return { boundaryType: "structural", simple: "class" };
  }
  if (node.type === "interface_declaration" || node.type === "type_alias_declaration") {
    return { boundaryType: "structural", simple: "interface" };
  }
  if (node.type === "enum_declaration") {
    return { boundaryType: "structural", simple: "enum" };
  }
  if (node.type === "namespace_declaration" || node.type === "module_declaration" || node.type === "internal_module" || node.type === "export_statement" || node.type === "import_statement") {
    return { boundaryType: "structural", simple: "module" };
  }
  if (node.type === "function_declaration" || node.type === "method_definition" || node.type === "method_signature" || node.type === "abstract_method_signature" || node.type === "constructor" || node.type === "arrow_function" || node.type === "variable_declaration" || node.type === "lexical_declaration" || node.type === "variable_declarator") {
    return { boundaryType: "content", simple: "function" };
  }
  return { boundaryType: "content", simple: "other" };
}
class TypeScriptParser {
  constructor(treeSitterSizeLimit = defaults.splitter.treeSitterSizeLimit) {
    this.treeSitterSizeLimit = treeSitterSizeLimit;
  }
  // Unified extensions: TS + JS
  fileExtensions = [
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs"
  ];
  mimeTypes = [
    "text/typescript",
    "application/typescript",
    "text/tsx",
    "application/tsx",
    "text/javascript",
    "application/javascript",
    "text/jsx",
    "application/jsx"
  ];
  name = "typescript";
  createParser(source) {
    const p = new Parser();
    const lang = detectTSX(source) ? TypeScript.tsx : TypeScript.typescript;
    p.setLanguage(lang);
    return p;
  }
  parse(source) {
    const limit = this.treeSitterSizeLimit;
    if (source.length > limit) {
      let truncatedSource = source.slice(0, limit);
      const lastNewline = truncatedSource.lastIndexOf("\n");
      if (lastNewline > limit * 0.9) {
        truncatedSource = source.slice(0, lastNewline + 1);
      }
      try {
        const parser = this.createParser(truncatedSource);
        const tree = parser.parse(truncatedSource);
        const errorNodes = [];
        this.collectErrorNodes(tree.rootNode, errorNodes);
        return {
          tree,
          hasErrors: true,
          // Mark as having errors due to truncation
          errorNodes
        };
      } catch (error) {
        throw new Error(
          `Failed to parse truncated TypeScript file (${truncatedSource.length} chars): ${error.message}`
        );
      }
    }
    try {
      const parser = this.createParser(source);
      const tree = parser.parse(source);
      const errorNodes = [];
      this.collectErrorNodes(tree.rootNode, errorNodes);
      return {
        tree,
        hasErrors: errorNodes.length > 0,
        errorNodes
      };
    } catch (error) {
      throw new Error(
        `Failed to parse TypeScript file (${source.length} chars): ${error.message}`
      );
    }
  }
  collectErrorNodes(node, acc) {
    if (node.hasError && node.type === "ERROR") {
      acc.push(node);
    }
    for (const c of node.children) {
      this.collectErrorNodes(c, acc);
    }
  }
  getNodeText(node, source) {
    return source.slice(node.startIndex, node.endIndex);
  }
  getNodeLines(node, _source) {
    return {
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1
    };
  }
  /**
   * Legacy structural node extraction (used by existing tests).
   * Produces a flat list (no parent/child linking beyond simple push).
   */
  extractStructuralNodes(tree, source) {
    const src = source ?? tree.rootNode.text;
    const out = [];
    const structuralTypes = /* @__PURE__ */ new Set([
      ...STRUCTURAL_DECL_TYPES,
      ...CONTENT_DECL_TYPES
    ]);
    const visit = (node) => {
      if (structuralTypes.has(node.type)) {
        if (this.shouldSkipStructuralNode(node)) {
          for (const child of node.children) visit(child);
          return;
        }
        const name = extractName(node);
        const modifiers = extractModifiers(node);
        const { startLine, startByte } = findDocumentationStart(node, src);
        const endLine = node.endPosition.row + 1;
        const structuralNode = {
          type: this.classifyStructuralNode(node),
          name,
          startLine,
          endLine,
          startByte,
          endByte: node.endIndex,
          children: [],
          text: this.getNodeText(node, src),
          indentLevel: 0,
          modifiers,
          documentation: void 0
        };
        out.push(structuralNode);
        for (const child of node.children) visit(child);
        return;
      }
      for (const child of node.children) visit(child);
    };
    visit(tree.rootNode);
    return this.deduplicate(out);
  }
  /**
   * Boundary extraction: produces CodeBoundary[] directly from AST.
   */
  extractBoundaries(tree, source) {
    if (!source.trim()) return [];
    const boundaries = [];
    const walk = (node) => {
      if (isCandidateBoundary(node)) {
        if (node.type === "export_statement") {
          for (const c of node.children) walk(c);
          return;
        }
        if (this.shouldSkipStructuralNode(node)) {
          for (const c of node.children) walk(c);
          return;
        }
        if ((node.type === "function_declaration" || node.type === "arrow_function" || node.type === "method_definition" || node.type === "constructor") && isLocalHelper(node)) {
          for (const c of node.children) walk(c);
          return;
        }
        if (node.type === "arrow_function" && node.parent?.type === "variable_declarator") {
          for (const c of node.children) walk(c);
          return;
        }
        if (node.type === "variable_declarator") {
          if (this.isWithinFunctionLikeBody(node)) {
            for (const c of node.children) walk(c);
            return;
          }
        }
        const name = extractName(node);
        const docInfo = findDocumentationStart(node, source);
        const classification = classifyBoundaryKind(node);
        boundaries.push({
          type: classification.simple,
          boundaryType: classification.boundaryType,
          name,
          startLine: docInfo.startLine,
          endLine: node.endPosition.row + 1,
          startByte: docInfo.startByte,
          endByte: node.endIndex
        });
        for (const c of node.children) walk(c);
        return;
      }
      for (const c of node.children) walk(c);
    };
    walk(tree.rootNode);
    const seen = /* @__PURE__ */ new Set();
    return boundaries.filter((b) => {
      const key = `${b.startByte}:${b.endByte}:${b.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  /**
   * Determine if a structural node should be skipped in favor of children (transparent wrapper logic).
   * (Reduced compared to previous logic: currently only handles export wrappers already inline.)
   */
  shouldSkipStructuralNode(_node) {
    return false;
  }
  /**
   * Detect whether a node (e.g., variable_declarator with arrow function) is inside
   * a function/method/constructor body (local helper) before hitting a higher-level
   * structural container (class/namespace/module). Used to suppress local helpers.
   */
  isWithinFunctionLikeBody(node) {
    let ancestor = node.parent;
    while (ancestor) {
      if (ancestor.type === "function_declaration" || ancestor.type === "arrow_function" || ancestor.type === "method_definition" || ancestor.type === "constructor") {
        return true;
      }
      if (ancestor.type === "class_declaration" || ancestor.type === "abstract_class_declaration" || ancestor.type === "namespace_declaration" || ancestor.type === "module_declaration" || ancestor.type === "internal_module" || ancestor.type === "interface_declaration" || ancestor.type === "enum_declaration") {
        return false;
      }
      ancestor = ancestor.parent;
    }
    return false;
  }
  classifyStructuralNode(node) {
    switch (node.type) {
      case "function_declaration":
        return StructuralNodeType.FUNCTION_DECLARATION;
      case "arrow_function":
        return StructuralNodeType.ARROW_FUNCTION;
      case "method_definition":
      case "method_signature":
      case "abstract_method_signature":
        return StructuralNodeType.METHOD_DEFINITION;
      case "constructor":
        return StructuralNodeType.CONSTRUCTOR;
      case "class_declaration":
      case "abstract_class_declaration":
        return StructuralNodeType.CLASS_DECLARATION;
      case "interface_declaration":
        return StructuralNodeType.INTERFACE_DECLARATION;
      case "type_alias_declaration":
        return StructuralNodeType.TYPE_ALIAS_DECLARATION;
      case "enum_declaration":
        return StructuralNodeType.ENUM_DECLARATION;
      case "namespace_declaration":
      case "module_declaration":
      case "internal_module":
        return StructuralNodeType.NAMESPACE_DECLARATION;
      case "import_statement":
        return StructuralNodeType.IMPORT_STATEMENT;
      case "export_statement":
        return StructuralNodeType.EXPORT_STATEMENT;
      case "variable_declaration":
      case "lexical_declaration":
      case "variable_declarator":
        return StructuralNodeType.VARIABLE_DECLARATION;
      default:
        return StructuralNodeType.VARIABLE_DECLARATION;
    }
  }
  deduplicate(nodes) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const n of nodes) {
      const key = `${n.startByte}:${n.endByte}:${n.type}:${n.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
    out.sort((a, b) => a.startByte - b.startByte);
    return out;
  }
}
class LanguageParserRegistry {
  parsers = /* @__PURE__ */ new Map();
  extensionMap = /* @__PURE__ */ new Map();
  mimeTypeMap = /* @__PURE__ */ new Map();
  treeSitterSizeLimit;
  constructor(treeSitterSizeLimit = defaults.splitter.treeSitterSizeLimit) {
    this.treeSitterSizeLimit = treeSitterSizeLimit;
    this.initializeParsers();
  }
  /**
   * Get a parser by language name
   */
  getParser(language) {
    return this.parsers.get(language);
  }
  /**
   * Get a parser by file extension
   */
  getParserByExtension(extension) {
    const language = this.extensionMap.get(extension.toLowerCase());
    return language ? this.parsers.get(language) : void 0;
  }
  /**
   * Get a parser by MIME type
   */
  getParserByMimeType(mimeType) {
    const language = this.mimeTypeMap.get(mimeType.toLowerCase());
    return language ? this.parsers.get(language) : void 0;
  }
  /**
   * Check if a language is supported
   */
  isLanguageSupported(language) {
    return this.parsers.has(language);
  }
  /**
   * Check if a file extension is supported
   */
  isExtensionSupported(extension) {
    return this.extensionMap.has(extension.toLowerCase());
  }
  /**
   * Check if a MIME type is supported
   */
  isMimeTypeSupported(mimeType) {
    return this.mimeTypeMap.has(mimeType.toLowerCase());
  }
  /**
   * Get all supported languages
   */
  getSupportedLanguages() {
    return Array.from(this.parsers.keys());
  }
  /**
   * Get all supported file extensions
   */
  getSupportedExtensions() {
    return Array.from(this.extensionMap.keys());
  }
  /**
   * Get all supported MIME types
   */
  getSupportedMimeTypes() {
    return Array.from(this.mimeTypeMap.keys());
  }
  /**
   * Register a new parser
   */
  registerParser(parser) {
    this.parsers.set(parser.name, parser);
    for (const extension of parser.fileExtensions) {
      this.extensionMap.set(extension.toLowerCase(), parser.name);
    }
    for (const mimeType of parser.mimeTypes) {
      this.mimeTypeMap.set(mimeType.toLowerCase(), parser.name);
    }
  }
  initializeParsers() {
    const limit = this.treeSitterSizeLimit;
    const unified2 = new TypeScriptParser(limit);
    this.registerParser(unified2);
    const jsAlias = {
      ...unified2,
      name: "javascript",
      // Bind methods to the original instance to retain internal behavior.
      parse: unified2.parse.bind(unified2),
      extractStructuralNodes: unified2.extractStructuralNodes.bind(unified2),
      getNodeText: unified2.getNodeText.bind(unified2),
      getNodeLines: unified2.getNodeLines.bind(unified2),
      extractBoundaries: unified2.extractBoundaries.bind(unified2),
      // Narrow advertised extensions/mime types for the alias (informational only).
      fileExtensions: [".js", ".jsx", ".mjs", ".cjs"],
      mimeTypes: [
        "text/javascript",
        "application/javascript",
        "text/jsx",
        "application/jsx"
      ]
    };
    this.parsers.set("javascript", jsAlias);
    const jsExts = [".js", ".jsx", ".mjs", ".cjs"];
    for (const ext of jsExts) {
      this.extensionMap.set(ext.toLowerCase(), "javascript");
    }
    const jsMimes = [
      "text/javascript",
      "application/javascript",
      "text/jsx",
      "application/jsx"
    ];
    for (const mt of jsMimes) {
      this.mimeTypeMap.set(mt.toLowerCase(), "javascript");
    }
    const pythonParser = new PythonParser(limit);
    this.registerParser(pythonParser);
  }
}
class TreesitterSourceCodeSplitter {
  textContentSplitter;
  registry;
  maxChunkSize;
  constructor(config) {
    this.maxChunkSize = config.maxChunkSize;
    const treeSitterSizeLimit = config.treeSitterSizeLimit ?? defaults.splitter.treeSitterSizeLimit;
    this.registry = new LanguageParserRegistry(treeSitterSizeLimit);
    this.textContentSplitter = new TextContentSplitter({
      chunkSize: this.maxChunkSize
    });
  }
  async splitText(content, contentType) {
    if (!content.trim()) {
      return [];
    }
    const parser = this.getParserForContent(contentType);
    if (!parser) {
      return this.fallbackToTextSplitter(content);
    }
    try {
      const parseResult = parser.parse(content);
      if (parseResult.hasErrors) {
        console.warn(
          `Tree-sitter parsing had errors for ${contentType}, but continuing with partial results`
        );
      }
      const boundaries = parser.extractBoundaries(parseResult.tree, content);
      if (boundaries.length === 0) {
        return this.fallbackToTextSplitter(content);
      }
      const hierarchicalBoundaries = this.buildBoundaryHierarchy(boundaries);
      return await this.boundariesToChunks(hierarchicalBoundaries, content, contentType);
    } catch (error) {
      console.warn(
        "TreesitterSourceCodeSplitter failed, falling back to TextContentSplitter:",
        error
      );
      return this.fallbackToTextSplitter(content);
    }
  }
  /**
   * Helper method to fall back to TextContentSplitter and convert results to ContentChunk[]
   */
  async fallbackToTextSplitter(content) {
    return this.splitContentIntoChunks(content, [], 0);
  }
  /**
   * Get the appropriate parser for the given content type
   */
  getParserForContent(contentType) {
    if (!contentType) {
      return void 0;
    }
    let parser = this.registry.getParserByMimeType(contentType);
    if (parser) {
      return parser;
    }
    const extensionMatch = contentType.match(/\.([a-zA-Z]+)$/);
    if (extensionMatch) {
      const extension = `.${extensionMatch[1]}`;
      parser = this.registry.getParserByExtension(extension);
      if (parser) {
        return parser;
      }
    }
    if (contentType.includes("javascript") || contentType.includes("typescript")) {
      return this.registry.getParser("typescript");
    }
    if (contentType.includes("jsx") || contentType.includes("tsx")) {
      return this.registry.getParser("typescript");
    }
    return void 0;
  }
  /**
   * Check if the content type is supported
   */
  isSupportedContentType(contentType) {
    return this.getParserForContent(contentType) !== void 0;
  }
  /**
   * Get the list of supported languages
   */
  getSupportedLanguages() {
    return this.registry.getSupportedLanguages();
  }
  /**
   * Get the list of supported file extensions
   */
  getSupportedExtensions() {
    return this.registry.getSupportedExtensions();
  }
  /**
   * Get the list of supported MIME types
   */
  getSupportedMimeTypes() {
    return this.registry.getSupportedMimeTypes();
  }
  /**
   * Helper method to split content using TextContentSplitter only if needed
   * and create ContentChunks with the specified hierarchical path and level
   */
  async splitContentIntoChunks(content, path2, level) {
    if (content.length === 0) {
      return [];
    }
    if (content.length <= this.maxChunkSize) {
      return [
        {
          types: ["code"],
          content,
          section: {
            level,
            path: path2
          }
        }
      ];
    }
    const textChunks = await this.textContentSplitter.split(content);
    return textChunks.map((textChunk) => ({
      types: ["code"],
      content: textChunk,
      section: {
        level,
        path: path2
        // Make sure to preserve parent hierarchy for large content chunks too
      }
    }));
  }
  /**
   * Convert boundaries to chunks.
   * Algorithm:
   *  - Collect line breakpoints: file start, each boundary start, each boundary end+1, file end+1
   *  - Create linear segments between breakpoints (each line appears exactly once)
   *  - Determine containing (innermost) boundary for each segment for path/level
   *  - First segment belonging to a structural boundary => structural chunk; subsequent segments demoted to content
   *  - Universal max size enforcement: any segment > maxChunkSize is further split via TextContentSplitter
   *  - No heuristic de-noising or whitespace merging; reconstruction is guaranteed by preserving order + exact text
   */
  async boundariesToChunks(boundaries, content, _contentType) {
    const lines = content.split("\n");
    const totalLines = lines.length;
    if (boundaries.length === 0) {
      return this.splitContentIntoChunks(content, [], 0);
    }
    const boundaryPoints = /* @__PURE__ */ new Set();
    boundaryPoints.add(1);
    boundaryPoints.add(totalLines + 1);
    for (const boundary of boundaries) {
      boundaryPoints.add(boundary.startLine);
      boundaryPoints.add(boundary.endLine + 1);
    }
    const sortedPoints = Array.from(boundaryPoints).sort((a, b) => a - b);
    const segments = [];
    for (let i = 0; i < sortedPoints.length - 1; i++) {
      const startLine = sortedPoints[i];
      const endLine = sortedPoints[i + 1] - 1;
      if (startLine > endLine || startLine > totalLines) {
        continue;
      }
      const segmentLines = lines.slice(startLine - 1, Math.min(endLine, totalLines));
      let segmentContent = segmentLines.join("\n");
      if (endLine < totalLines) {
        segmentContent += "\n";
      }
      if (segmentContent.length === 0) {
        continue;
      }
      const containingBoundary = this.findContainingBoundary(
        startLine,
        endLine,
        boundaries
      );
      segments.push({
        startLine,
        endLine,
        content: segmentContent,
        containingBoundary
      });
    }
    const chunks = [];
    const structuralBoundaryFirstChunk = /* @__PURE__ */ new Set();
    let pendingWhitespace = "";
    for (const segment of segments) {
      if (segment.content.trim() === "") {
        pendingWhitespace += segment.content;
        continue;
      }
      let path2;
      let level;
      const boundary = segment.containingBoundary;
      if (boundary) {
        path2 = boundary.path || [boundary.name || "unnamed"];
        level = boundary.level || path2.length;
      } else {
        path2 = [];
        level = 0;
      }
      let isStructural = boundary?.boundaryType === "structural";
      if (isStructural && boundary) {
        if (structuralBoundaryFirstChunk.has(boundary)) {
          isStructural = false;
        } else {
          structuralBoundaryFirstChunk.add(boundary);
        }
      }
      const segmentChunks = await this.splitContentIntoChunks(
        segment.content,
        path2,
        level
      );
      for (const c of segmentChunks) {
        if (pendingWhitespace) {
          c.content = pendingWhitespace + c.content;
          pendingWhitespace = "";
        }
        c.types = isStructural ? ["code", "structural"] : ["code"];
      }
      chunks.push(...segmentChunks);
    }
    if (pendingWhitespace && chunks.length > 0) {
      chunks[chunks.length - 1].content += pendingWhitespace;
    }
    return chunks;
  }
  /**
   * Build hierarchical relationships between boundaries based on containment
   */
  buildBoundaryHierarchy(boundaries) {
    const hierarchicalBoundaries = boundaries.map((b) => ({ ...b }));
    for (let i = 0; i < hierarchicalBoundaries.length; i++) {
      const boundary = hierarchicalBoundaries[i];
      let parent;
      let smallestRange = Infinity;
      for (let j = 0; j < hierarchicalBoundaries.length; j++) {
        if (i === j) continue;
        const candidate = hierarchicalBoundaries[j];
        if (candidate.startLine <= boundary.startLine && candidate.endLine >= boundary.endLine && candidate.startByte <= boundary.startByte && candidate.endByte >= boundary.endByte) {
          const range = candidate.endLine - candidate.startLine;
          if (range < smallestRange) {
            smallestRange = range;
            parent = candidate;
          }
        }
      }
      if (parent) {
        boundary.parent = parent;
      }
      boundary.path = this.buildBoundaryPath(boundary);
      boundary.level = boundary.path.length;
    }
    return hierarchicalBoundaries;
  }
  /**
   * Build hierarchical path for a boundary by walking up the parent chain
   */
  buildBoundaryPath(boundary) {
    const path2 = [];
    let current = boundary;
    while (current) {
      if (current.name) {
        path2.unshift(current.name);
      }
      current = current.parent;
    }
    return path2;
  }
  /**
   * Find the innermost boundary that contains the given line range
   */
  findContainingBoundary(startLine, endLine, boundaries) {
    let innermost;
    let smallestRange = Infinity;
    for (const boundary of boundaries) {
      if (boundary.startLine <= startLine && boundary.endLine >= endLine) {
        const range = boundary.endLine - boundary.startLine;
        if (range < smallestRange) {
          smallestRange = range;
          innermost = boundary;
        }
      }
    }
    return innermost;
  }
}
class SourceCodePipeline extends BasePipeline {
  middleware;
  splitter;
  constructor(config) {
    super();
    this.middleware = [];
    this.splitter = new TreesitterSourceCodeSplitter(config.splitter);
  }
  canProcess(mimeType) {
    if (!mimeType) return false;
    return MimeTypeUtils.isSourceCode(mimeType);
  }
  async process(rawContent, options, fetcher) {
    const contentString = convertToString(rawContent.content, rawContent.charset);
    const context = {
      contentType: rawContent.mimeType || "text/plain",
      content: contentString,
      source: rawContent.source,
      // metadata: {
      //   language: rawContent.mimeType
      //     ? MimeTypeUtils.extractLanguageFromMimeType(rawContent.mimeType)
      //     : "text",
      //   isSourceCode: true,
      // },
      links: [],
      // Source code files typically don't contain web links
      errors: [],
      options,
      fetcher
    };
    await this.executeMiddlewareStack(this.middleware, context);
    const chunks = await this.splitter.splitText(context.content, rawContent.mimeType);
    return {
      title: context.title,
      contentType: context.contentType,
      textContent: context.content,
      // metadata: context.metadata,
      links: context.links,
      errors: context.errors,
      chunks
    };
  }
}
class TextPipeline extends BasePipeline {
  middleware;
  splitter;
  constructor(config) {
    super();
    const preferredChunkSize = config.splitter.preferredChunkSize;
    const maxChunkSize = config.splitter.maxChunkSize;
    const minChunkSize = config.splitter.minChunkSize;
    this.middleware = [];
    const textSplitter = new TextDocumentSplitter(config.splitter);
    this.splitter = new GreedySplitter(
      textSplitter,
      minChunkSize,
      preferredChunkSize,
      maxChunkSize
    );
  }
  canProcess(mimeType, content) {
    if (!MimeTypeUtils.isSafeForTextProcessing(mimeType)) {
      return false;
    }
    if (content && MimeTypeUtils.isBinary(content)) {
      return false;
    }
    return true;
  }
  async process(rawContent, options, fetcher) {
    const contentString = convertToString(rawContent.content, rawContent.charset);
    const context = {
      title: "",
      // Title extraction can be added in middleware if needed
      contentType: rawContent.mimeType || "text/plain",
      content: contentString,
      source: rawContent.source,
      links: [],
      // Generic text content typically doesn't contain structured links
      errors: [],
      options,
      fetcher
    };
    await this.executeMiddlewareStack(this.middleware, context);
    const chunks = await this.splitter.splitText(context.content, rawContent.mimeType);
    return {
      title: context.title,
      contentType: context.contentType,
      textContent: context.content,
      links: context.links,
      errors: context.errors,
      chunks
    };
  }
}
let PipelineFactory$1 = class PipelineFactory {
  /**
   * Creates the standard set of content pipelines used by all scraper strategies.
   * Includes HTML, Markdown, JSON, source code, and text processing capabilities.
   * Each pipeline now handles both preprocessing and content-specific splitting.
   * TextPipeline is placed last as the universal fallback for unknown content types.
   *
   * @returns Array of content pipelines in processing order
   */
  static createStandardPipelines(appConfig) {
    return [
      new JsonPipeline(appConfig),
      new SourceCodePipeline(appConfig),
      new HtmlPipeline(appConfig),
      new MarkdownPipeline(appConfig),
      new TextPipeline(appConfig)
      // Universal fallback - must be last
    ];
  }
};
class FetchUrlTool {
  /**
   * AutoDetectFetcher handles all URL types and fallback logic automatically.
   */
  fetcher;
  /**
   * Collection of pipelines that will be tried in order for processing content.
   * The first pipeline that can process the content type will be used.
   * Currently includes HtmlPipeline, MarkdownPipeline, and TextPipeline (as fallback).
   */
  pipelines;
  constructor(fetcher, config) {
    this.fetcher = fetcher;
    this.pipelines = PipelineFactory$1.createStandardPipelines(config);
  }
  /**
   * Fetches content from a URL and converts it to Markdown.
   * Supports both HTTP/HTTPS URLs and local file URLs (file://).
   * @returns The processed Markdown content
   * @throws {ToolError} If fetching or processing fails
   */
  async execute(options) {
    const { url, scrapeMode = ScrapeMode.Auto, headers } = options;
    if (!this.fetcher.canFetch(url)) {
      throw new ValidationError(
        `Invalid URL: ${url}. Must be an HTTP/HTTPS URL or a file:// URL.`,
        this.constructor.name
      );
    }
    try {
      logger.info(`📡 Fetching ${url}...`);
      const fetchOptions = {
        followRedirects: options.followRedirects ?? true,
        maxRetries: 3,
        headers
        // propagate custom headers
      };
      const rawContent = await this.fetcher.fetch(url, fetchOptions);
      logger.info("🔄 Processing content...");
      let processed;
      for (const pipeline of this.pipelines) {
        if (pipeline.canProcess(rawContent.mimeType, rawContent.content)) {
          processed = await pipeline.process(
            rawContent,
            {
              url,
              library: "",
              version: "",
              maxDepth: 0,
              maxPages: 1,
              maxConcurrency: 1,
              scope: "subpages",
              followRedirects: options.followRedirects ?? true,
              excludeSelectors: void 0,
              ignoreErrors: false,
              scrapeMode,
              headers
              // propagate custom headers
            },
            this.fetcher
          );
          break;
        }
      }
      if (!processed) {
        logger.warn(
          `⚠️  Unsupported content type "${rawContent.mimeType}" for ${url}. Returning raw content.`
        );
        const resolvedCharset = resolveCharset(
          rawContent.charset,
          rawContent.content,
          rawContent.mimeType
        );
        const contentString = convertToString(rawContent.content, resolvedCharset);
        return contentString;
      }
      for (const err of processed.errors ?? []) {
        logger.warn(`⚠️  Processing error for ${url}: ${err.message}`);
      }
      if (typeof processed.textContent !== "string" || !processed.textContent.trim()) {
        throw new ToolError(
          `Processing resulted in empty content for ${url}`,
          this.constructor.name
        );
      }
      logger.info(`✅ Successfully processed ${url}`);
      return processed.textContent;
    } catch (error) {
      if (error instanceof ToolError) {
        throw error;
      }
      throw new ToolError(
        `Unable to fetch or process the URL "${url}". Please verify the URL is correct and accessible.`,
        this.constructor.name
      );
    } finally {
      await Promise.allSettled([
        ...this.pipelines.map((pipeline) => pipeline.close()),
        this.fetcher.close()
      ]);
    }
  }
}
class FindVersionTool {
  docService;
  constructor(docService) {
    this.docService = docService;
  }
  /**
   * Executes the tool to find the best matching version and checks for unversioned docs.
   * @returns A structured object with the best match, unversioned status, and descriptive message.
   * @throws {ValidationError} If the library parameter is invalid.
   * @throws {VersionNotFoundInStoreError} If no matching versions or unversioned docs are found.
   */
  async execute(options) {
    const { library, targetVersion } = options;
    if (!library || typeof library !== "string" || library.trim() === "") {
      throw new ValidationError(
        "Library name is required and must be a non-empty string.",
        this.constructor.name
      );
    }
    const libraryAndVersion = `${library}${targetVersion ? `@${targetVersion}` : ""}`;
    const { bestMatch, hasUnversioned } = await this.docService.findBestVersion(
      library,
      targetVersion
    );
    let message = "";
    if (bestMatch) {
      message = `Best match: ${bestMatch}.`;
      if (hasUnversioned) {
        message += " Unversioned docs also available.";
      }
    } else if (hasUnversioned) {
      message = `No matching version found for ${libraryAndVersion}, but unversioned docs exist.`;
    } else {
      message = `No matching version or unversioned documents found for ${libraryAndVersion}.`;
    }
    return {
      bestMatch,
      hasUnversioned,
      message
    };
  }
}
class GetJobInfoTool {
  pipeline;
  /**
   * Creates an instance of GetJobInfoTool.
   * @param pipeline The pipeline instance.
   */
  constructor(pipeline) {
    this.pipeline = pipeline;
  }
  /**
   * Executes the tool to retrieve simplified info for a specific job using enhanced PipelineJob interface.
   * @param input - The input parameters, containing the jobId.
   * @returns A promise that resolves with the simplified job info.
   * @throws {ValidationError} If the jobId is invalid.
   * @throws {ToolError} If the job is not found.
   */
  async execute(input) {
    if (!input.jobId || typeof input.jobId !== "string" || input.jobId.trim() === "") {
      throw new ValidationError(
        "Job ID is required and must be a non-empty string.",
        this.constructor.name
      );
    }
    const job = await this.pipeline.getJob(input.jobId);
    if (!job) {
      throw new ToolError(`Job with ID ${input.jobId} not found.`, this.constructor.name);
    }
    const jobInfo = {
      id: job.id,
      library: job.library,
      version: job.version,
      status: job.status,
      dbStatus: job.versionStatus,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
      error: job.error?.message ?? null,
      progress: job.progressMaxPages && job.progressMaxPages > 0 ? {
        pages: job.progressPages || 0,
        totalPages: job.progressMaxPages,
        totalDiscovered: job.progress?.totalDiscovered || job.progressMaxPages
      } : void 0,
      updatedAt: job.updatedAt?.toISOString(),
      errorMessage: job.errorMessage ?? void 0
    };
    return { job: jobInfo };
  }
}
class ListJobsTool {
  pipeline;
  /**
   * Creates an instance of ListJobsTool.
   * @param pipeline The pipeline instance.
   */
  constructor(pipeline) {
    this.pipeline = pipeline;
  }
  /**
   * Executes the tool to retrieve a list of pipeline jobs using single source of truth.
   * @param input - The input parameters, optionally including a status filter.
   * @returns A promise that resolves with the list of simplified job objects.
   */
  async execute(input) {
    const jobs = await this.pipeline.getJobs(input.status);
    const simplifiedJobs = jobs.map((job) => {
      return {
        id: job.id,
        library: job.library,
        version: job.version,
        status: job.status,
        dbStatus: job.versionStatus,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
        error: job.error?.message ?? null,
        progress: job.progressMaxPages && job.progressMaxPages > 0 ? {
          pages: job.progressPages || 0,
          totalPages: job.progressMaxPages,
          totalDiscovered: job.progress?.totalDiscovered || job.progressMaxPages
        } : void 0,
        updatedAt: job.updatedAt?.toISOString(),
        errorMessage: job.errorMessage ?? void 0
      };
    });
    return { jobs: simplifiedJobs };
  }
}
class ListLibrariesTool {
  docService;
  constructor(docService) {
    this.docService = docService;
  }
  async execute(_options) {
    const rawLibraries = await this.docService.listLibraries();
    const libraries = rawLibraries.map(({ library, versions }) => ({
      name: library,
      versions: versions.map((v) => ({
        version: v.ref.version,
        documentCount: v.counts.documents,
        uniqueUrlCount: v.counts.uniqueUrls,
        indexedAt: v.indexedAt,
        status: v.status,
        ...v.progress ? { progress: v.progress } : void 0,
        sourceUrl: v.sourceUrl
      }))
    }));
    return { libraries };
  }
}
class RefreshVersionTool {
  pipeline;
  constructor(pipeline) {
    this.pipeline = pipeline;
  }
  async execute(options) {
    const { library, version, waitForCompletion = true } = options;
    let internalVersion;
    const partialVersionRegex = /^\d+(\.\d+)?$/;
    if (version === null || version === void 0) {
      internalVersion = "";
    } else {
      const validFullVersion = semver.valid(version);
      if (validFullVersion) {
        internalVersion = validFullVersion;
      } else if (partialVersionRegex.test(version)) {
        const coercedVersion = semver.coerce(version);
        if (coercedVersion) {
          internalVersion = coercedVersion.version;
        } else {
          throw new ValidationError(
            `Invalid version format for refreshing: '${version}'. Use 'X.Y.Z', 'X.Y.Z-prerelease', 'X.Y', 'X', or omit.`,
            "RefreshVersionTool"
          );
        }
      } else {
        throw new ValidationError(
          `Invalid version format for refreshing: '${version}'. Use 'X.Y.Z', 'X.Y.Z-prerelease', 'X.Y', 'X', or omit.`,
          "RefreshVersionTool"
        );
      }
    }
    internalVersion = internalVersion.toLowerCase();
    const pipeline = this.pipeline;
    const refreshVersion = internalVersion === "" ? null : internalVersion;
    const jobId = await pipeline.enqueueRefreshJob(library, refreshVersion);
    if (waitForCompletion) {
      try {
        await pipeline.waitForJobCompletion(jobId);
        const finalJob = await pipeline.getJob(jobId);
        const finalPagesRefreshed = finalJob?.progress?.pagesScraped ?? 0;
        logger.debug(
          `Refresh job ${jobId} finished with status ${finalJob?.status}. Pages refreshed: ${finalPagesRefreshed}`
        );
        return {
          pagesRefreshed: finalPagesRefreshed
        };
      } catch (error) {
        logger.error(`❌ Refresh job ${jobId} failed or was cancelled: ${error}`);
        throw error;
      }
    }
    return { jobId };
  }
}
class RemoveTool {
  constructor(documentManagementService, pipeline) {
    this.documentManagementService = documentManagementService;
    this.pipeline = pipeline;
  }
  /**
   * Executes the tool to remove the specified library version completely.
   * Aborts any QUEUED/RUNNING job for the same library+version before deleting.
   * Removes all documents, the version record, and the library if no other versions exist.
   */
  async execute(args) {
    const { library, version } = args;
    if (!library || typeof library !== "string" || library.trim() === "") {
      throw new ValidationError(
        "Library name is required and must be a non-empty string.",
        this.constructor.name
      );
    }
    logger.info(`🗑️ Removing library: ${library}${version ? `@${version}` : ""}`);
    try {
      await this.documentManagementService.validateLibraryExists(library);
      const allJobs = await this.pipeline.getJobs();
      const jobs = allJobs.filter(
        (job) => job.library === library && job.version === (version ?? "") && (job.status === PipelineJobStatus.QUEUED || job.status === PipelineJobStatus.RUNNING)
      );
      for (const job of jobs) {
        logger.info(
          `🚫 Aborting job for ${library}@${version ?? ""} before deletion: ${job.id}`
        );
        await this.pipeline.cancelJob(job.id);
        await this.pipeline.waitForJobCompletion(job.id);
      }
      await this.documentManagementService.removeVersion(library, version);
      const message = `Successfully removed ${library}${version ? `@${version}` : ""}.`;
      logger.info(`✅ ${message}`);
      return { message };
    } catch (error) {
      if (error instanceof ToolError) {
        throw error;
      }
      const errorMessage = `Failed to remove ${library}${version ? `@${version}` : ""}: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`❌ Error removing library: ${errorMessage}`);
      throw new ToolError(errorMessage, this.constructor.name);
    }
  }
}
class ScrapeTool {
  pipeline;
  scraperConfig;
  constructor(pipeline, config) {
    this.pipeline = pipeline;
    this.scraperConfig = config;
  }
  async execute(options) {
    const {
      library,
      version,
      url,
      options: scraperOptions,
      waitForCompletion = true
    } = options;
    let internalVersion;
    const partialVersionRegex = /^\d+(\.\d+)?$/;
    if (version === null || version === void 0) {
      internalVersion = "";
    } else {
      const validFullVersion = semver.valid(version);
      if (validFullVersion) {
        internalVersion = validFullVersion;
      } else if (partialVersionRegex.test(version)) {
        const coercedVersion = semver.coerce(version);
        if (coercedVersion) {
          internalVersion = coercedVersion.version;
        } else {
          throw new ValidationError(
            `Invalid version format for scraping: '${version}'. Use 'X.Y.Z', 'X.Y.Z-prerelease', 'X.Y', 'X', or omit.`,
            "ScrapeTool"
          );
        }
      } else {
        throw new ValidationError(
          `Invalid version format for scraping: '${version}'. Use 'X.Y.Z', 'X.Y.Z-prerelease', 'X.Y', 'X', or omit.`,
          "ScrapeTool"
        );
      }
    }
    internalVersion = internalVersion.toLowerCase();
    const pipeline = this.pipeline;
    const enqueueVersion = internalVersion === "" ? null : internalVersion;
    const jobId = await pipeline.enqueueScrapeJob(library, enqueueVersion, {
      url,
      library,
      version: internalVersion,
      scope: scraperOptions?.scope ?? "subpages",
      followRedirects: scraperOptions?.followRedirects ?? true,
      maxPages: scraperOptions?.maxPages ?? this.scraperConfig.maxPages,
      maxDepth: scraperOptions?.maxDepth ?? this.scraperConfig.maxDepth,
      maxConcurrency: scraperOptions?.maxConcurrency ?? this.scraperConfig.maxConcurrency,
      ignoreErrors: scraperOptions?.ignoreErrors ?? true,
      scrapeMode: scraperOptions?.scrapeMode ?? ScrapeMode.Auto,
      // Pass scrapeMode enum
      includePatterns: scraperOptions?.includePatterns,
      excludePatterns: scraperOptions?.excludePatterns,
      headers: scraperOptions?.headers
      // <-- propagate headers
    });
    if (waitForCompletion) {
      try {
        await pipeline.waitForJobCompletion(jobId);
        const finalJob = await pipeline.getJob(jobId);
        const finalPagesScraped = finalJob?.progress?.pagesScraped ?? 0;
        logger.debug(
          `Job ${jobId} finished with status ${finalJob?.status}. Pages scraped: ${finalPagesScraped}`
        );
        return {
          pagesScraped: finalPagesScraped
        };
      } catch (error) {
        logger.error(`❌ Job ${jobId} failed or was cancelled: ${error}`);
        throw error;
      }
    }
    return { jobId };
  }
}
class DocumentManagementClient {
  baseUrl;
  client;
  constructor(serverUrl) {
    this.baseUrl = serverUrl.replace(/\/$/, "");
    this.client = createTRPCProxyClient({
      links: [
        httpBatchLink({
          url: this.baseUrl,
          transformer: superjson
        })
      ]
    });
    logger.debug(`DocumentManagementClient (tRPC) created for: ${this.baseUrl}`);
  }
  async initialize() {
    try {
      await this.client.ping.query();
    } catch (error) {
      logger.debug(
        `Failed to connect to DocumentManagement server at ${this.baseUrl}: ${error}`
      );
      throw new Error(
        `Failed to connect to server at ${this.baseUrl}.

Please verify the server URL includes the correct port (default 8080) and ends with '/api' (e.g., 'http://localhost:8080/api').`
      );
    }
  }
  async shutdown() {
  }
  async listLibraries() {
    return this.client.listLibraries.query();
  }
  async validateLibraryExists(library) {
    await this.client.validateLibraryExists.mutate({ library });
  }
  async findBestVersion(library, targetVersion) {
    return this.client.findBestVersion.query({ library, targetVersion });
  }
  async searchStore(library, version, query, limit) {
    return this.client.search.query({ library, version: version ?? null, query, limit });
  }
  async removeVersion(library, version) {
    await this.client.removeVersion.mutate({ library, version });
  }
  async removeAllDocuments(library, version) {
    await this.client.removeAllDocuments.mutate({ library, version: version ?? null });
  }
  async getVersionsByStatus(statuses) {
    return this.client.getVersionsByStatus.query({
      statuses
    });
  }
  async findVersionsBySourceUrl(url) {
    return this.client.findVersionsBySourceUrl.query({ url });
  }
  async getScraperOptions(versionId) {
    return this.client.getScraperOptions.query({ versionId });
  }
  async updateVersionStatus(versionId, status, errorMessage) {
    await this.client.updateVersionStatus.mutate({ versionId, status, errorMessage });
  }
  async updateVersionProgress(versionId, pages, maxPages) {
    await this.client.updateVersionProgress.mutate({ versionId, pages, maxPages });
  }
  async storeScraperOptions(versionId, options) {
    await this.client.storeScraperOptions.mutate({ versionId, options });
  }
  getActiveEmbeddingConfig() {
    return null;
  }
}
function compareVersionsDescending(a, b) {
  const aIsUnversioned = a === "" || a === null || a === void 0;
  const bIsUnversioned = b === "" || b === null || b === void 0;
  if (aIsUnversioned && bIsUnversioned) return 0;
  if (aIsUnversioned) return -1;
  if (bIsUnversioned) return 1;
  const aSemver = semver__default.valid(a) ?? semver__default.valid(semver__default.coerce(a));
  const bSemver = semver__default.valid(b) ?? semver__default.valid(semver__default.coerce(b));
  if (aSemver && bSemver) {
    return semver__default.rcompare(aSemver, bSemver);
  }
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  return bLower.localeCompare(aLower);
}
function sortVersionsDescending(versions) {
  return [...versions].sort(compareVersionsDescending);
}
class HierarchicalAssemblyStrategy {
  constructor(config) {
    this.config = config;
  }
  /**
   * Determines if this strategy can handle the given content type.
   * Handles structured content like source code, JSON, configuration files.
   */
  canHandle(mimeType) {
    if (!mimeType) {
      return false;
    }
    if (MimeTypeUtils.isSourceCode(mimeType)) {
      return true;
    }
    if (MimeTypeUtils.isJson(mimeType)) {
      return true;
    }
    return false;
  }
  /**
   * Selects chunks using selective subtree reassembly for multiple matches within documents.
   * For single matches: uses existing parent chain logic.
   * For multiple matches in same document: finds common ancestor and reconstructs minimal subtree.
   */
  async selectChunks(library, version, initialChunks, documentStore) {
    if (initialChunks.length === 0) {
      return [];
    }
    try {
      const chunksByDocument = /* @__PURE__ */ new Map();
      for (const chunk of initialChunks) {
        const url = chunk.url;
        if (!chunksByDocument.has(url)) {
          chunksByDocument.set(url, []);
        }
        chunksByDocument.get(url)?.push(chunk);
      }
      const allChunkIds = /* @__PURE__ */ new Set();
      for (const [_url, documentChunks] of Array.from(chunksByDocument.entries())) {
        if (documentChunks.length === 1) {
          const matched = documentChunks[0];
          const structuralAncestor = await this.findStructuralAncestor(
            library,
            version,
            matched,
            documentStore
          ) ?? matched;
          let promotedAncestor = structuralAncestor;
          try {
            const path2 = matched.metadata.path || [];
            if (promotedAncestor === matched && path2.length > 0) {
              const topLevelPath = [path2[0]];
              const containerIds = await this.findContainerChunks(
                library,
                version,
                matched,
                topLevelPath,
                documentStore
              );
              if (containerIds.length > 0) {
                const topChunks = await documentStore.findChunksByIds(library, version, [
                  containerIds[0]
                ]);
                if (topChunks.length > 0) {
                  promotedAncestor = topChunks[0];
                }
              }
            }
          } catch (e) {
            logger.warn(
              `Top-level function promotion failed for chunk ${matched.id}: ${e}`
            );
          }
          allChunkIds.add(matched.id);
          const ancestorParentChain = await this.walkToRoot(
            library,
            version,
            promotedAncestor,
            documentStore
          );
          for (const id of ancestorParentChain) {
            allChunkIds.add(id);
          }
          const subtreeIds = await this.findSubtreeChunks(
            library,
            version,
            promotedAncestor,
            documentStore
          );
          for (const id of subtreeIds) {
            allChunkIds.add(id);
          }
        } else {
          for (const matched of documentChunks) {
            allChunkIds.add(matched.id);
          }
          const subtreeIds = await this.selectSubtreeChunks(
            library,
            version,
            documentChunks,
            documentStore
          );
          for (const id of subtreeIds) {
            allChunkIds.add(id);
          }
        }
      }
      const chunkIds = Array.from(allChunkIds);
      const chunks = await documentStore.findChunksByIds(library, version, chunkIds);
      return chunks;
    } catch (error) {
      logger.warn(
        `Hierarchical parent chain walking failed, falling back to basic selection: ${error}`
      );
      return this.fallbackSelection(library, version, initialChunks, documentStore);
    }
  }
  /**
   * Assembles chunks using simple concatenation.
   * Relies on splitter concatenation guarantees - chunks are designed to join seamlessly.
   */
  assembleContent(chunks, debug = false) {
    if (debug) {
      return chunks.map(
        (chunk) => `=== #${chunk.id} ${chunk.metadata.path?.join("/")} [${chunk.metadata.level}] ===
` + chunk.content
      ).join("");
    }
    return chunks.map((chunk) => chunk.content).join("");
  }
  /**
   * Walks up the parent hierarchy from a chunk to collect the complete parent chain.
   * Includes the chunk itself and every parent until reaching the root.
   * Protected against circular references and infinite loops.
   *
   * Handles hierarchical gaps by attempting to find ancestors at progressively shorter
   * path lengths when direct parent lookup fails (e.g., when intermediate chunks
   * have been merged or are missing).
   */
  async walkToRoot(library, version, chunk, documentStore) {
    const chainIds = [];
    const visited = /* @__PURE__ */ new Set();
    let currentChunk = chunk;
    const { maxParentChainDepth } = this.config.assembly;
    let depth = 0;
    while (currentChunk && depth < maxParentChainDepth) {
      const currentId = currentChunk.id;
      if (visited.has(currentId)) {
        logger.warn(`Circular reference detected in parent chain for chunk ${currentId}`);
        break;
      }
      visited.add(currentId);
      chainIds.push(currentId);
      depth++;
      let parentChunk = await documentStore.findParentChunk(library, version, currentId);
      if (!parentChunk) {
        parentChunk = await this.findAncestorWithGaps(
          library,
          version,
          currentChunk.url,
          currentChunk.metadata.path ?? [],
          documentStore
        );
      }
      currentChunk = parentChunk;
    }
    if (depth >= maxParentChainDepth) {
      logger.warn(
        `Maximum parent chain depth (${maxParentChainDepth}) reached for chunk ${chunk.id}`
      );
    }
    return chainIds;
  }
  /**
   * Attempts to find ancestors when there are gaps in the hierarchy.
   * Tries progressively shorter path prefixes to find existing ancestor chunks.
   */
  async findAncestorWithGaps(library, version, url, path2, documentStore) {
    if (path2.length <= 1) {
      return null;
    }
    for (let pathLength = path2.length - 1; pathLength > 0; pathLength--) {
      const ancestorPath = path2.slice(0, pathLength);
      try {
        const potentialAncestors = await this.findChunksByPathPrefix(
          library,
          version,
          url,
          ancestorPath,
          documentStore
        );
        if (potentialAncestors.length > 0) {
          return potentialAncestors[0];
        }
      } catch (error) {
        logger.debug(
          `Failed to find ancestor with path ${ancestorPath.join("/")}: ${error}`
        );
      }
    }
    return null;
  }
  /**
   * Finds chunks that have an exact path match or are prefixes of the given path.
   * This is a more flexible version of findChunksByPath that can handle gaps.
   */
  async findChunksByPathPrefix(library, version, url, targetPath, documentStore) {
    try {
      const allChunks = await documentStore.findChunksByUrl(library, version, url);
      if (allChunks.length === 0) {
        return [];
      }
      const matchingChunks = allChunks.filter((chunk) => {
        const chunkPath = chunk.metadata.path || [];
        const chunkUrl = chunk.url;
        if (chunkUrl !== url) return false;
        if (chunkPath.length !== targetPath.length) return false;
        return chunkPath.every((part, index) => part === targetPath[index]);
      });
      return matchingChunks;
    } catch (error) {
      logger.warn(`Error in findChunksByPathPrefix: ${error}`);
      return [];
    }
  }
  /**
   * Finds the nearest structural ancestor (types includes "structural") for a chunk.
   * If none exists (e.g. the matched chunk itself is structural or at top), returns null.
   */
  async findStructuralAncestor(library, version, chunk, documentStore) {
    let current = chunk;
    const isStructural = (c) => !!c && Array.isArray(c.metadata?.types) && c.metadata.types.includes("structural");
    if (isStructural(current)) {
      return current;
    }
    while (true) {
      const parent = await documentStore.findParentChunk(library, version, current.id);
      if (!parent) {
        return null;
      }
      if (isStructural(parent)) {
        return parent;
      }
      current = parent;
    }
  }
  /**
   * Selects chunks for selective subtree reassembly when multiple matches exist in the same document.
   * Finds the common ancestor and reconstructs only the relevant subtrees.
   */
  async selectSubtreeChunks(library, version, documentChunks, documentStore) {
    const chunkIds = /* @__PURE__ */ new Set();
    const commonAncestorPath = this.findCommonAncestorPath(documentChunks);
    if (commonAncestorPath.length === 0) {
      logger.warn(
        "No common ancestor found for multiple matches, using individual parent chains"
      );
      for (const chunk of documentChunks) {
        const parentChain = await this.walkToRoot(library, version, chunk, documentStore);
        for (const id of parentChain) {
          chunkIds.add(id);
        }
      }
      return Array.from(chunkIds);
    }
    const containerIds = await this.findContainerChunks(
      library,
      version,
      documentChunks[0],
      // Use first chunk to get document URL
      commonAncestorPath,
      documentStore
    );
    for (const id of containerIds) {
      chunkIds.add(id);
    }
    for (const chunk of documentChunks) {
      const subtreeIds = await this.findSubtreeChunks(
        library,
        version,
        chunk,
        documentStore
      );
      for (const id of subtreeIds) {
        chunkIds.add(id);
      }
    }
    return Array.from(chunkIds);
  }
  /**
   * Finds the common ancestor path from a list of chunks by finding the longest common prefix.
   */
  findCommonAncestorPath(chunks) {
    if (chunks.length === 0) return [];
    if (chunks.length === 1) return chunks[0].metadata.path ?? [];
    const paths = chunks.map((chunk) => chunk.metadata.path ?? []);
    if (paths.length === 0) return [];
    const minLength = Math.min(...paths.map((path2) => path2.length));
    const commonPrefix = [];
    for (let i = 0; i < minLength; i++) {
      const currentElement = paths[0][i];
      if (paths.every((path2) => path2[i] === currentElement)) {
        commonPrefix.push(currentElement);
      } else {
        break;
      }
    }
    return commonPrefix;
  }
  /**
   * Finds the container chunks (opening/closing) for a given ancestor path.
   */
  async findContainerChunks(library, version, referenceChunk, ancestorPath, documentStore) {
    const containerIds = [];
    try {
      const ancestorChunks = await this.findChunksByExactPath(
        library,
        version,
        referenceChunk.url,
        ancestorPath,
        documentStore
      );
      for (const chunk of ancestorChunks) {
        containerIds.push(chunk.id);
      }
    } catch (error) {
      logger.warn(
        `Failed to find container chunks for path ${ancestorPath.join("/")}: ${error}`
      );
    }
    return containerIds;
  }
  /**
   * Finds all chunks with an exact path match within a specific document.
   * More efficient than searching across all chunks by first filtering by URL.
   */
  async findChunksByExactPath(library, version, url, path2, documentStore) {
    try {
      if (path2.length === 0) {
        logger.debug("Root path requested - no chunks found");
        return [];
      }
      const allChunks = await documentStore.findChunksByUrl(library, version, url);
      if (allChunks.length === 0) {
        return [];
      }
      const matchingChunks = allChunks.filter((chunk) => {
        const chunkPath = chunk.metadata.path ?? [];
        if (chunkPath.length !== path2.length) return false;
        return chunkPath.every((part, index) => part === path2[index]);
      });
      logger.debug(
        `Found ${matchingChunks.length} chunks for exact path: ${path2.join("/")}`
      );
      return matchingChunks;
    } catch (error) {
      logger.warn(`Error finding chunks for exact path ${path2.join("/")}: ${error}`);
      return [];
    }
  }
  /**
   * Finds all chunks in the subtree rooted at the given chunk.
   */
  async findSubtreeChunks(library, version, rootChunk, documentStore) {
    const subtreeIds = [];
    const visited = /* @__PURE__ */ new Set();
    const queue = [rootChunk];
    while (queue.length > 0) {
      const currentChunk = queue.shift();
      const currentId = currentChunk.id;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      subtreeIds.push(currentId);
      try {
        const children = await documentStore.findChildChunks(
          library,
          version,
          currentId,
          1e3
        );
        queue.push(...children);
      } catch (error) {
        logger.warn(`Failed to find children for chunk ${currentId}: ${error}`);
      }
    }
    return subtreeIds;
  }
  /**
   * Fallback selection method when parent chain walking fails.
   * Uses a simplified approach similar to MarkdownAssemblyStrategy but more conservative.
   */
  async fallbackSelection(library, version, initialChunks, documentStore) {
    const chunkIds = /* @__PURE__ */ new Set();
    for (const chunk of initialChunks) {
      const id = chunk.id;
      chunkIds.add(id);
      const parent = await documentStore.findParentChunk(library, version, id);
      if (parent) {
        chunkIds.add(parent.id);
      }
      try {
        const children = await documentStore.findChildChunks(library, version, id, 3);
        for (const child of children) {
          chunkIds.add(child.id);
        }
      } catch (error) {
        logger.warn(`Failed to find children for chunk ${id}: ${error}`);
      }
    }
    const chunks = await documentStore.findChunksByIds(
      library,
      version,
      Array.from(chunkIds)
    );
    return chunks;
  }
}
class MarkdownAssemblyStrategy {
  constructor(config) {
    this.config = config;
  }
  /**
   * Determines if this strategy can handle the given content type.
   * Handles markdown, HTML, plain text, and serves as fallback for unknown types.
   */
  canHandle(mimeType) {
    if (!mimeType) {
      return true;
    }
    if (MimeTypeUtils.isSourceCode(mimeType) || MimeTypeUtils.isJson(mimeType)) {
      return false;
    }
    if (MimeTypeUtils.isMarkdown(mimeType)) {
      return true;
    }
    if (MimeTypeUtils.isHtml(mimeType)) {
      return true;
    }
    if (MimeTypeUtils.isText(mimeType)) {
      return true;
    }
    return true;
  }
  /**
   * Selects chunks using the current context expansion logic.
   * This replicates the existing behavior from DocumentRetrieverService.getRelatedChunkIds().
   */
  async selectChunks(library, version, initialChunks, documentStore) {
    const allChunkIds = /* @__PURE__ */ new Set();
    const relatedIdsPromises = initialChunks.map(
      (doc) => this.getRelatedChunkIds(library, version, doc, documentStore)
    );
    const relatedIdsResults = await Promise.all(relatedIdsPromises);
    for (const relatedIds of relatedIdsResults) {
      for (const id of relatedIds) {
        allChunkIds.add(id);
      }
    }
    const chunkIds = Array.from(allChunkIds);
    const chunks = await documentStore.findChunksByIds(library, version, chunkIds);
    return chunks;
  }
  /**
   * Assembles chunks using simple "\n\n" joining (current behavior).
   */
  assembleContent(chunks) {
    return chunks.map((chunk) => chunk.content).join("\n\n");
  }
  /**
   * Collects related chunk IDs for a single chunk using current context expansion logic.
   * This is a direct port of the logic from DocumentRetrieverService.getRelatedChunkIds().
   */
  async getRelatedChunkIds(library, version, doc, documentStore) {
    const id = doc.id;
    const relatedIds = /* @__PURE__ */ new Set();
    const { childLimit, precedingSiblingsLimit, subsequentSiblingsLimit } = this.config.assembly;
    relatedIds.add(id);
    const parent = await documentStore.findParentChunk(library, version, id);
    if (parent) {
      relatedIds.add(parent.id);
    }
    const precedingSiblings = await documentStore.findPrecedingSiblingChunks(
      library,
      version,
      id,
      precedingSiblingsLimit
    );
    for (const sib of precedingSiblings) {
      relatedIds.add(sib.id);
    }
    const childChunks = await documentStore.findChildChunks(
      library,
      version,
      id,
      childLimit
    );
    for (const child of childChunks) {
      relatedIds.add(child.id);
    }
    const subsequentSiblings = await documentStore.findSubsequentSiblingChunks(
      library,
      version,
      id,
      subsequentSiblingsLimit
    );
    for (const sib of subsequentSiblings) {
      relatedIds.add(sib.id);
    }
    return relatedIds;
  }
}
function createContentAssemblyStrategy(mimeType, config) {
  if (!mimeType) {
    return new MarkdownAssemblyStrategy(config);
  }
  const strategies = [
    new HierarchicalAssemblyStrategy(config),
    new MarkdownAssemblyStrategy(config)
  ];
  for (const strategy of strategies) {
    if (strategy.canHandle(mimeType)) {
      return strategy;
    }
  }
  return new MarkdownAssemblyStrategy(config);
}
class DocumentRetrieverService {
  documentStore;
  config;
  constructor(documentStore, config) {
    this.documentStore = documentStore;
    this.config = config;
  }
  /**
   * Searches for documents and expands the context around the matches using content-type-aware strategies.
   * @param library The library name.
   * @param version The library version.
   * @param query The search query.
   * @param limit The optional limit for the initial search results.
   * @returns An array of search results with content assembled according to content type.
   */
  async search(library, version, query, limit) {
    const normalizedVersion = (version ?? "").toLowerCase();
    const initialResults = await this.documentStore.findByContent(
      library,
      normalizedVersion,
      query,
      limit ?? 10
    );
    if (initialResults.length === 0) {
      return [];
    }
    const resultsByUrl = this.groupResultsByUrl(initialResults);
    const results = [];
    for (const [url, urlResults] of resultsByUrl.entries()) {
      const result = await this.processUrlGroup(
        library,
        normalizedVersion,
        url,
        urlResults
      );
      results.push(result);
    }
    return results;
  }
  /**
   * Groups search results by URL.
   */
  groupResultsByUrl(results) {
    const resultsByUrl = /* @__PURE__ */ new Map();
    for (const result of results) {
      const url = result.url;
      if (!resultsByUrl.has(url)) {
        resultsByUrl.set(url, []);
      }
      const urlResults = resultsByUrl.get(url);
      if (urlResults) {
        urlResults.push(result);
      }
    }
    return resultsByUrl;
  }
  /**
   * Processes a group of search results from the same URL using appropriate strategy.
   */
  async processUrlGroup(library, version, url, initialChunks) {
    const mimeType = initialChunks.length > 0 ? initialChunks[0].content_type : void 0;
    const maxScore = Math.max(...initialChunks.map((chunk) => chunk.score));
    const strategy = createContentAssemblyStrategy(mimeType, this.config);
    const selectedChunks = await strategy.selectChunks(
      library,
      version,
      initialChunks,
      this.documentStore
    );
    const content = strategy.assembleContent(selectedChunks);
    return {
      url,
      content,
      score: maxScore,
      mimeType
    };
  }
}
const MIGRATIONS_DIR = path.join(getProjectRoot(), "db", "migrations");
const MIGRATIONS_TABLE = "_schema_migrations";
function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}
function getAppliedMigrations(db) {
  const stmt = db.prepare(`SELECT id FROM ${MIGRATIONS_TABLE}`);
  const rows = stmt.all();
  return new Set(rows.map((row) => row.id));
}
async function applyMigrations(db, options) {
  const maxRetries = options?.maxRetries ?? 5;
  const retryDelayMs = options?.retryDelayMs ?? 300;
  try {
    db.pragma("journal_mode = OFF");
    db.pragma("synchronous = OFF");
    db.pragma("mmap_size = 268435456");
    db.pragma("cache_size = -64000");
    db.pragma("temp_store = MEMORY");
    logger.debug("Applied performance optimizations for migration");
  } catch (_error) {
    logger.warn("⚠️  Could not apply all performance optimizations for migration");
  }
  const overallTransaction = db.transaction(() => {
    logger.debug("Checking database migrations...");
    ensureMigrationsTable(db);
    const appliedMigrations = getAppliedMigrations(db);
    if (!fs.existsSync(MIGRATIONS_DIR)) {
      throw new StoreError("Migrations directory not found");
    }
    const migrationFiles = fs.readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort();
    const pendingMigrations = migrationFiles.filter(
      (filename) => !appliedMigrations.has(filename)
    );
    if (pendingMigrations.length > 0) {
      logger.info(`🔄 Applying ${pendingMigrations.length} database migration(s)...`);
    }
    let appliedCount = 0;
    for (const filename of pendingMigrations) {
      logger.debug(`Applying migration: ${filename}`);
      const filePath = path.join(MIGRATIONS_DIR, filename);
      const sql = fs.readFileSync(filePath, "utf8");
      try {
        db.exec(sql);
        const insertStmt = db.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (id) VALUES (?)`);
        insertStmt.run(filename);
        logger.debug(`Applied migration: ${filename}`);
        appliedCount++;
      } catch (error) {
        logger.error(`❌ Failed to apply migration: ${filename} - ${error}`);
        throw new StoreError(`Migration failed: ${filename}`, error);
      }
    }
    if (appliedCount > 0) {
      logger.info(`✅ Successfully applied ${appliedCount} migration(s)`);
    } else {
      logger.debug("Database schema is up to date");
    }
    return appliedCount;
  });
  let retries = 0;
  let appliedMigrationsCount = 0;
  while (true) {
    try {
      appliedMigrationsCount = overallTransaction.immediate();
      logger.debug("Database migrations completed successfully");
      if (appliedMigrationsCount > 0) {
        try {
          logger.debug(
            `Running VACUUM after applying ${appliedMigrationsCount} migration(s)...`
          );
          db.exec("VACUUM");
          logger.debug("Database vacuum completed successfully");
        } catch (error) {
          logger.warn(`⚠️  Could not vacuum database after migrations: ${error}`);
        }
      } else {
        logger.debug("Skipping VACUUM - no migrations were applied");
      }
      break;
    } catch (error) {
      if (error?.code === "SQLITE_BUSY" && retries < maxRetries) {
        retries++;
        logger.warn(
          `⚠️  Migrations busy (SQLITE_BUSY), retrying attempt ${retries}/${maxRetries} in ${retryDelayMs}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      } else {
        if (error?.code === "SQLITE_BUSY") {
          logger.error(
            `❌ Migrations still busy after ${maxRetries} retries. Giving up: ${error}`
          );
        }
        if (error instanceof StoreError) {
          throw error;
        }
        throw new StoreError("Failed during migration process", error);
      }
    }
  }
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("wal_autocheckpoint = 1000");
    db.pragma("busy_timeout = 30000");
    db.pragma("foreign_keys = ON");
    db.pragma("synchronous = NORMAL");
    logger.debug(
      "Applied production database configuration (WAL mode, autocheckpoint, foreign keys, busy timeout)"
    );
  } catch (_error) {
    logger.warn("⚠️  Could not apply all production database settings");
  }
}
class EmbeddingConfig {
  static instance = null;
  /**
   * Get the singleton instance of EmbeddingConfig.
   * Creates the instance if it doesn't exist.
   */
  static getInstance() {
    if (EmbeddingConfig.instance === null) {
      EmbeddingConfig.instance = new EmbeddingConfig();
    }
    return EmbeddingConfig.instance;
  }
  /**
   * Reset the singleton instance (useful for testing).
   */
  static resetInstance() {
    EmbeddingConfig.instance = null;
  }
  /**
   * Known dimensions for common embedding models.
   * This avoids expensive API calls for dimension detection in telemetry.
   *
   * Note: The "openai" provider also supports OpenAI-compatible APIs like:
   * - Ollama (local models)
   * - LMStudio (local models)
   * - Any service implementing OpenAI's embedding API
   */
  knownModelDimensions = {
    // OpenAI models (also works with Ollama, LMStudio, and other OpenAI-compatible APIs)
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
    // Google Vertex AI models
    "text-embedding-004": 768,
    "textembedding-gecko@003": 768,
    "textembedding-gecko@002": 768,
    "textembedding-gecko@001": 768,
    // Google Gemini models (with MRL support)
    "text-embedding-preview-0409": 768,
    "embedding-001": 768,
    // AWS Bedrock models
    // Amazon Titan models
    "amazon.titan-embed-text-v1": 1536,
    "amazon.titan-embed-text-v2:0": 1024,
    "amazon.titan-embed-image-v1": 1024,
    // Image embedding model
    // Cohere models
    "cohere.embed-english-v3": 1024,
    "cohere.embed-multilingual-v3": 1024,
    // SageMaker models (hosted on AWS SageMaker)
    "intfloat/multilingual-e5-large": 1024,
    // Additional AWS models that might be supported
    // Note: Some of these might be placeholders - verify dimensions before use
    // "amazon.nova-embed-multilingual-v1:0": 4096, // Commented out as noted in source
    // MTEB Leaderboard models (source: https://huggingface.co/spaces/mteb/leaderboard)
    // Top performing models from Massive Text Embedding Benchmark
    "sentence-transformers/all-MiniLM-L6-v2": 384,
    "gemini-embedding-001": 3072,
    "Qwen/Qwen3-Embedding-8B": 4096,
    "Qwen/Qwen3-Embedding-4B": 2560,
    "Qwen/Qwen3-Embedding-0.6B": 1024,
    "Linq-AI-Research/Linq-Embed-Mistral": 4096,
    "Alibaba-NLP/gte-Qwen2-7B-instruct": 3584,
    "intfloat/multilingual-e5-large-instruct": 1024,
    "Salesforce/SFR-Embedding-Mistral": 4096,
    "text-multilingual-embedding-002": 768,
    "GritLM/GritLM-7B": 4096,
    "GritLM/GritLM-8x7B": 4096,
    "intfloat/e5-mistral-7b-instruct": 4096,
    "Cohere/Cohere-embed-multilingual-v3.0": 1024,
    "Alibaba-NLP/gte-Qwen2-1.5B-instruct": 8960,
    "Lajavaness/bilingual-embedding-large": 1024,
    "Salesforce/SFR-Embedding-2_R": 4096,
    "NovaSearch/stella_en_1.5B_v5": 8960,
    "NovaSearch/jasper_en_vision_language_v1": 8960,
    "nvidia/NV-Embed-v2": 4096,
    "OrdalieTech/Solon-embeddings-large-0.1": 1024,
    "BAAI/bge-m3": 1024,
    "HIT-TMG/KaLM-embedding-multilingual-mini-v1": 896,
    "jinaai/jina-embeddings-v3": 1024,
    "Alibaba-NLP/gte-multilingual-base": 768,
    "Lajavaness/bilingual-embedding-base": 768,
    "HIT-TMG/KaLM-embedding-multilingual-mini-instruct-v1": 896,
    "nvidia/NV-Embed-v1": 4096,
    "Cohere/Cohere-embed-multilingual-light-v3.0": 384,
    "manu/bge-m3-custom-fr": 1024,
    "Lajavaness/bilingual-embedding-small": 384,
    "Snowflake/snowflake-arctic-embed-l-v2.0": 1024,
    "intfloat/multilingual-e5-base": 768,
    "voyage-3-lite": 512,
    "voyage-3": 1024,
    "intfloat/multilingual-e5-small": 384,
    "Alibaba-NLP/gte-Qwen1.5-7B-instruct": 4096,
    "Snowflake/snowflake-arctic-embed-m-v2.0": 768,
    "deepvk/USER-bge-m3": 1024,
    "Cohere/Cohere-embed-english-v3.0": 1024,
    "Omartificial-Intelligence-Space/Arabic-labse-Matryoshka": 768,
    "ibm-granite/granite-embedding-278m-multilingual": 768,
    "NovaSearch/stella_en_400M_v5": 4096,
    "omarelshehy/arabic-english-sts-matryoshka": 1024,
    "sentence-transformers/paraphrase-multilingual-mpnet-base-v2": 768,
    "Omartificial-Intelligence-Space/Arabic-all-nli-triplet-Matryoshka": 768,
    "Haon-Chen/speed-embedding-7b-instruct": 4096,
    "sentence-transformers/LaBSE": 768,
    "WhereIsAI/UAE-Large-V1": 1024,
    "ibm-granite/granite-embedding-107m-multilingual": 384,
    "mixedbread-ai/mxbai-embed-large-v1": 1024,
    "intfloat/e5-large-v2": 1024,
    "avsolatorio/GIST-large-Embedding-v0": 1024,
    "sdadas/mmlw-e5-large": 1024,
    "nomic-ai/nomic-embed-text-v1": 768,
    "nomic-ai/nomic-embed-text-v1-ablated": 768,
    "intfloat/e5-base-v2": 768,
    "BAAI/bge-large-en-v1.5": 1024,
    "intfloat/e5-large": 1024,
    "Omartificial-Intelligence-Space/Arabic-MiniLM-L12-v2-all-nli-triplet": 384,
    "Cohere/Cohere-embed-english-light-v3.0": 384,
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2": 768,
    "Gameselo/STS-multilingual-mpnet-base-v2": 768,
    "thenlper/gte-large": 1024,
    "avsolatorio/GIST-Embedding-v0": 768,
    "nomic-ai/nomic-embed-text-v1-unsupervised": 768,
    "infgrad/stella-base-en-v2": 768,
    "avsolatorio/NoInstruct-small-Embedding-v0": 384,
    "dwzhu/e5-base-4k": 768,
    "sdadas/mmlw-e5-base": 768,
    "voyage-multilingual-2": 1024,
    "McGill-NLP/LLM2Vec-Mistral-7B-Instruct-v2-mntp-supervised": 4096,
    "BAAI/bge-base-en-v1.5": 768,
    "avsolatorio/GIST-small-Embedding-v0": 384,
    "sdadas/mmlw-roberta-large": 1024,
    "nomic-ai/nomic-embed-text-v1.5": 768,
    "minishlab/potion-multilingual-128M": 256,
    "shibing624/text2vec-base-multilingual": 384,
    "thenlper/gte-base": 768,
    "intfloat/e5-small-v2": 384,
    "intfloat/e5-base": 768,
    "sentence-transformers/static-similarity-mrl-multilingual-v1": 1024,
    "manu/sentence_croissant_alpha_v0.3": 2048,
    "BAAI/bge-small-en-v1.5": 512,
    "thenlper/gte-small": 384,
    "sdadas/mmlw-e5-small": 384,
    "manu/sentence_croissant_alpha_v0.4": 2048,
    "manu/sentence_croissant_alpha_v0.2": 2048,
    "abhinand/MedEmbed-small-v0.1": 384,
    "ibm-granite/granite-embedding-125m-english": 768,
    "intfloat/e5-small": 384,
    "voyage-large-2-instruct": 1024,
    "sdadas/mmlw-roberta-base": 768,
    "Snowflake/snowflake-arctic-embed-l": 1024,
    "Mihaiii/Ivysaur": 384,
    "Snowflake/snowflake-arctic-embed-m-long": 768,
    "bigscience/sgpt-bloom-7b1-msmarco": 4096,
    "avsolatorio/GIST-all-MiniLM-L6-v2": 384,
    "sergeyzh/LaBSE-ru-turbo": 768,
    "sentence-transformers/all-mpnet-base-v2": 768,
    "Snowflake/snowflake-arctic-embed-m": 768,
    "Snowflake/snowflake-arctic-embed-s": 384,
    "sentence-transformers/all-MiniLM-L12-v2": 384,
    "Mihaiii/gte-micro-v4": 384,
    "Snowflake/snowflake-arctic-embed-m-v1.5": 768,
    "cointegrated/LaBSE-en-ru": 768,
    "Mihaiii/Bulbasaur": 384,
    "ibm-granite/granite-embedding-30m-english": 384,
    "deepfile/embedder-100p": 768,
    "Jaume/gemma-2b-embeddings": 2048,
    "OrlikB/KartonBERT-USE-base-v1": 768,
    "izhx/udever-bloom-7b1": 4096,
    "izhx/udever-bloom-1b1": 1024,
    "brahmairesearch/slx-v0.1": 384,
    "Mihaiii/Wartortle": 384,
    "izhx/udever-bloom-3b": 2048,
    "deepvk/USER-base": 768,
    "ai-forever/ru-en-RoSBERTa": 1024,
    "McGill-NLP/LLM2Vec-Mistral-7B-Instruct-v2-mntp-unsup-simcse": 4096,
    "Mihaiii/Venusaur": 384,
    "Snowflake/snowflake-arctic-embed-xs": 384,
    "jinaai/jina-embedding-b-en-v1": 768,
    "Mihaiii/gte-micro": 384,
    "aari1995/German_Semantic_STS_V2": 1024,
    "Mihaiii/Squirtle": 384,
    "OrlikB/st-polish-kartonberta-base-alpha-v1": 768,
    "sergeyzh/rubert-tiny-turbo": 312,
    "minishlab/potion-base-8M": 256,
    "minishlab/M2V_base_glove_subword": 256,
    "jinaai/jina-embedding-s-en-v1": 512,
    "minishlab/potion-base-4M": 128,
    "minishlab/M2V_base_output": 256,
    "DeepPavlov/rubert-base-cased-sentence": 768,
    "jinaai/jina-embeddings-v2-small-en": 512,
    "cointegrated/rubert-tiny2": 312,
    "minishlab/M2V_base_glove": 256,
    "cointegrated/rubert-tiny": 312,
    "silma-ai/silma-embeddding-matryoshka-v0.1": 768,
    "DeepPavlov/rubert-base-cased": 768,
    "Omartificial-Intelligence-Space/Arabic-mpnet-base-all-nli-triplet": 768,
    "izhx/udever-bloom-560m": 1024,
    "minishlab/potion-base-2M": 64,
    "DeepPavlov/distilrubert-small-cased-conversational": 768,
    "consciousAI/cai-lunaris-text-embeddings": 1024,
    "deepvk/deberta-v1-base": 768,
    "Omartificial-Intelligence-Space/Arabert-all-nli-triplet-Matryoshka": 768,
    "Omartificial-Intelligence-Space/Marbert-all-nli-triplet-Matryoshka": 768,
    "ai-forever/sbert_large_mt_nlu_ru": 1024,
    "ai-forever/sbert_large_nlu_ru": 1024,
    "malenia1/ternary-weight-embedding": 1024,
    "jinaai/jina-embeddings-v2-base-en": 768,
    "VPLabs/SearchMap_Preview": 4096,
    "Hum-Works/lodestone-base-4096-v1": 768,
    "jinaai/jina-embeddings-v4": 2048
  };
  /**
   * Lowercase lookup map for case-insensitive model dimension queries.
   * Built lazily from knownModelDimensions to ensure consistency.
   */
  modelLookup;
  constructor() {
    this.modelLookup = /* @__PURE__ */ new Map();
    for (const [model, dimensions] of Object.entries(this.knownModelDimensions)) {
      this.modelLookup.set(model.toLowerCase(), dimensions);
    }
  }
  /**
   * Parse embedding model configuration from a provided model specification.
   * This is a synchronous operation that extracts provider, model, and known dimensions.
   *
   * Supports various providers:
   * - openai: OpenAI models and OpenAI-compatible APIs (Ollama, LMStudio, etc.)
   * - vertex: Google Cloud Vertex AI
   * - gemini: Google Generative AI
   * - aws: AWS Bedrock models
   * - microsoft: Azure OpenAI
   * - sagemaker: AWS SageMaker hosted models
   *
   * @param modelSpec Model specification (e.g., "openai:text-embedding-3-small"), defaults to "text-embedding-3-small"
   * @returns Parsed embedding model configuration
   */
  parse(modelSpec) {
    const spec = modelSpec || "text-embedding-3-small";
    const colonIndex = spec.indexOf(":");
    let provider;
    let model;
    if (colonIndex === -1) {
      provider = "openai";
      model = spec;
    } else {
      provider = spec.substring(0, colonIndex);
      model = spec.substring(colonIndex + 1);
    }
    const dimensions = this.modelLookup?.get(model.toLowerCase()) || null;
    return {
      provider,
      model,
      dimensions,
      modelSpec: spec
    };
  }
  /**
   * Get the known dimensions for a specific model.
   * Returns null if the model dimensions are not known.
   * Uses case-insensitive lookup.
   *
   * @param model The model name (e.g., "text-embedding-3-small")
   * @returns Known dimensions or null
   */
  getKnownDimensions(model) {
    return this.modelLookup?.get(model.toLowerCase()) || null;
  }
  /**
   * Add or update known dimensions for a model.
   * This can be used to cache discovered dimensions.
   * Stores both original case and lowercase for consistent lookup.
   *
   * @param model The model name
   * @param dimensions The dimensions to cache
   */
  setKnownDimensions(model, dimensions) {
    this.knownModelDimensions[model] = dimensions;
    if (this.modelLookup) {
      this.modelLookup.set(model.toLowerCase(), dimensions);
    }
  }
  /**
   * Static method to parse embedding model configuration using the singleton instance.
   * This maintains backward compatibility while using the class-based approach.
   */
  static parseEmbeddingConfig(modelSpec) {
    return EmbeddingConfig.getInstance().parse(modelSpec);
  }
  /**
   * Static method to get known model dimensions using the singleton instance.
   * This maintains backward compatibility while using the class-based approach.
   */
  static getKnownModelDimensions(model) {
    return EmbeddingConfig.getInstance().getKnownDimensions(model);
  }
  /**
   * Static method to set known model dimensions using the singleton instance.
   * This maintains backward compatibility while using the class-based approach.
   */
  static setKnownModelDimensions(model, dimensions) {
    EmbeddingConfig.getInstance().setKnownDimensions(model, dimensions);
  }
}
var VersionStatus = /* @__PURE__ */ ((VersionStatus2) => {
  VersionStatus2["NOT_INDEXED"] = "not_indexed";
  VersionStatus2["QUEUED"] = "queued";
  VersionStatus2["RUNNING"] = "running";
  VersionStatus2["COMPLETED"] = "completed";
  VersionStatus2["FAILED"] = "failed";
  VersionStatus2["CANCELLED"] = "cancelled";
  VersionStatus2["UPDATING"] = "updating";
  return VersionStatus2;
})(VersionStatus || {});
function normalizeVersionName(name) {
  return name ?? "";
}
function denormalizeVersionName(name) {
  return name === "" ? "" : name;
}
function getStatusDescription(status) {
  const descriptions = {
    [
      "not_indexed"
      /* NOT_INDEXED */
    ]: "Version created but not yet indexed",
    [
      "queued"
      /* QUEUED */
    ]: "Waiting in queue for indexing",
    [
      "running"
      /* RUNNING */
    ]: "Currently being indexed",
    [
      "completed"
      /* COMPLETED */
    ]: "Successfully indexed",
    [
      "failed"
      /* FAILED */
    ]: "Indexing failed",
    [
      "cancelled"
      /* CANCELLED */
    ]: "Indexing was cancelled",
    [
      "updating"
      /* UPDATING */
    ]: "Re-indexing in progress"
  };
  return descriptions[status] || "Unknown status";
}
function isActiveStatus(status) {
  return [
    "queued",
    "running",
    "updating"
    /* UPDATING */
  ].includes(
    status
  );
}
class DocumentStore {
  config;
  db;
  embeddings;
  dbDimension;
  searchWeightVec;
  searchWeightFts;
  searchOverfetchFactor;
  vectorSearchMultiplier;
  splitterMaxChunkSize;
  embeddingBatchSize;
  embeddingBatchChars;
  embeddingInitTimeoutMs;
  modelDimension;
  embeddingConfig;
  isVectorSearchEnabled = false;
  /**
   * Returns the active embedding configuration if vector search is enabled,
   * or null if embeddings are disabled (no config provided or credentials unavailable).
   */
  getActiveEmbeddingConfig() {
    if (!this.isVectorSearchEnabled || !this.embeddingConfig) {
      return null;
    }
    return this.embeddingConfig;
  }
  statements;
  /**
   * Calculates Reciprocal Rank Fusion score for a result with configurable weights
   */
  calculateRRF(vecRank, ftsRank, k = 60) {
    let rrf = 0;
    if (vecRank !== void 0) {
      rrf += this.searchWeightVec / (k + vecRank);
    }
    if (ftsRank !== void 0) {
      rrf += this.searchWeightFts / (k + ftsRank);
    }
    return rrf;
  }
  /**
   * Assigns ranks to search results based on their scores
   */
  assignRanks(results) {
    const vecRanks = /* @__PURE__ */ new Map();
    const ftsRanks = /* @__PURE__ */ new Map();
    results.filter((r) => r.vec_score !== void 0).sort((a, b) => (b.vec_score ?? 0) - (a.vec_score ?? 0)).forEach((result, index) => {
      vecRanks.set(Number(result.id), index + 1);
    });
    results.filter((r) => r.fts_score !== void 0).sort((a, b) => (b.fts_score ?? 0) - (a.fts_score ?? 0)).forEach((result, index) => {
      ftsRanks.set(Number(result.id), index + 1);
    });
    return results.map((result) => ({
      ...result,
      vec_rank: vecRanks.get(Number(result.id)),
      fts_rank: ftsRanks.get(Number(result.id)),
      rrf_score: this.calculateRRF(
        vecRanks.get(Number(result.id)),
        ftsRanks.get(Number(result.id))
      )
    }));
  }
  constructor(dbPath, appConfig) {
    if (!dbPath) {
      throw new StoreError("Missing required database path");
    }
    this.config = appConfig;
    this.dbDimension = this.config.embeddings.vectorDimension;
    this.searchWeightVec = this.config.search.weightVec;
    this.searchWeightFts = this.config.search.weightFts;
    this.searchOverfetchFactor = this.config.search.overfetchFactor;
    this.vectorSearchMultiplier = this.config.search.vectorMultiplier;
    this.splitterMaxChunkSize = this.config.splitter.maxChunkSize;
    this.embeddingBatchSize = this.config.embeddings.batchSize;
    this.embeddingBatchChars = this.config.embeddings.batchChars;
    this.embeddingInitTimeoutMs = this.config.embeddings.initTimeoutMs;
    this.db = new Database(dbPath);
    this.embeddingConfig = this.resolveEmbeddingConfig(appConfig.app.embeddingModel);
  }
  resolveEmbeddingConfig(modelSpec) {
    const resolvedSpec = modelSpec;
    if (!resolvedSpec) {
      logger.debug("No embedding model specified. Embeddings are disabled.");
      return null;
    }
    try {
      logger.debug(`Resolving embedding configuration for model: ${resolvedSpec}`);
      return EmbeddingConfig.parseEmbeddingConfig(resolvedSpec);
    } catch (error) {
      logger.debug(`Failed to resolve embedding configuration: ${error}`);
      return null;
    }
  }
  /**
   * Sets up prepared statements for database queries
   */
  prepareStatements() {
    const statements = {
      getById: this.db.prepare(
        `SELECT d.id, d.page_id, d.content, json(d.metadata) as metadata, d.sort_order, d.embedding, d.created_at, p.url, p.title, p.content_type 
         FROM documents d
         JOIN pages p ON d.page_id = p.id
         WHERE d.id = ?`
      ),
      // Updated for new schema
      insertDocument: this.db.prepare(
        "INSERT INTO documents (page_id, content, metadata, sort_order) VALUES (?, ?, ?, ?)"
      ),
      insertEmbedding: this.db.prepare(
        "UPDATE documents SET embedding = ? WHERE id = ?"
      ),
      insertPage: this.db.prepare(
        "INSERT INTO pages (version_id, url, title, etag, last_modified, content_type, depth) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(version_id, url) DO UPDATE SET title = excluded.title, content_type = excluded.content_type, etag = excluded.etag, last_modified = excluded.last_modified, depth = excluded.depth"
      ),
      getPageId: this.db.prepare(
        "SELECT id FROM pages WHERE version_id = ? AND url = ?"
      ),
      insertLibrary: this.db.prepare(
        "INSERT INTO libraries (name) VALUES (?) ON CONFLICT(name) DO NOTHING"
      ),
      getLibraryIdByName: this.db.prepare(
        "SELECT id FROM libraries WHERE name = ?"
      ),
      getLibraryById: this.db.prepare("SELECT * FROM libraries WHERE id = ?"),
      // New version-related statements
      insertVersion: this.db.prepare(
        "INSERT INTO versions (library_id, name, status) VALUES (?, ?, 'not_indexed') ON CONFLICT(library_id, name) DO NOTHING"
      ),
      resolveVersionId: this.db.prepare(
        "SELECT id FROM versions WHERE library_id = ? AND name = ?"
      ),
      getVersionById: this.db.prepare("SELECT * FROM versions WHERE id = ?"),
      queryVersionsByLibraryId: this.db.prepare(
        "SELECT * FROM versions WHERE library_id = ? ORDER BY name"
      ),
      deleteDocuments: this.db.prepare(
        `DELETE FROM documents 
         WHERE page_id IN (
           SELECT p.id FROM pages p
           JOIN versions v ON p.version_id = v.id
           JOIN libraries l ON v.library_id = l.id
           WHERE l.name = ? AND COALESCE(v.name, '') = COALESCE(?, '')
         )`
      ),
      deleteDocumentsByPageId: this.db.prepare(
        "DELETE FROM documents WHERE page_id = ?"
      ),
      deletePage: this.db.prepare("DELETE FROM pages WHERE id = ?"),
      deletePages: this.db.prepare(
        `DELETE FROM pages 
         WHERE version_id IN (
           SELECT v.id FROM versions v
           JOIN libraries l ON v.library_id = l.id
           WHERE l.name = ? AND COALESCE(v.name, '') = COALESCE(?, '')
         )`
      ),
      getDocumentBySort: this.db.prepare(
        `SELECT d.id
         FROM documents d
         JOIN pages p ON d.page_id = p.id
         JOIN versions v ON p.version_id = v.id
         JOIN libraries l ON v.library_id = l.id
         WHERE l.name = ?
         AND COALESCE(v.name, '') = COALESCE(?, '')
         LIMIT 1`
      ),
      queryVersions: this.db.prepare(
        `SELECT DISTINCT v.name
         FROM versions v
         JOIN libraries l ON v.library_id = l.id
         WHERE l.name = ?
         ORDER BY v.name`
      ),
      checkExists: this.db.prepare(
        `SELECT d.id FROM documents d
         JOIN pages p ON d.page_id = p.id
         JOIN versions v ON p.version_id = v.id
         JOIN libraries l ON v.library_id = l.id
         WHERE l.name = ?
         AND COALESCE(v.name, '') = COALESCE(?, '')
         LIMIT 1`
      ),
      // Library/version aggregation including versions without documents and status/progress fields
      queryLibraryVersions: this.db.prepare(
        `SELECT
          l.name as library,
          COALESCE(v.name, '') as version,
          v.id as versionId,
          v.status as status,
          v.progress_pages as progressPages,
          v.progress_max_pages as progressMaxPages,
          v.source_url as sourceUrl,
          MIN(p.created_at) as indexedAt,
          COUNT(d.id) as documentCount,
          COUNT(DISTINCT p.url) as uniqueUrlCount
        FROM versions v
        JOIN libraries l ON v.library_id = l.id
        LEFT JOIN pages p ON p.version_id = v.id
        LEFT JOIN documents d ON d.page_id = p.id
        GROUP BY v.id
        ORDER BY l.name, version`
      ),
      getChildChunks: this.db.prepare(`
        SELECT d.id, d.page_id, d.content, json(d.metadata) as metadata, d.sort_order, d.embedding, d.created_at, p.url, p.title, p.content_type FROM documents d
        JOIN pages p ON d.page_id = p.id
        JOIN versions v ON p.version_id = v.id
        JOIN libraries l ON v.library_id = l.id
        WHERE l.name = ?
        AND COALESCE(v.name, '') = COALESCE(?, '')
        AND p.url = ?
        AND json_array_length(json_extract(d.metadata, '$.path')) = ?
        AND json_extract(d.metadata, '$.path') LIKE ? || '%'
        AND d.sort_order > (SELECT sort_order FROM documents WHERE id = ?)
        ORDER BY d.sort_order
        LIMIT ?
      `),
      getPrecedingSiblings: this.db.prepare(`
        SELECT d.id, d.page_id, d.content, json(d.metadata) as metadata, d.sort_order, d.embedding, d.created_at, p.url, p.title, p.content_type FROM documents d
        JOIN pages p ON d.page_id = p.id
        JOIN versions v ON p.version_id = v.id
        JOIN libraries l ON v.library_id = l.id
        WHERE l.name = ?
        AND COALESCE(v.name, '') = COALESCE(?, '')
        AND p.url = ?
        AND d.sort_order < (SELECT sort_order FROM documents WHERE id = ?)
        AND json_extract(d.metadata, '$.path') = ?
        ORDER BY d.sort_order DESC
        LIMIT ?
      `),
      getSubsequentSiblings: this.db.prepare(`
        SELECT d.id, d.page_id, d.content, json(d.metadata) as metadata, d.sort_order, d.embedding, d.created_at, p.url, p.title, p.content_type FROM documents d
        JOIN pages p ON d.page_id = p.id
        JOIN versions v ON p.version_id = v.id
        JOIN libraries l ON v.library_id = l.id
        WHERE l.name = ?
        AND COALESCE(v.name, '') = COALESCE(?, '')
        AND p.url = ?
        AND d.sort_order > (SELECT sort_order FROM documents WHERE id = ?)
        AND json_extract(d.metadata, '$.path') = ?
        ORDER BY d.sort_order
        LIMIT ?
      `),
      getParentChunk: this.db.prepare(`
        SELECT d.id, d.page_id, d.content, json(d.metadata) as metadata, d.sort_order, d.embedding, d.created_at, p.url, p.title, p.content_type FROM documents d
        JOIN pages p ON d.page_id = p.id
        JOIN versions v ON p.version_id = v.id
        JOIN libraries l ON v.library_id = l.id
        WHERE l.name = ?
        AND COALESCE(v.name, '') = COALESCE(?, '')
        AND p.url = ?
        AND json_extract(d.metadata, '$.path') = ?
        AND d.sort_order < (SELECT sort_order FROM documents WHERE id = ?)
        ORDER BY d.sort_order DESC
        LIMIT 1
      `),
      // Status tracking statements
      updateVersionStatus: this.db.prepare(
        "UPDATE versions SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ),
      updateVersionProgress: this.db.prepare(
        "UPDATE versions SET progress_pages = ?, progress_max_pages = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ),
      getVersionsByStatus: this.db.prepare(
        "SELECT v.*, l.name as library_name FROM versions v JOIN libraries l ON v.library_id = l.id WHERE v.status IN (SELECT value FROM json_each(?))"
      ),
      // Scraper options statements
      updateVersionScraperOptions: this.db.prepare(
        "UPDATE versions SET source_url = ?, scraper_options = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ),
      getVersionWithOptions: this.db.prepare(
        "SELECT * FROM versions WHERE id = ?"
      ),
      getVersionsBySourceUrl: this.db.prepare(
        "SELECT v.*, l.name as library_name FROM versions v JOIN libraries l ON v.library_id = l.id WHERE v.source_url = ? ORDER BY v.created_at DESC"
      ),
      // Version and library deletion statements
      deleteVersionById: this.db.prepare("DELETE FROM versions WHERE id = ?"),
      deleteLibraryById: this.db.prepare("DELETE FROM libraries WHERE id = ?"),
      countVersionsByLibraryId: this.db.prepare(
        "SELECT COUNT(*) as count FROM versions WHERE library_id = ?"
      ),
      getVersionId: this.db.prepare(
        `SELECT v.id, v.library_id FROM versions v
         JOIN libraries l ON v.library_id = l.id
         WHERE l.name = ? AND COALESCE(v.name, '') = COALESCE(?, '')`
      ),
      getPagesByVersionId: this.db.prepare(
        "SELECT * FROM pages WHERE version_id = ?"
      )
    };
    this.statements = statements;
  }
  /**
   * Pads a vector to the fixed database dimension by appending zeros.
   * Throws an error if the input vector is longer than the database dimension.
   */
  padVector(vector) {
    if (vector.length > this.dbDimension) {
      throw new Error(
        `Vector dimension ${vector.length} exceeds database dimension ${this.dbDimension}`
      );
    }
    if (vector.length === this.dbDimension) {
      return vector;
    }
    return [...vector, ...new Array(this.dbDimension - vector.length).fill(0)];
  }
  /**
   * Initialize the embeddings client using the provided config.
   * If no embedding config is provided (null or undefined), embeddings will not be initialized.
   * This allows DocumentStore to be used without embeddings for FTS-only operations.
   *
   * Environment variables per provider:
   * - openai: OPENAI_API_KEY (and optionally OPENAI_API_BASE, OPENAI_ORG_ID)
   * - vertex: GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON)
   * - gemini: GOOGLE_API_KEY
   * - aws: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
   * - microsoft: Azure OpenAI credentials (AZURE_OPENAI_API_*)
   */
  async initializeEmbeddings() {
    if (this.embeddingConfig === null || this.embeddingConfig === void 0) {
      logger.debug(
        "Embedding initialization skipped (no config provided - FTS-only mode)"
      );
      return;
    }
    const config = this.embeddingConfig;
    if (!areCredentialsAvailable(config.provider)) {
      logger.warn(
        `⚠️  No credentials found for ${config.provider} embedding provider. Vector search is disabled.
   Only full-text search will be available. To enable vector search, please configure the required
   environment variables for ${config.provider} or choose a different provider.
   See README.md for configuration options or run with --help for more details.`
      );
      return;
    }
    try {
      this.embeddings = createEmbeddingModel(config.modelSpec, {
        requestTimeoutMs: this.config.embeddings.requestTimeoutMs,
        vectorDimension: this.dbDimension
      });
      if (config.dimensions !== null) {
        this.modelDimension = config.dimensions;
      } else {
        const testPromise = this.embeddings.embedQuery("test");
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(
              new Error(
                `Embedding service connection timed out after ${this.embeddingInitTimeoutMs / 1e3} seconds`
              )
            );
          }, this.embeddingInitTimeoutMs);
        });
        try {
          const testVector = await Promise.race([testPromise, timeoutPromise]);
          this.modelDimension = testVector.length;
        } finally {
          if (timeoutId !== void 0) {
            clearTimeout(timeoutId);
          }
        }
        EmbeddingConfig.setKnownModelDimensions(config.model, this.modelDimension);
      }
      if (this.modelDimension > this.dbDimension) {
        throw new DimensionError(config.modelSpec, this.modelDimension, this.dbDimension);
      }
      this.isVectorSearchEnabled = true;
      logger.debug(
        `Embeddings initialized: ${config.provider}:${config.model} (${this.modelDimension}d)`
      );
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("does not exist") || error.message.includes("MODEL_NOT_FOUND")) {
          throw new ModelConfigurationError(
            `Invalid embedding model: ${config.model}
   The model "${config.model}" is not available or you don't have access to it.
   See README.md for supported models or run with --help for more details.`
          );
        }
        if (error.message.includes("API key") || error.message.includes("401") || error.message.includes("authentication")) {
          throw new ModelConfigurationError(
            `Authentication failed for ${config.provider} embedding provider
   Please check your API key configuration.
   See README.md for configuration options or run with --help for more details.`
          );
        }
        if (error.message.includes("timed out") || error.message.includes("ECONNREFUSED") || error.message.includes("ENOTFOUND") || error.message.includes("ETIMEDOUT") || error.message.includes("ECONNRESET") || error.message.includes("network") || error.message.includes("fetch failed")) {
          throw new ModelConfigurationError(
            `Failed to connect to ${config.provider} embedding service
   ${error.message}
   Please check that the embedding service is running and accessible.
   If using a local model (e.g., Ollama), ensure the service is started.`
          );
        }
      }
      throw error;
    }
  }
  /**
   * Generates a safe FTS query by tokenizing the input and escaping for FTS5.
   *
   * Strategy:
   * - Quotes toggle between "phrase mode" and "word mode" (simple state machine)
   * - Text inside quotes becomes a single phrase token
   * - Text outside quotes is split by whitespace into word tokens
   * - All tokens are escaped (double quotes -> "") and wrapped in quotes for safety
   *
   * This prevents FTS5 syntax errors while supporting intuitive phrase searches.
   *
   * Query construction:
   * - Exact match of full input: `("escaped full query")`
   * - Individual terms: `("term1" AND "term2" AND "phrase")`
   * - Combined: `("full query") OR ("term1" AND "term2")`
   *
   * Examples:
   * - `foo bar` -> `("foo bar") OR ("foo" AND "bar")`
   * - `"hello world"` -> `("hello world")`
   * - `test "exact phrase" word` -> `("test exact phrase word") OR ("test" AND "exact phrase" AND "word")`
   */
  escapeFtsQuery(query) {
    const tokens = [];
    let currentToken = "";
    let inQuote = false;
    for (let i = 0; i < query.length; i++) {
      const char = query[i];
      if (char === '"') {
        if (inQuote) {
          if (currentToken.length > 0) {
            tokens.push(currentToken);
            currentToken = "";
          }
          inQuote = false;
        } else {
          if (currentToken.length > 0) {
            tokens.push(currentToken);
            currentToken = "";
          }
          inQuote = true;
        }
      } else if (char === " " && !inQuote) {
        if (currentToken.length > 0) {
          tokens.push(currentToken);
          currentToken = "";
        }
      } else {
        currentToken += char;
      }
    }
    if (currentToken.length > 0) {
      tokens.push(currentToken);
    }
    if (tokens.length === 0) {
      return '""';
    }
    const escapedTokens = tokens.map((token) => {
      const escaped = token.replace(/"/g, '""');
      return `"${escaped}"`;
    });
    if (escapedTokens.length === 1) {
      return escapedTokens[0];
    }
    const exactMatch = `"${tokens.join(" ").replace(/"/g, '""')}"`;
    const termsQuery = escapedTokens.join(" OR ");
    return `${exactMatch} OR ${termsQuery}`;
  }
  /**
   * Initializes database connection and ensures readiness
   */
  async initialize() {
    try {
      sqliteVec.load(this.db);
      await applyMigrations(this.db, {
        maxRetries: this.config.db.migrationMaxRetries,
        retryDelayMs: this.config.db.migrationRetryDelayMs
      });
      this.prepareStatements();
      await this.initializeEmbeddings();
    } catch (error) {
      if (error instanceof StoreError || error instanceof ModelConfigurationError || error instanceof UnsupportedProviderError) {
        throw error;
      }
      throw new ConnectionError("Failed to initialize database connection", error);
    }
  }
  /**
   * Gracefully closes database connections
   */
  async shutdown() {
    this.db.close();
  }
  /**
   * Resolves a library name and version string to version_id.
   * Creates library and version records if they don't exist.
   */
  async resolveVersionId(library, version) {
    const normalizedLibrary = library.toLowerCase();
    const normalizedVersion = denormalizeVersionName(version.toLowerCase());
    this.statements.insertLibrary.run(normalizedLibrary);
    const libraryIdRow = this.statements.getLibraryIdByName.get(normalizedLibrary);
    if (!libraryIdRow || typeof libraryIdRow.id !== "number") {
      throw new StoreError(`Failed to resolve library_id for library: ${library}`);
    }
    const libraryId = libraryIdRow.id;
    this.statements.insertVersion.run(libraryId, normalizedVersion);
    const versionIdRow = this.statements.resolveVersionId.get(
      libraryId,
      normalizedVersion
    );
    if (!versionIdRow || typeof versionIdRow.id !== "number") {
      throw new StoreError(
        `Failed to resolve version_id for library: ${library}, version: ${version}`
      );
    }
    return versionIdRow.id;
  }
  /**
   * Retrieves all unique versions for a specific library
   */
  async queryUniqueVersions(library) {
    try {
      const rows = this.statements.queryVersions.all(library.toLowerCase());
      return rows.map((row) => normalizeVersionName(row.name));
    } catch (error) {
      throw new ConnectionError("Failed to query versions", error);
    }
  }
  /**
   * Updates the status of a version record in the database.
   * @param versionId The version ID to update
   * @param status The new status to set
   * @param errorMessage Optional error message for failed statuses
   */
  async updateVersionStatus(versionId, status, errorMessage) {
    try {
      this.statements.updateVersionStatus.run(status, errorMessage ?? null, versionId);
    } catch (error) {
      throw new StoreError(`Failed to update version status: ${error}`);
    }
  }
  /**
   * Updates the progress counters for a version being indexed.
   * @param versionId The version ID to update
   * @param pages Current number of pages processed
   * @param maxPages Total number of pages to process
   */
  async updateVersionProgress(versionId, pages, maxPages) {
    try {
      this.statements.updateVersionProgress.run(pages, maxPages, versionId);
    } catch (error) {
      throw new StoreError(`Failed to update version progress: ${error}`);
    }
  }
  /**
   * Retrieves versions by their status.
   * @param statuses Array of statuses to filter by
   * @returns Array of version records matching the statuses
   */
  async getVersionsByStatus(statuses) {
    try {
      const statusJson = JSON.stringify(statuses);
      const rows = this.statements.getVersionsByStatus.all(
        statusJson
      );
      return rows;
    } catch (error) {
      throw new StoreError(`Failed to get versions by status: ${error}`);
    }
  }
  /**
   * Retrieves a version by its ID.
   * @param versionId The version ID to retrieve
   * @returns The version record, or null if not found
   */
  async getVersionById(versionId) {
    try {
      const row = this.statements.getVersionById.get(versionId);
      return row || null;
    } catch (error) {
      throw new StoreError(`Failed to get version by ID: ${error}`);
    }
  }
  /**
   * Retrieves a library by its ID.
   * @param libraryId The library ID to retrieve
   * @returns The library record, or null if not found
   */
  async getLibraryById(libraryId) {
    try {
      const row = this.statements.getLibraryById.get(libraryId);
      return row || null;
    } catch (error) {
      throw new StoreError(`Failed to get library by ID: ${error}`);
    }
  }
  /**
   * Retrieves a library by its name.
   * @param name The library name to retrieve
   * @returns The library record, or null if not found
   */
  async getLibrary(name) {
    try {
      const normalizedName = name.toLowerCase();
      const row = this.statements.getLibraryIdByName.get(normalizedName);
      if (!row) {
        return null;
      }
      return { id: row.id, name: normalizedName };
    } catch (error) {
      throw new StoreError(`Failed to get library by name: ${error}`);
    }
  }
  /**
   * Deletes a library by its ID.
   * This should only be called when the library has no remaining versions.
   * @param libraryId The library ID to delete
   */
  async deleteLibrary(libraryId) {
    try {
      this.statements.deleteLibraryById.run(libraryId);
    } catch (error) {
      throw new StoreError(`Failed to delete library: ${error}`);
    }
  }
  /**
   * Stores scraper options for a version to enable reproducible indexing.
   * @param versionId The version ID to update
   * @param options Complete scraper options used for indexing
   */
  async storeScraperOptions(versionId, options) {
    try {
      const {
        url: source_url,
        library: _library,
        version: _version,
        signal: _signal,
        initialQueue: _initialQueue,
        isRefresh: _isRefresh,
        ...scraper_options
      } = options;
      const optionsJson = JSON.stringify(scraper_options);
      this.statements.updateVersionScraperOptions.run(source_url, optionsJson, versionId);
    } catch (error) {
      throw new StoreError(`Failed to store scraper options: ${error}`);
    }
  }
  /**
   * Retrieves stored scraping configuration (source URL and options) for a version.
   * Returns null when no source URL is recorded (not re-indexable).
   */
  async getScraperOptions(versionId) {
    try {
      const row = this.statements.getVersionWithOptions.get(versionId);
      if (!row?.source_url) {
        return null;
      }
      let parsed = {};
      if (row.scraper_options) {
        try {
          parsed = JSON.parse(row.scraper_options);
        } catch (e) {
          logger.warn(`⚠️  Invalid scraper_options JSON for version ${versionId}: ${e}`);
          parsed = {};
        }
      }
      return { sourceUrl: row.source_url, options: parsed };
    } catch (error) {
      throw new StoreError(`Failed to get scraper options: ${error}`);
    }
  }
  /**
   * Finds versions that were indexed from the same source URL.
   * Useful for finding similar configurations or detecting duplicates.
   * @param url Source URL to search for
   * @returns Array of versions with the same source URL
   */
  async findVersionsBySourceUrl(url) {
    try {
      const rows = this.statements.getVersionsBySourceUrl.all(
        url
      );
      return rows;
    } catch (error) {
      throw new StoreError(`Failed to find versions by source URL: ${error}`);
    }
  }
  /**
   * Verifies existence of documents for a specific library version
   */
  async checkDocumentExists(library, version) {
    try {
      const normalizedVersion = version.toLowerCase();
      const result = this.statements.checkExists.get(
        library.toLowerCase(),
        normalizedVersion
      );
      return result !== void 0;
    } catch (error) {
      throw new ConnectionError("Failed to check document existence", error);
    }
  }
  /**
   * Retrieves a mapping of all libraries to their available versions with details.
   */
  async queryLibraryVersions() {
    try {
      const rows = this.statements.queryLibraryVersions.all();
      const libraryMap = /* @__PURE__ */ new Map();
      for (const row of rows) {
        const library = row.library;
        if (!libraryMap.has(library)) {
          libraryMap.set(library, []);
        }
        const indexedAtISO = row.indexedAt ? new Date(row.indexedAt).toISOString() : null;
        libraryMap.get(library)?.push({
          version: row.version,
          versionId: row.versionId,
          // Preserve raw string status here; DocumentManagementService will cast to VersionStatus
          status: row.status,
          progressPages: row.progressPages,
          progressMaxPages: row.progressMaxPages,
          sourceUrl: row.sourceUrl,
          documentCount: row.documentCount,
          uniqueUrlCount: row.uniqueUrlCount,
          indexedAt: indexedAtISO
        });
      }
      for (const versions of libraryMap.values()) {
        versions.sort((a, b) => compareVersionsDescending(a.version, b.version));
      }
      return libraryMap;
    } catch (error) {
      throw new ConnectionError("Failed to query library versions", error);
    }
  }
  /**
   * Helper method to detect if an error is related to input size limits.
   * Checks for common error messages from various embedding providers.
   */
  isInputSizeError(error) {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return message.includes("maximum context length") || message.includes("too long") || message.includes("token limit") || message.includes("input is too large") || message.includes("exceeds") || message.includes("max") && message.includes("token");
  }
  /**
   * Creates embeddings for an array of texts with automatic retry logic for size-related errors.
   * If a batch fails due to size limits:
   * - Batches with multiple texts are split in half and retried recursively
   * - Single texts that are too large are truncated and retried once
   *
   * @param texts Array of texts to embed
   * @param isRetry Internal flag to prevent duplicate warning logs
   * @returns Array of embedding vectors
   */
  async embedDocumentsWithRetry(texts, isRetry = false) {
    if (texts.length === 0) {
      return [];
    }
    try {
      return await this.embeddings.embedDocuments(texts);
    } catch (error) {
      if (this.isInputSizeError(error)) {
        if (texts.length > 1) {
          const midpoint = Math.floor(texts.length / 2);
          const firstHalf = texts.slice(0, midpoint);
          const secondHalf = texts.slice(midpoint);
          if (!isRetry) {
            logger.warn(
              `⚠️  Batch of ${texts.length} texts exceeded size limit, splitting into ${firstHalf.length} + ${secondHalf.length}`
            );
          }
          const [firstEmbeddings, secondEmbeddings] = await Promise.all([
            this.embedDocumentsWithRetry(firstHalf, true),
            this.embedDocumentsWithRetry(secondHalf, true)
          ]);
          return [...firstEmbeddings, ...secondEmbeddings];
        } else {
          const text = texts[0];
          const midpoint = Math.floor(text.length / 2);
          const firstHalf = text.substring(0, midpoint);
          if (!isRetry) {
            logger.warn(
              `⚠️  Single text exceeded embedding size limit (${text.length} chars).`
            );
          }
          try {
            const embedding = await this.embedDocumentsWithRetry([firstHalf], true);
            return embedding;
          } catch (retryError) {
            logger.error(
              `❌ Failed to embed even after splitting. Original length: ${text.length}`
            );
            throw retryError;
          }
        }
      }
      throw error;
    }
  }
  /**
   * Stores documents with library and version metadata, generating embeddings
   * for vector similarity search. Uses the new pages table to normalize page-level
   * metadata and avoid duplication across document chunks.
   */
  async addDocuments(library, version, depth, result) {
    try {
      const { title, url, chunks } = result;
      if (chunks.length === 0) {
        return;
      }
      let paddedEmbeddings = [];
      if (this.isVectorSearchEnabled) {
        const texts = chunks.map((chunk) => {
          const header = `<title>${title}</title>
<url>${url}</url>
<path>${(chunk.section.path || []).join(" / ")}</path>
`;
          return `${header}${chunk.content}`;
        });
        for (let i = 0; i < texts.length; i++) {
          const textSize = texts[i].length;
          if (textSize > this.splitterMaxChunkSize) {
            logger.warn(
              `⚠️  Chunk ${i + 1}/${texts.length} exceeds max size: ${textSize} > ${this.splitterMaxChunkSize} chars (URL: ${url})`
            );
          }
        }
        const maxBatchChars = this.embeddingBatchChars;
        const rawEmbeddings = [];
        let currentBatch = [];
        let currentBatchSize = 0;
        let batchCount = 0;
        for (const text of texts) {
          const textSize = text.length;
          if (currentBatchSize + textSize > maxBatchChars && currentBatch.length > 0) {
            batchCount++;
            logger.debug(
              `Processing embedding batch ${batchCount}: ${currentBatch.length} texts, ${currentBatchSize} chars`
            );
            const batchEmbeddings = await this.embedDocumentsWithRetry(currentBatch);
            rawEmbeddings.push(...batchEmbeddings);
            currentBatch = [];
            currentBatchSize = 0;
          }
          currentBatch.push(text);
          currentBatchSize += textSize;
          if (currentBatch.length >= this.embeddingBatchSize) {
            batchCount++;
            logger.debug(
              `Processing embedding batch ${batchCount}: ${currentBatch.length} texts, ${currentBatchSize} chars`
            );
            const batchEmbeddings = await this.embedDocumentsWithRetry(currentBatch);
            rawEmbeddings.push(...batchEmbeddings);
            currentBatch = [];
            currentBatchSize = 0;
          }
        }
        if (currentBatch.length > 0) {
          batchCount++;
          logger.debug(
            `Processing final embedding batch ${batchCount}: ${currentBatch.length} texts, ${currentBatchSize} chars`
          );
          const batchEmbeddings = await this.embedDocumentsWithRetry(currentBatch);
          rawEmbeddings.push(...batchEmbeddings);
        }
        paddedEmbeddings = rawEmbeddings.map((vector) => this.padVector(vector));
      }
      const versionId = await this.resolveVersionId(library, version);
      const existingPage = this.statements.getPageId.get(versionId, url);
      if (existingPage) {
        const result2 = this.statements.deleteDocumentsByPageId.run(existingPage.id);
        if (result2.changes > 0) {
          logger.debug(`Deleted ${result2.changes} existing documents for URL: ${url}`);
        }
      }
      const transaction = this.db.transaction(() => {
        const contentType = result.contentType || null;
        const etag = result.etag || null;
        const lastModified = result.lastModified || null;
        this.statements.insertPage.run(
          versionId,
          url,
          title || "",
          etag,
          lastModified,
          contentType,
          depth
        );
        const existingPage2 = this.statements.getPageId.get(versionId, url);
        if (!existingPage2) {
          throw new StoreError(`Failed to get page ID for URL: ${url}`);
        }
        const pageId = existingPage2.id;
        let docIndex = 0;
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const result2 = this.statements.insertDocument.run(
            pageId,
            chunk.content,
            JSON.stringify({
              types: chunk.types,
              level: chunk.section.level,
              path: chunk.section.path
            }),
            i
            // sort_order within this page
          );
          const rowId = result2.lastInsertRowid;
          if (this.isVectorSearchEnabled && paddedEmbeddings.length > 0) {
            this.statements.insertEmbedding.run(
              JSON.stringify(paddedEmbeddings[docIndex]),
              BigInt(rowId)
            );
          }
          docIndex++;
        }
      });
      transaction();
    } catch (error) {
      throw new ConnectionError("Failed to add documents to store", error);
    }
  }
  /**
   * Removes documents and pages matching specified library and version.
   * This consolidated method deletes both documents and their associated pages.
   * @returns Number of documents deleted
   */
  async deletePages(library, version) {
    try {
      const normalizedVersion = version.toLowerCase();
      const result = this.statements.deleteDocuments.run(
        library.toLowerCase(),
        normalizedVersion
      );
      this.statements.deletePages.run(library.toLowerCase(), normalizedVersion);
      return result.changes;
    } catch (error) {
      throw new ConnectionError("Failed to delete documents", error);
    }
  }
  /**
   * Deletes a page and all its associated document chunks.
   * Performs manual deletion in the correct order to satisfy foreign key constraints:
   * 1. Delete document chunks (page_id references pages.id)
   * 2. Delete page record
   *
   * This method is used during refresh operations when a page returns 404 Not Found.
   */
  async deletePage(pageId) {
    try {
      const docResult = this.statements.deleteDocumentsByPageId.run(pageId);
      logger.debug(`Deleted ${docResult.changes} document(s) for page ID ${pageId}`);
      const pageResult = this.statements.deletePage.run(pageId);
      if (pageResult.changes > 0) {
        logger.debug(`Deleted page record for page ID ${pageId}`);
      }
    } catch (error) {
      throw new ConnectionError(`Failed to delete page ${pageId}`, error);
    }
  }
  /**
   * Retrieves all pages for a specific version ID with their metadata.
   * Used for refresh operations to get existing pages with their ETags and depths.
   * @returns Array of page records
   */
  async getPagesByVersionId(versionId) {
    try {
      const result = this.statements.getPagesByVersionId.all(versionId);
      return result;
    } catch (error) {
      throw new ConnectionError("Failed to get pages by version ID", error);
    }
  }
  /**
   * Completely removes a library version and all associated documents.
   * Optionally removes the library if no other versions remain.
   * @param library Library name
   * @param version Version string (empty string for unversioned)
   * @param removeLibraryIfEmpty Whether to remove the library if no versions remain
   * @returns Object with counts of deleted documents, version deletion status, and library deletion status
   */
  async removeVersion(library, version, removeLibraryIfEmpty = true) {
    try {
      const normalizedLibrary = library.toLowerCase();
      const normalizedVersion = version.toLowerCase();
      const versionResult = this.statements.getVersionId.get(
        normalizedLibrary,
        normalizedVersion
      );
      if (!versionResult) {
        return { documentsDeleted: 0, versionDeleted: false, libraryDeleted: false };
      }
      const { id: versionId, library_id: libraryId } = versionResult;
      const documentsDeleted = await this.deletePages(library, version);
      this.statements.deletePages.run(normalizedLibrary, normalizedVersion);
      const versionDeleteResult = this.statements.deleteVersionById.run(versionId);
      const versionDeleted = versionDeleteResult.changes > 0;
      let libraryDeleted = false;
      if (removeLibraryIfEmpty && versionDeleted) {
        const countResult = this.statements.countVersionsByLibraryId.get(libraryId);
        const remainingVersions = countResult?.count ?? 0;
        if (remainingVersions === 0) {
          const libraryDeleteResult = this.statements.deleteLibraryById.run(libraryId);
          libraryDeleted = libraryDeleteResult.changes > 0;
        }
      }
      return { documentsDeleted, versionDeleted, libraryDeleted };
    } catch (error) {
      throw new ConnectionError("Failed to remove version", error);
    }
  }
  /**
   * Parses the metadata field from a JSON string to an object.
   * This is necessary because better-sqlite3's json() function returns a string, not an object.
   */
  parseMetadata(row) {
    if (row.metadata && typeof row.metadata === "string") {
      try {
        row.metadata = JSON.parse(row.metadata);
      } catch (error) {
        logger.warn(`Failed to parse metadata JSON: ${error}`);
        row.metadata = {};
      }
    }
    return row;
  }
  /**
   * Parses metadata for an array of rows.
   */
  parseMetadataArray(rows) {
    return rows.map((row) => this.parseMetadata(row));
  }
  /**
   * Retrieves a document by its ID.
   * @param id The ID of the document.
   * @returns The document, or null if not found.
   */
  async getById(id) {
    try {
      const row = this.statements.getById.get(BigInt(id));
      if (!row) {
        return null;
      }
      return this.parseMetadata(row);
    } catch (error) {
      throw new ConnectionError(`Failed to get document by ID ${id}`, error);
    }
  }
  /**
   * Finds documents matching a text query using hybrid search when vector search is enabled,
   * or falls back to full-text search only when vector search is disabled.
   * Uses Reciprocal Rank Fusion for hybrid search or simple FTS ranking for fallback mode.
   */
  async findByContent(library, version, query, limit) {
    try {
      if (!query || typeof query !== "string" || query.trim().length === 0) {
        return [];
      }
      const ftsQuery = this.escapeFtsQuery(query);
      const normalizedVersion = version.toLowerCase();
      if (this.isVectorSearchEnabled) {
        const rawEmbedding = await this.embeddings.embedQuery(query);
        const embedding = this.padVector(rawEmbedding);
        const overfetchLimit = Math.max(1, limit * this.searchOverfetchFactor);
        const vectorSearchK = overfetchLimit * this.vectorSearchMultiplier;
        const stmt = this.db.prepare(`
          WITH vec_distances AS (
            SELECT
              dv.rowid as id,
              dv.distance as vec_distance
            FROM documents_vec dv
            JOIN documents d ON dv.rowid = d.id
            JOIN pages p ON d.page_id = p.id
            JOIN versions v ON p.version_id = v.id
            JOIN libraries l ON v.library_id = l.id
            WHERE l.name = ?
              AND COALESCE(v.name, '') = COALESCE(?, '')
              AND dv.embedding MATCH ?
              AND dv.k = ?
            ORDER BY dv.distance
          ),
          fts_scores AS (
            SELECT
              f.rowid as id,
              bm25(documents_fts, 10.0, 1.0, 5.0, 1.0) as fts_score
            FROM documents_fts f
            JOIN documents d ON f.rowid = d.id
            JOIN pages p ON d.page_id = p.id
            JOIN versions v ON p.version_id = v.id
            JOIN libraries l ON v.library_id = l.id
            WHERE l.name = ?
              AND COALESCE(v.name, '') = COALESCE(?, '')
              AND documents_fts MATCH ?
            ORDER BY fts_score
            LIMIT ?
          )
          SELECT
            d.id,
            d.content,
            d.metadata,
            p.url as url,
            p.title as title,
            p.content_type as content_type,
            COALESCE(1 / (1 + v.vec_distance), 0) as vec_score,
            COALESCE(-MIN(f.fts_score, 0), 0) as fts_score
          FROM documents d
          JOIN pages p ON d.page_id = p.id
          LEFT JOIN vec_distances v ON d.id = v.id
          LEFT JOIN fts_scores f ON d.id = f.id
          WHERE (v.id IS NOT NULL OR f.id IS NOT NULL)
            AND NOT EXISTS (
              SELECT 1 FROM json_each(json_extract(d.metadata, '$.types')) je
              WHERE je.value = 'structural'
            )
        `);
        const rawResults = stmt.all(
          library.toLowerCase(),
          normalizedVersion,
          JSON.stringify(embedding),
          vectorSearchK,
          library.toLowerCase(),
          normalizedVersion,
          ftsQuery,
          overfetchLimit
        );
        const rankedResults = this.assignRanks(rawResults);
        const topResults = rankedResults.sort((a, b) => b.rrf_score - a.rrf_score).slice(0, limit);
        return topResults.map((row) => {
          const result = {
            ...row,
            url: row.url || "",
            // Ensure url is never undefined
            title: row.title || null,
            content_type: row.content_type || null
          };
          return Object.assign(result, {
            score: row.rrf_score,
            vec_rank: row.vec_rank,
            fts_rank: row.fts_rank
          });
        });
      } else {
        const stmt = this.db.prepare(`
          SELECT
            d.id,
            d.content,
            d.metadata,
            p.url as url,
            p.title as title,
            p.content_type as content_type,
            bm25(documents_fts, 10.0, 1.0, 5.0, 1.0) as fts_score
          FROM documents_fts f
          JOIN documents d ON f.rowid = d.id
          JOIN pages p ON d.page_id = p.id
          JOIN versions v ON p.version_id = v.id
          JOIN libraries l ON v.library_id = l.id
          WHERE l.name = ?
            AND COALESCE(v.name, '') = COALESCE(?, '')
            AND documents_fts MATCH ?
            AND NOT EXISTS (
              SELECT 1 FROM json_each(json_extract(d.metadata, '$.types')) je
              WHERE je.value = 'structural'
            )
          ORDER BY fts_score
          LIMIT ?
        `);
        const rawResults = stmt.all(
          library.toLowerCase(),
          normalizedVersion,
          ftsQuery,
          limit
        );
        return rawResults.map((row, index) => {
          const result = {
            ...row,
            url: row.url || "",
            // Ensure url is never undefined
            title: row.title || null,
            content_type: row.content_type || null
          };
          return Object.assign(result, {
            score: -row.fts_score,
            // Convert BM25 score to positive value for consistency
            fts_rank: index + 1
            // Assign rank based on order (1-based)
          });
        });
      }
    } catch (error) {
      throw new ConnectionError(
        `Failed to find documents by content with query "${query}"`,
        error
      );
    }
  }
  /**
   * Finds child chunks of a given document based on path hierarchy.
   */
  async findChildChunks(library, version, id, limit) {
    try {
      const parent = await this.getById(id);
      if (!parent) {
        return [];
      }
      const parentPath = parent.metadata.path ?? [];
      const normalizedVersion = version.toLowerCase();
      const result = this.statements.getChildChunks.all(
        library.toLowerCase(),
        normalizedVersion,
        parent.url,
        parentPath.length + 1,
        JSON.stringify(parentPath),
        BigInt(id),
        limit
      );
      return this.parseMetadataArray(result);
    } catch (error) {
      throw new ConnectionError(`Failed to find child chunks for ID ${id}`, error);
    }
  }
  /**
   * Finds preceding sibling chunks of a given document.
   */
  async findPrecedingSiblingChunks(library, version, id, limit) {
    try {
      const reference = await this.getById(id);
      if (!reference) {
        return [];
      }
      const normalizedVersion = version.toLowerCase();
      const result = this.statements.getPrecedingSiblings.all(
        library.toLowerCase(),
        normalizedVersion,
        reference.url,
        BigInt(id),
        JSON.stringify(reference.metadata.path),
        limit
      );
      return this.parseMetadataArray(result).reverse();
    } catch (error) {
      throw new ConnectionError(
        `Failed to find preceding sibling chunks for ID ${id}`,
        error
      );
    }
  }
  /**
   * Finds subsequent sibling chunks of a given document.
   */
  async findSubsequentSiblingChunks(library, version, id, limit) {
    try {
      const reference = await this.getById(id);
      if (!reference) {
        return [];
      }
      const normalizedVersion = version.toLowerCase();
      const result = this.statements.getSubsequentSiblings.all(
        library.toLowerCase(),
        normalizedVersion,
        reference.url,
        BigInt(id),
        JSON.stringify(reference.metadata.path),
        limit
      );
      return this.parseMetadataArray(result);
    } catch (error) {
      throw new ConnectionError(
        `Failed to find subsequent sibling chunks for ID ${id}`,
        error
      );
    }
  }
  /**
   * Finds the parent chunk of a given document.
   * Returns null if no parent is found or if there's a database error.
   * Database errors are logged but not thrown to maintain consistent behavior.
   */
  async findParentChunk(library, version, id) {
    try {
      const child = await this.getById(id);
      if (!child) {
        return null;
      }
      const path2 = child.metadata.path ?? [];
      const parentPath = path2.slice(0, -1);
      if (parentPath.length === 0) {
        return null;
      }
      const normalizedVersion = version.toLowerCase();
      const result = this.statements.getParentChunk.get(
        library.toLowerCase(),
        normalizedVersion,
        child.url,
        JSON.stringify(parentPath),
        BigInt(id)
      );
      if (!result) {
        return null;
      }
      return this.parseMetadata(result);
    } catch (error) {
      logger.warn(`Failed to find parent chunk for ID ${id}: ${error}`);
      return null;
    }
  }
  /**
   * Fetches multiple documents by their IDs in a single call.
   * Returns an array of DbPageChunk objects, sorted by their sort_order.
   */
  async findChunksByIds(library, version, ids) {
    if (!ids.length) return [];
    try {
      const normalizedVersion = version.toLowerCase();
      const placeholders = ids.map(() => "?").join(",");
      const stmt = this.db.prepare(
        `SELECT d.id, d.page_id, d.content, json(d.metadata) as metadata, d.sort_order, d.embedding, d.created_at, p.url, p.title, p.content_type FROM documents d
         JOIN pages p ON d.page_id = p.id
         JOIN versions v ON p.version_id = v.id
         JOIN libraries l ON v.library_id = l.id
         WHERE l.name = ? 
           AND COALESCE(v.name, '') = COALESCE(?, '')
           AND d.id IN (${placeholders}) 
         ORDER BY d.sort_order`
      );
      const rows = stmt.all(
        library.toLowerCase(),
        normalizedVersion,
        ...ids
      );
      return this.parseMetadataArray(rows);
    } catch (error) {
      throw new ConnectionError("Failed to fetch documents by IDs", error);
    }
  }
  /**
   * Fetches all document chunks for a specific URL within a library and version.
   * Returns DbPageChunk objects sorted by their sort_order for proper reassembly.
   */
  async findChunksByUrl(library, version, url) {
    try {
      const normalizedVersion = version.toLowerCase();
      const stmt = this.db.prepare(
        `SELECT d.id, d.page_id, d.content, json(d.metadata) as metadata, d.sort_order, d.embedding, d.created_at, p.url, p.title, p.content_type FROM documents d
         JOIN pages p ON d.page_id = p.id
         JOIN versions v ON p.version_id = v.id
         JOIN libraries l ON v.library_id = l.id
         WHERE l.name = ? 
           AND COALESCE(v.name, '') = COALESCE(?, '')
           AND p.url = ?
         ORDER BY d.sort_order`
      );
      const rows = stmt.all(
        library.toLowerCase(),
        normalizedVersion,
        url
      );
      return this.parseMetadataArray(rows);
    } catch (error) {
      throw new ConnectionError(`Failed to fetch documents by URL ${url}`, error);
    }
  }
}
class DocumentManagementService {
  appConfig;
  store;
  documentRetriever;
  pipelines;
  eventBus;
  constructor(eventBus, appConfig) {
    this.appConfig = appConfig;
    this.eventBus = eventBus;
    const storePath = this.appConfig.app.storePath;
    if (!storePath) {
      throw new Error("storePath is required when not using a remote server");
    }
    const dbPath = storePath === ":memory:" ? ":memory:" : path.join(storePath, "documents.db");
    logger.debug(`Using database path: ${dbPath}`);
    this.store = new DocumentStore(dbPath, this.appConfig);
    this.documentRetriever = new DocumentRetrieverService(this.store, this.appConfig);
    this.pipelines = PipelineFactory$1.createStandardPipelines(this.appConfig);
  }
  /**
   * Returns the active embedding configuration if vector search is enabled,
   * or null if embeddings are disabled.
   */
  getActiveEmbeddingConfig() {
    return this.store.getActiveEmbeddingConfig();
  }
  /**
   * Normalizes a version string, converting null or undefined to an empty string
   * and converting to lowercase.
   */
  normalizeVersion(version) {
    return (version ?? "").toLowerCase();
  }
  /**
   * Initializes the underlying document store.
   */
  async initialize() {
    await this.store.initialize();
  }
  /**
   * Shuts down the underlying document store and cleans up pipeline resources.
   */
  async shutdown() {
    logger.debug("Shutting down store manager");
    await Promise.allSettled(this.pipelines.map((pipeline) => pipeline.close()));
    await this.store.shutdown();
  }
  // Status tracking methods for pipeline integration
  /**
   * Gets versions by their current status.
   */
  async getVersionsByStatus(statuses) {
    return this.store.getVersionsByStatus(statuses);
  }
  /**
   * Updates the status of a version.
   */
  async updateVersionStatus(versionId, status, errorMessage) {
    return this.store.updateVersionStatus(versionId, status, errorMessage);
  }
  /**
   * Updates the progress of a version being indexed.
   */
  async updateVersionProgress(versionId, pages, maxPages) {
    return this.store.updateVersionProgress(versionId, pages, maxPages);
  }
  /**
   * Stores scraper options for a version to enable reproducible indexing.
   */
  async storeScraperOptions(versionId, options) {
    return this.store.storeScraperOptions(versionId, options);
  }
  /**
   * Retrieves stored scraper options for a version.
   */
  /**
   * Retrieves stored scraping configuration for a version.
   */
  async getScraperOptions(versionId) {
    return this.store.getScraperOptions(versionId);
  }
  /**
   * Ensures a library/version exists using a VersionRef and returns version ID.
   * Delegates to existing ensureLibraryAndVersion for storage.
   */
  async ensureVersion(ref) {
    const normalized = {
      library: ref.library.trim().toLowerCase(),
      version: (ref.version ?? "").trim().toLowerCase()
    };
    return this.ensureLibraryAndVersion(normalized.library, normalized.version);
  }
  /**
   * Returns enriched library summaries including version status/progress and counts.
   * Uses existing store APIs; keeps DB details encapsulated.
   */
  async listLibraries() {
    const libMap = await this.store.queryLibraryVersions();
    const summaries = [];
    for (const [library, versions] of libMap) {
      const vs = versions.map(
        (v) => ({
          id: v.versionId,
          ref: { library, version: v.version },
          status: v.status,
          // Include progress only while indexing is active; set undefined for COMPLETED
          progress: v.status === "completed" ? void 0 : { pages: v.progressPages, maxPages: v.progressMaxPages },
          counts: { documents: v.documentCount, uniqueUrls: v.uniqueUrlCount },
          indexedAt: v.indexedAt,
          sourceUrl: v.sourceUrl ?? void 0
        })
      );
      summaries.push({ library, versions: vs });
    }
    return summaries;
  }
  /**
   * Finds versions that were indexed from the same source URL.
   */
  async findVersionsBySourceUrl(url) {
    return this.store.findVersionsBySourceUrl(url);
  }
  /**
   * Validates if a library exists in the store.
   * Checks if the library record exists in the database, regardless of whether it has versions or documents.
   * Throws LibraryNotFoundInStoreError with suggestions if the library is not found.
   * @param library The name of the library to validate.
   * @throws {LibraryNotFoundInStoreError} If the library does not exist.
   */
  async validateLibraryExists(library) {
    logger.info(`🔎 Validating existence of library: ${library}`);
    const libraryRecord = await this.store.getLibrary(library);
    if (!libraryRecord) {
      logger.warn(`⚠️  Library '${library}' not found.`);
      const allLibraries = await this.listLibraries();
      const libraryNames = allLibraries.map((lib) => lib.library);
      let suggestions = [];
      if (libraryNames.length > 0) {
        const fuse = new Fuse(libraryNames, {
          threshold: 0.7
          // Adjust threshold for desired fuzziness (0=exact, 1=match anything)
        });
        const results = fuse.search(library.toLowerCase());
        suggestions = results.slice(0, 3).map((result) => result.item);
        logger.info(`🔍 Found suggestions: ${suggestions.join(", ")}`);
      }
      throw new LibraryNotFoundInStoreError(library, suggestions);
    }
    logger.info(`✅ Library '${library}' confirmed to exist.`);
  }
  /**
   * Returns a list of all available semantic versions for a library.
   * Sorted in descending order (latest first).
   */
  async listVersions(library) {
    const versions = await this.store.queryUniqueVersions(library);
    const validVersions = versions.filter((v) => semver__default.valid(v));
    return sortVersionsDescending(validVersions);
  }
  /**
   * Checks if documents exist for a given library and optional version.
   * If version is omitted, checks for documents without a specific version.
   */
  async exists(library, version) {
    const normalizedVersion = this.normalizeVersion(version);
    return this.store.checkDocumentExists(library, normalizedVersion);
  }
  /**
   * Finds the most appropriate version of documentation based on the requested version.
   * When no target version is specified, returns the latest version.
   *
   * Version matching behavior:
   * - Exact versions (e.g., "18.0.0"): Matches that version or any earlier version
   * - X-Range patterns (e.g., "5.x", "5.2.x"): Matches within the specified range
   * - "latest" or no version: Returns the latest available version
   *
   * For documentation, we prefer matching older versions over no match at all,
   * since older docs are often still relevant and useful.
   * Also checks if unversioned documents exist for the library.
   */
  async findBestVersion(library, targetVersion) {
    const libraryAndVersion = `${library}${targetVersion ? `@${targetVersion}` : ""}`;
    logger.info(`🔍 Finding best version for ${libraryAndVersion}`);
    const hasUnversioned = await this.store.checkDocumentExists(library, "");
    const versionStrings = await this.listVersions(library);
    if (versionStrings.length === 0) {
      if (hasUnversioned) {
        logger.info(`ℹ️ Unversioned documents exist for ${library}`);
        return { bestMatch: null, hasUnversioned: true };
      }
      logger.warn(`⚠️  No valid versions found for ${library}`);
      await this.validateLibraryExists(library);
      throw new LibraryNotFoundInStoreError(library, []);
    }
    let bestMatch = null;
    if (!targetVersion || targetVersion === "latest") {
      bestMatch = semver__default.maxSatisfying(versionStrings, "*");
    } else {
      const versionRegex = /^(\d+)(?:\.(?:x(?:\.x)?|\d+(?:\.(?:x|\d+))?))?$|^$/;
      if (!semver__default.valid(targetVersion) && !versionRegex.test(targetVersion)) {
        logger.warn(`⚠️  Invalid target version format: ${targetVersion}`);
      } else {
        let range = targetVersion;
        if (!semver__default.validRange(targetVersion)) {
          range = `~${targetVersion}`;
        } else if (semver__default.valid(targetVersion)) {
          range = `${range} || <=${targetVersion}`;
        }
        bestMatch = semver__default.maxSatisfying(versionStrings, range);
      }
    }
    if (bestMatch) {
      logger.info(`✅ Found best match version ${bestMatch} for ${libraryAndVersion}`);
    } else {
      logger.warn(`⚠️  No matching semver version found for ${libraryAndVersion}`);
    }
    if (!bestMatch && !hasUnversioned) {
      const allLibraryDetails = await this.store.queryLibraryVersions();
      const libraryDetails = allLibraryDetails.get(library) ?? [];
      const availableVersions = libraryDetails.map((v) => v.version);
      throw new VersionNotFoundInStoreError(
        library,
        targetVersion ?? "",
        availableVersions
      );
    }
    return { bestMatch, hasUnversioned };
  }
  /**
   * Removes all documents for a specific library and optional version.
   * If version is omitted, removes documents without a specific version.
   */
  async removeAllDocuments(library, version) {
    const normalizedVersion = this.normalizeVersion(version);
    logger.info(
      `🗑️ Removing all documents from ${library}@${normalizedVersion || "latest"} store`
    );
    const count = await this.store.deletePages(library, normalizedVersion);
    logger.info(`🗑️ Deleted ${count} documents`);
    this.eventBus.emit(EventType.LIBRARY_CHANGE, void 0);
  }
  /**
   * Deletes a page and all its associated document chunks.
   * This is used during refresh operations when a page returns 404 Not Found.
   */
  async deletePage(pageId) {
    logger.debug(`Deleting page ID: ${pageId}`);
    await this.store.deletePage(pageId);
    this.eventBus.emit(EventType.LIBRARY_CHANGE, void 0);
  }
  /**
   * Retrieves all pages for a specific version ID with their metadata.
   * Used for refresh operations to get existing pages with their ETags and depths.
   */
  async getPagesByVersionId(versionId) {
    return this.store.getPagesByVersionId(versionId);
  }
  /**
   * Completely removes a library version and all associated documents.
   * Also removes the library if no other versions remain.
   * If the specified version doesn't exist but the library exists with no versions, removes the library.
   * @param library Library name
   * @param version Version string (null/undefined for unversioned)
   */
  async removeVersion(library, version) {
    const normalizedVersion = this.normalizeVersion(version);
    logger.debug(`Removing version: ${library}@${normalizedVersion || "latest"}`);
    const result = await this.store.removeVersion(library, normalizedVersion, true);
    logger.info(`🗑️ Removed ${result.documentsDeleted} documents`);
    if (result.versionDeleted && result.libraryDeleted) {
      logger.info(`🗑️ Completely removed library ${library} (was last version)`);
    } else if (result.versionDeleted) {
      logger.info(`🗑️ Removed version ${library}@${normalizedVersion || "latest"}`);
    } else {
      logger.warn(`⚠️  Version ${library}@${normalizedVersion || "latest"} not found`);
      const libraryRecord = await this.store.getLibrary(library);
      if (libraryRecord) {
        const versions = await this.store.queryUniqueVersions(library);
        if (versions.length === 0) {
          logger.info(`🗑️ Library ${library} has no versions, removing library record`);
          await this.store.deleteLibrary(libraryRecord.id);
          logger.info(`🗑️ Completely removed library ${library} (had no versions)`);
        }
      }
    }
    this.eventBus.emit(EventType.LIBRARY_CHANGE, void 0);
  }
  /**
   * Adds pre-processed content directly to the store.
   * This method is used when content has already been processed by a pipeline,
   * avoiding redundant processing. Used primarily by the scraping pipeline.
   *
   * @param library Library name
   * @param version Version string (null/undefined for unversioned)
   * @param processed Pre-processed content with chunks already created
   * @param pageId Optional page ID for refresh operations
   */
  async addScrapeResult(library, version, depth, result) {
    const processingStart = performance.now();
    const normalizedVersion = this.normalizeVersion(version);
    const { url, title, chunks, contentType } = result;
    if (!url) {
      throw new StoreError("Processed content metadata must include a valid URL");
    }
    logger.info(`📚 Adding processed content: ${title || url}`);
    if (chunks.length === 0) {
      logger.warn(`⚠️  No chunks in processed content for ${url}. Skipping.`);
      return;
    }
    try {
      logger.info(`✂️  Storing ${chunks.length} pre-split chunks`);
      await this.store.addDocuments(library, normalizedVersion, depth, result);
      this.eventBus.emit(EventType.LIBRARY_CHANGE, void 0);
    } catch (error) {
      const processingTime = performance.now() - processingStart;
      if (error instanceof Error) {
        telemetry.captureException(error, {
          mimeType: contentType,
          contentSizeBytes: chunks.reduce(
            (sum, chunk) => sum + chunk.content.length,
            0
          ),
          processingTimeMs: Math.round(processingTime),
          library,
          libraryVersion: normalizedVersion || null,
          context: "processed_content_storage",
          component: DocumentManagementService.constructor.name
        });
      }
      throw error;
    }
  }
  /**
   * Searches for documentation content across versions.
   * Uses hybrid search (vector + FTS).
   * If version is omitted, searches documents without a specific version.
   */
  async searchStore(library, version, query, limit = 5) {
    const normalizedVersion = this.normalizeVersion(version);
    return this.documentRetriever.search(library, normalizedVersion, query, limit);
  }
  // Deprecated simple listing removed: enriched listLibraries() is canonical
  /**
   * Ensures a library and version exist in the database and returns the version ID.
   * Creates the library and version records if they don't exist.
   */
  async ensureLibraryAndVersion(library, version) {
    const normalizedLibrary = library.toLowerCase();
    const normalizedVersion = this.normalizeVersion(version);
    const versionId = await this.store.resolveVersionId(
      normalizedLibrary,
      normalizedVersion
    );
    return versionId;
  }
  /**
   * Retrieves a version by its ID from the database.
   */
  async getVersionById(versionId) {
    return this.store.getVersionById(versionId);
  }
  /**
   * Retrieves a library by its ID from the database.
   */
  async getLibraryById(libraryId) {
    return this.store.getLibraryById(libraryId);
  }
}
async function createDocumentManagement(options) {
  if (options.serverUrl) {
    const client = new DocumentManagementClient(options.serverUrl);
    await client.initialize();
    return client;
  }
  const storePath = options.appConfig.app.storePath;
  if (!storePath) {
    throw new Error("storePath is required when not using a remote server");
  }
  const service = new DocumentManagementService(options.eventBus, options.appConfig);
  await service.initialize();
  return service;
}
async function createLocalDocumentManagement(eventBus, appConfig) {
  const storePath = appConfig.app.storePath;
  if (!storePath) {
    throw new Error("storePath is required when not using a remote server");
  }
  const service = new DocumentManagementService(eventBus, appConfig);
  await service.initialize();
  return service;
}
class SearchTool {
  docService;
  constructor(docService) {
    this.docService = docService;
  }
  async execute(options) {
    const { library, version, query, limit = 5, exactMatch = false } = options;
    if (!library || typeof library !== "string" || library.trim() === "") {
      throw new ValidationError(
        "Library name is required and must be a non-empty string.",
        this.constructor.name
      );
    }
    if (!query || typeof query !== "string" || query.trim() === "") {
      throw new ValidationError(
        "Query is required and must be a non-empty string.",
        this.constructor.name
      );
    }
    if (limit !== void 0 && (typeof limit !== "number" || limit < 1 || limit > 100)) {
      throw new ValidationError(
        "Limit must be a number between 1 and 100.",
        this.constructor.name
      );
    }
    if (exactMatch && (!version || version === "latest")) {
      await this.docService.validateLibraryExists(library);
      const allLibraries = await this.docService.listLibraries();
      const libraryInfo = allLibraries.find((lib) => lib.library === library);
      const availableVersions = libraryInfo ? libraryInfo.versions.map((v) => v.ref.version) : [];
      throw new VersionNotFoundInStoreError(
        library,
        version ?? "latest",
        availableVersions
      );
    }
    const resolvedVersion = version || "latest";
    logger.info(
      `🔍 Searching ${library}@${resolvedVersion} for: ${query}${exactMatch ? " (exact match)" : ""}`
    );
    try {
      await this.docService.validateLibraryExists(library);
      let versionToSearch = resolvedVersion;
      if (!exactMatch) {
        const versionResult = await this.docService.findBestVersion(library, version);
        versionToSearch = versionResult.bestMatch;
      }
      const results = await this.docService.searchStore(
        library,
        versionToSearch,
        query,
        limit
      );
      logger.info(`✅ Found ${results.length} matching results`);
      return { results };
    } catch (error) {
      logger.error(
        `❌ Search failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      throw error;
    }
  }
}
async function initializeTools(docService, pipeline, config) {
  const tools = {
    listLibraries: new ListLibrariesTool(docService),
    findVersion: new FindVersionTool(docService),
    scrape: new ScrapeTool(pipeline, config.scraper),
    refresh: new RefreshVersionTool(pipeline),
    search: new SearchTool(docService),
    listJobs: new ListJobsTool(pipeline),
    getJobInfo: new GetJobInfoTool(pipeline),
    cancelJob: new CancelJobTool(pipeline),
    // clearCompletedJobs: new ClearCompletedJobsTool(pipeline),
    remove: new RemoveTool(docService, pipeline),
    fetchUrl: new FetchUrlTool(new AutoDetectFetcher(config.scraper), config)
  };
  return tools;
}
async function registerMcpService(server, docService, pipeline, config, authManager) {
  const mcpTools = await initializeTools(docService, pipeline, config);
  const mcpServer = createMcpServerInstance(mcpTools, config);
  const authMiddleware = authManager ? createAuthMiddleware(authManager) : null;
  const sseTransports = {};
  const heartbeatIntervals = {};
  server.route({
    method: "GET",
    url: "/sse",
    preHandler: authMiddleware ? [authMiddleware] : void 0,
    handler: async (_request, reply) => {
      try {
        const transport = new SSEServerTransport("/messages", reply.raw);
        sseTransports[transport.sessionId] = transport;
        if (telemetry.isEnabled()) {
          logger.info(`🔗 MCP client connected: ${transport.sessionId}`);
        }
        const heartbeatInterval = setInterval(() => {
          try {
            reply.raw.write(": heartbeat\n\n");
          } catch {
            clearInterval(heartbeatInterval);
            delete heartbeatIntervals[transport.sessionId];
          }
        }, config.server.heartbeatMs);
        heartbeatIntervals[transport.sessionId] = heartbeatInterval;
        const cleanupConnection = () => {
          const interval = heartbeatIntervals[transport.sessionId];
          if (interval) {
            clearInterval(interval);
            delete heartbeatIntervals[transport.sessionId];
          }
          delete sseTransports[transport.sessionId];
          transport.close();
          if (telemetry.isEnabled()) {
            logger.info(`🔗 MCP client disconnected: ${transport.sessionId}`);
          }
        };
        reply.raw.on("close", cleanupConnection);
        reply.raw.on("error", (error) => {
          logger.debug(`SSE connection error: ${error}`);
          cleanupConnection();
        });
        await mcpServer.connect(transport);
      } catch (error) {
        logger.error(`❌ Error in SSE endpoint: ${error}`);
        reply.code(500).send({
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  });
  server.route({
    method: "POST",
    url: "/messages",
    handler: async (request, reply) => {
      try {
        const url = new URL(request.url, `http://${request.headers.host}`);
        const sessionId = url.searchParams.get("sessionId");
        const transport = sessionId ? sseTransports[sessionId] : void 0;
        if (transport) {
          await transport.handlePostMessage(request.raw, reply.raw, request.body);
        } else {
          reply.code(400).send({ error: "No transport found for sessionId" });
        }
      } catch (error) {
        logger.error(`❌ Error in messages endpoint: ${error}`);
        reply.code(500).send({
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  });
  server.route({
    method: "POST",
    url: "/mcp",
    preHandler: authMiddleware ? [authMiddleware] : void 0,
    handler: async (request, reply) => {
      try {
        const requestServer = createMcpServerInstance(mcpTools, config);
        const requestTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: void 0
        });
        const cleanupRequest = () => {
          logger.debug("Streamable HTTP request closed");
          requestTransport.close();
          requestServer.close();
        };
        reply.raw.on("close", cleanupRequest);
        reply.raw.on("error", (error) => {
          logger.debug(`Streamable HTTP connection error: ${error}`);
          cleanupRequest();
        });
        await requestServer.connect(requestTransport);
        await requestTransport.handleRequest(request.raw, reply.raw, request.body);
      } catch (error) {
        logger.error(`❌ Error in MCP endpoint: ${error}`);
        reply.code(500).send({
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  });
  mcpServer._sseTransports = sseTransports;
  mcpServer._heartbeatIntervals = heartbeatIntervals;
  return mcpServer;
}
async function cleanupMcpService(mcpServer) {
  try {
    const heartbeatIntervals = mcpServer._heartbeatIntervals;
    if (heartbeatIntervals) {
      for (const interval of Object.values(heartbeatIntervals)) {
        clearInterval(interval);
      }
    }
    const sseTransports = mcpServer._sseTransports;
    if (sseTransports) {
      for (const transport of Object.values(sseTransports)) {
        await transport.close();
      }
    }
    await mcpServer.close();
    logger.debug("MCP service cleaned up");
  } catch (error) {
    logger.error(`❌ Failed to cleanup MCP service: ${error}`);
    throw error;
  }
}
const t$2 = initTRPC.context().create({
  transformer: superjson
});
function createEventsRouter(trpc) {
  const tt = trpc;
  return tt.router({
    /**
     * Subscribe to all application events.
     * Clients receive a stream of events as they occur.
     */
    subscribe: tt.procedure.input(
      z.object({
        events: z.array(z.nativeEnum(EventType)).optional()
      }).optional()
    ).subscription(({ ctx, input }) => {
      const eventTypes = input?.events ?? Object.values(EventType);
      return observable((emit) => {
        const unsubscribers = [];
        for (const eventType of eventTypes) {
          const unsubscribe = ctx.eventBus.on(eventType, (payload) => {
            emit.next({
              type: eventType,
              payload
            });
          });
          unsubscribers.push(unsubscribe);
        }
        return () => {
          for (const unsubscribe of unsubscribers) {
            unsubscribe();
          }
        };
      });
    })
  });
}
createEventsRouter(t$2);
const t$1 = initTRPC.context().create({
  transformer: superjson
});
const nonEmptyTrimmed = z.string().transform((s) => s.trim()).refine((s) => s.length > 0, "must not be empty");
const optionalTrimmed = z.preprocess(
  (v) => typeof v === "string" ? v.trim() : v,
  z.string().min(1).optional().nullable()
);
const enqueueScrapeInput = z.object({
  library: nonEmptyTrimmed,
  version: optionalTrimmed,
  options: z.custom()
});
const enqueueRefreshInput = z.object({
  library: nonEmptyTrimmed,
  version: optionalTrimmed
});
const jobIdInput = z.object({ id: z.string().min(1) });
const getJobsInput = z.object({
  status: z.nativeEnum(PipelineJobStatus).optional()
});
function createPipelineRouter(trpc) {
  const tt = trpc;
  return tt.router({
    ping: tt.procedure.query(async () => ({ status: "ok", ts: Date.now() })),
    enqueueScrapeJob: tt.procedure.input(enqueueScrapeInput).mutation(
      async ({
        ctx,
        input
      }) => {
        const jobId = await ctx.pipeline.enqueueScrapeJob(
          input.library,
          input.version ?? null,
          input.options
        );
        return { jobId };
      }
    ),
    enqueueRefreshJob: tt.procedure.input(enqueueRefreshInput).mutation(
      async ({
        ctx,
        input
      }) => {
        const jobId = await ctx.pipeline.enqueueRefreshJob(
          input.library,
          input.version ?? null
        );
        return { jobId };
      }
    ),
    getJob: tt.procedure.input(jobIdInput).query(
      async ({
        ctx,
        input
      }) => {
        return ctx.pipeline.getJob(input.id);
      }
    ),
    getJobs: tt.procedure.input(getJobsInput.optional()).query(
      async ({
        ctx,
        input
      }) => {
        const jobs = await ctx.pipeline.getJobs(input?.status);
        return { jobs };
      }
    ),
    cancelJob: tt.procedure.input(jobIdInput).mutation(
      async ({
        ctx,
        input
      }) => {
        await ctx.pipeline.cancelJob(input.id);
        return { success: true };
      }
    ),
    clearCompletedJobs: tt.procedure.mutation(
      async ({ ctx }) => {
        const count = await ctx.pipeline.clearCompletedJobs();
        return { count };
      }
    )
  });
}
createPipelineRouter(t$1);
const t = initTRPC.context().create({
  transformer: superjson
});
const nonEmpty = z.string().min(1).transform((s) => s.trim());
const optionalVersion = z.string().optional().nullable().transform((v) => typeof v === "string" ? v.trim() : v);
function createDataRouter(trpc) {
  const tt = trpc;
  return tt.router({
    ping: tt.procedure.query(async () => ({ status: "ok", ts: Date.now() })),
    listLibraries: tt.procedure.query(async ({ ctx }) => {
      return await ctx.docService.listLibraries();
    }),
    findBestVersion: tt.procedure.input(z.object({ library: nonEmpty, targetVersion: z.string().optional() })).query(
      async ({
        ctx,
        input
      }) => {
        const result = await ctx.docService.findBestVersion(
          input.library,
          input.targetVersion
        );
        return result;
      }
    ),
    validateLibraryExists: tt.procedure.input(z.object({ library: nonEmpty })).mutation(
      async ({ ctx, input }) => {
        await ctx.docService.validateLibraryExists(input.library);
        return { ok: true };
      }
    ),
    search: tt.procedure.input(
      z.object({
        library: nonEmpty,
        version: optionalVersion,
        query: nonEmpty,
        limit: z.number().int().positive().max(50).optional()
      })
    ).query(
      async ({
        ctx,
        input
      }) => {
        const results = await ctx.docService.searchStore(
          input.library,
          input.version ?? null,
          input.query,
          input.limit ?? 5
        );
        return results;
      }
    ),
    removeVersion: tt.procedure.input(z.object({ library: nonEmpty, version: optionalVersion })).mutation(
      async ({
        ctx,
        input
      }) => {
        await ctx.docService.removeVersion(input.library, input.version ?? null);
        return { ok: true };
      }
    ),
    removeAllDocuments: tt.procedure.input(z.object({ library: nonEmpty, version: optionalVersion })).mutation(
      async ({
        ctx,
        input
      }) => {
        await ctx.docService.removeAllDocuments(input.library, input.version ?? null);
        return { ok: true };
      }
    ),
    // Status and version helpers
    getVersionsByStatus: tt.procedure.input(z.object({ statuses: z.array(z.string()) })).query(
      async ({
        ctx,
        input
      }) => {
        const statuses = input.statuses;
        return await ctx.docService.getVersionsByStatus(
          statuses
        );
      }
    ),
    findVersionsBySourceUrl: tt.procedure.input(z.object({ url: nonEmpty })).query(async ({ ctx, input }) => {
      return await ctx.docService.findVersionsBySourceUrl(
        input.url
      );
    }),
    getScraperOptions: tt.procedure.input(z.object({ versionId: z.number().int().positive() })).query(
      async ({
        ctx,
        input
      }) => {
        return await ctx.docService.getScraperOptions(input.versionId);
      }
    ),
    updateVersionStatus: tt.procedure.input(
      z.object({
        versionId: z.number().int().positive(),
        status: z.string(),
        errorMessage: z.string().optional().nullable()
      })
    ).mutation(
      async ({
        ctx,
        input
      }) => {
        await ctx.docService.updateVersionStatus(
          input.versionId,
          input.status,
          input.errorMessage ?? void 0
        );
        return { ok: true };
      }
    ),
    updateVersionProgress: tt.procedure.input(
      z.object({
        versionId: z.number().int().positive(),
        pages: z.number().int().nonnegative(),
        maxPages: z.number().int().positive()
      })
    ).mutation(
      async ({
        ctx,
        input
      }) => {
        await ctx.docService.updateVersionProgress(
          input.versionId,
          input.pages,
          input.maxPages
        );
        return { ok: true };
      }
    ),
    storeScraperOptions: tt.procedure.input(
      z.object({
        versionId: z.number().int().positive(),
        options: z.unknown()
      })
    ).mutation(
      async ({
        ctx,
        input
      }) => {
        await ctx.docService.storeScraperOptions(
          input.versionId,
          input.options
        );
        return { ok: true };
      }
    )
  });
}
createDataRouter(t);
async function registerTrpcService(server, pipeline, docService, eventBus) {
  const t2 = initTRPC.context().create({
    transformer: superjson
  });
  const healthRouter = t2.router({
    ping: t2.procedure.query(async () => ({ status: "ok", ts: Date.now() }))
  });
  const router = t2.router({
    ...healthRouter._def.procedures,
    ...createPipelineRouter(t2)._def.procedures,
    ...createDataRouter(t2)._def.procedures,
    events: createEventsRouter(t2)
  });
  await server.register(fastifyTRPCPlugin, {
    prefix: "/api",
    trpcOptions: {
      router,
      createContext: async () => ({
        pipeline,
        docService,
        eventBus
      })
    }
  });
}
function applyTrpcWebSocketHandler(wss, pipeline, docService, eventBus) {
  const t2 = initTRPC.context().create({
    transformer: superjson
  });
  const healthRouter = t2.router({
    ping: t2.procedure.query(async () => ({ status: "ok", ts: Date.now() }))
  });
  const router = t2.router({
    ...healthRouter._def.procedures,
    ...createPipelineRouter(t2)._def.procedures,
    ...createDataRouter(t2)._def.procedures,
    events: createEventsRouter(t2)
  });
  const handler = applyWSSHandler({
    wss,
    router,
    createContext: () => ({
      pipeline,
      docService,
      eventBus
    })
  });
  return handler;
}
function convertToSsePayload(eventType, payload) {
  switch (eventType) {
    case EventType.JOB_STATUS_CHANGE: {
      const job = payload;
      return {
        id: job.id,
        library: job.library,
        version: job.version,
        status: job.status,
        error: job.error,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
        sourceUrl: job.sourceUrl
      };
    }
    case EventType.JOB_PROGRESS: {
      const { job, progress } = payload;
      return {
        id: job.id,
        library: job.library,
        version: job.version,
        progress: {
          pagesScraped: progress.pagesScraped,
          totalPages: progress.totalPages,
          totalDiscovered: progress.totalDiscovered,
          currentUrl: progress.currentUrl,
          depth: progress.depth,
          maxDepth: progress.maxDepth
        }
      };
    }
    case EventType.LIBRARY_CHANGE: {
      return {};
    }
    case EventType.JOB_LIST_CHANGE: {
      return {};
    }
    default: {
      const _exhaustive = eventType;
      throw new Error(`Unhandled event type: ${_exhaustive}`);
    }
  }
}
function sendSseMessage(reply, eventName, data) {
  try {
    const message = `event: ${eventName}
data: ${JSON.stringify(data)}

`;
    reply.raw.write(message);
    return true;
  } catch (error) {
    logger.error(`❌ Failed to send SSE event: ${error}`);
    return false;
  }
}
function registerEventsRoute(server, eventBus) {
  server.get("/web/events", async (request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
      // Disable buffering in nginx
    });
    reply.raw.write("data: connected\n\n");
    logger.debug("SSE client connected");
    const allEventTypes = [
      EventType.JOB_STATUS_CHANGE,
      EventType.JOB_PROGRESS,
      EventType.LIBRARY_CHANGE,
      EventType.JOB_LIST_CHANGE
    ];
    const unsubscribers = [];
    for (const eventType of allEventTypes) {
      const unsubscribe = eventBus.on(eventType, (payload) => {
        try {
          const eventName = ServerEventName[eventType];
          const ssePayload = convertToSsePayload(eventType, payload);
          logger.debug(
            `SSE forwarding event: ${eventName} ${JSON.stringify(ssePayload)}`
          );
          sendSseMessage(reply, eventName, ssePayload);
        } catch (error) {
          logger.error(`❌ Failed to convert/send SSE event ${eventType}: ${error}`);
        }
      });
      unsubscribers.push(unsubscribe);
      logger.debug(`SSE listener registered for: ${ServerEventName[eventType]}`);
    }
    const cleanup = () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
    const heartbeatInterval = setInterval(() => {
      try {
        reply.raw.write(": heartbeat\n\n");
      } catch (_error) {
        logger.debug("Failed to send heartbeat, client likely disconnected");
        clearInterval(heartbeatInterval);
      }
    }, 3e4);
    request.raw.on("close", () => {
      logger.debug("SSE client disconnected");
      cleanup();
      clearInterval(heartbeatInterval);
    });
    request.raw.on("error", (error) => {
      logger.debug(`SSE connection error: ${error}`);
      cleanup();
      clearInterval(heartbeatInterval);
    });
  });
}
const PrimaryButton = ({
  children,
  type = "button",
  class: className = "",
  disabled = false,
  ...rest
}) => {
  const baseClasses = "w-full flex justify-center py-1.5 px-3 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors duration-150";
  const disabledClasses = disabled ? "opacity-50 cursor-not-allowed" : "";
  const combinedClasses = `${baseClasses} ${disabledClasses} ${className}`.trim();
  return /* @__PURE__ */ jsx("button", { type, class: combinedClasses, disabled, ...rest, children });
};
const AddJobButton = () => {
  return /* @__PURE__ */ jsx(
    PrimaryButton,
    {
      "hx-get": "/web/jobs/new",
      "hx-target": "#addJobForm",
      "hx-swap": "innerHTML",
      children: "Add New Documentation"
    }
  );
};
const Toast = () => {
  return /* @__PURE__ */ jsx(
    "div",
    {
      "x-data": true,
      "x-show": "$store.toast.visible",
      "x-transition:enter": "transition ease-out duration-300",
      "x-transition:enter-start": "opacity-0 transform translate-y-2",
      "x-transition:enter-end": "opacity-100 transform translate-y-0",
      "x-transition:leave": "transition ease-in duration-200",
      "x-transition:leave-start": "opacity-100",
      "x-transition:leave-end": "opacity-0",
      class: "fixed top-5 right-5 z-50",
      style: "display: none;",
      children: /* @__PURE__ */ jsxs(
        "div",
        {
          class: "flex items-center w-full max-w-xs p-4 text-gray-500 bg-white rounded-lg shadow dark:text-gray-400 dark:bg-gray-800",
          role: "alert",
          children: [
            /* @__PURE__ */ jsxs(
              "div",
              {
                class: "inline-flex items-center justify-center shrink-0 w-8 h-8 rounded-lg",
                "x-bind:class": "{\n            'text-green-500 bg-green-100 dark:bg-green-800 dark:text-green-200': $store.toast.type === 'success',\n            'text-red-500 bg-red-100 dark:bg-red-800 dark:text-red-200': $store.toast.type === 'error',\n            'text-orange-500 bg-orange-100 dark:bg-orange-700 dark:text-orange-200': $store.toast.type === 'warning',\n            'text-blue-500 bg-blue-100 dark:bg-blue-800 dark:text-blue-200': $store.toast.type === 'info'\n          }",
                children: [
                  /* @__PURE__ */ jsx(
                    "svg",
                    {
                      "x-show": "$store.toast.type === 'success'",
                      class: "w-5 h-5",
                      "aria-hidden": "true",
                      xmlns: "http://www.w3.org/2000/svg",
                      fill: "currentColor",
                      viewBox: "0 0 20 20",
                      children: /* @__PURE__ */ jsx("path", { d: "M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5Zm3.707 8.207-4 4a1 1 0 0 1-1.414 0l-2-2a1 1 0 0 1 1.414-1.414L9 10.586l3.293-3.293a1 1 0 0 1 1.414 1.414Z" })
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    "svg",
                    {
                      "x-show": "$store.toast.type === 'error'",
                      class: "w-5 h-5",
                      "aria-hidden": "true",
                      xmlns: "http://www.w3.org/2000/svg",
                      fill: "currentColor",
                      viewBox: "0 0 20 20",
                      children: /* @__PURE__ */ jsx("path", { d: "M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5Zm3.707 11.793a1 1 0 1 1-1.414 1.414L10 11.414l-2.293 2.293a1 1 0 0 1-1.414-1.414L8.586 10 6.293 7.707a1 1 0 0 1 1.414-1.414L10 8.586l2.293-2.293a1 1 0 0 1 1.414 1.414L11.414 10l2.293 2.293Z" })
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    "svg",
                    {
                      "x-show": "$store.toast.type === 'warning'",
                      class: "w-5 h-5",
                      "aria-hidden": "true",
                      xmlns: "http://www.w3.org/2000/svg",
                      fill: "currentColor",
                      viewBox: "0 0 20 20",
                      children: /* @__PURE__ */ jsx("path", { d: "M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM10 15a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm1-4a1 1 0 0 1-2 0V6a1 1 0 0 1 2 0v5Z" })
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    "svg",
                    {
                      "x-show": "$store.toast.type === 'info'",
                      class: "w-5 h-5",
                      "aria-hidden": "true",
                      xmlns: "http://www.w3.org/2000/svg",
                      fill: "currentColor",
                      viewBox: "0 0 20 20",
                      children: /* @__PURE__ */ jsx("path", { d: "M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM9.5 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 15H8a1 1 0 0 1 0-2h1v-3H8a1 1 0 0 1 0-2h2a1 1 0 0 1 1 1v4h1a1 1 0 0 1 0 2Z" })
                    }
                  )
                ]
              }
            ),
            /* @__PURE__ */ jsx(
              "div",
              {
                class: "ml-3 text-sm font-normal",
                "x-text": "$store.toast.message"
              }
            ),
            /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                class: "ml-auto -mx-1.5 -my-1.5 bg-white text-gray-400 hover:text-gray-900 rounded-lg focus:ring-2 focus:ring-gray-300 p-1.5 hover:bg-gray-100 inline-flex items-center justify-center h-8 w-8 dark:text-gray-500 dark:hover:text-white dark:bg-gray-800 dark:hover:bg-gray-700",
                "x-on:click": "$store.toast.hide()",
                "aria-label": "Close",
                children: [
                  /* @__PURE__ */ jsx("span", { class: "sr-only", children: "Close" }),
                  /* @__PURE__ */ jsx(
                    "svg",
                    {
                      class: "w-3 h-3",
                      "aria-hidden": "true",
                      xmlns: "http://www.w3.org/2000/svg",
                      fill: "none",
                      viewBox: "0 0 14 14",
                      children: /* @__PURE__ */ jsx(
                        "path",
                        {
                          stroke: "currentColor",
                          "stroke-linecap": "round",
                          "stroke-linejoin": "round",
                          "stroke-width": "2",
                          d: "m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"
                        }
                      )
                    }
                  )
                ]
              }
            )
          ]
        }
      )
    }
  );
};
const Layout = ({
  title,
  version,
  children,
  eventClientConfig
}) => {
  const versionString = version || "1.33.1";
  const versionInitializer = `versionUpdate({ currentVersion: ${`'${versionString}'`} })`;
  return /* @__PURE__ */ jsxs("html", { lang: "en", children: [
    /* @__PURE__ */ jsxs("head", { children: [
      /* @__PURE__ */ jsx("meta", { charset: "UTF-8" }),
      /* @__PURE__ */ jsx("meta", { name: "viewport", content: "width=device-width, initial-scale=1.0" }),
      /* @__PURE__ */ jsx("title", { safe: true, children: title }),
      /* @__PURE__ */ jsx(
        "link",
        {
          rel: "apple-touch-icon",
          sizes: "57x57",
          href: "/apple-icon-57x57.png"
        }
      ),
      /* @__PURE__ */ jsx(
        "link",
        {
          rel: "apple-touch-icon",
          sizes: "60x60",
          href: "/apple-icon-60x60.png"
        }
      ),
      /* @__PURE__ */ jsx(
        "link",
        {
          rel: "apple-touch-icon",
          sizes: "72x72",
          href: "/apple-icon-72x72.png"
        }
      ),
      /* @__PURE__ */ jsx(
        "link",
        {
          rel: "apple-touch-icon",
          sizes: "76x76",
          href: "/apple-icon-76x76.png"
        }
      ),
      /* @__PURE__ */ jsx(
        "link",
        {
          rel: "apple-touch-icon",
          sizes: "114x114",
          href: "/apple-icon-114x114.png"
        }
      ),
      /* @__PURE__ */ jsx(
        "link",
        {
          rel: "apple-touch-icon",
          sizes: "120x120",
          href: "/apple-icon-120x120.png"
        }
      ),
      /* @__PURE__ */ jsx(
        "link",
        {
          rel: "apple-touch-icon",
          sizes: "144x144",
          href: "/apple-icon-144x144.png"
        }
      ),
      /* @__PURE__ */ jsx(
        "link",
        {
          rel: "apple-touch-icon",
          sizes: "152x152",
          href: "/apple-icon-152x152.png"
        }
      ),
      /* @__PURE__ */ jsx(
        "link",
        {
          rel: "apple-touch-icon",
          sizes: "180x180",
          href: "/apple-icon-180x180.png"
        }
      ),
      /* @__PURE__ */ jsx(
        "link",
        {
          rel: "icon",
          type: "image/png",
          sizes: "192x192",
          href: "/android-icon-192x192.png"
        }
      ),
      /* @__PURE__ */ jsx(
        "link",
        {
          rel: "icon",
          type: "image/png",
          sizes: "32x32",
          href: "/favicon-32x32.png"
        }
      ),
      /* @__PURE__ */ jsx(
        "link",
        {
          rel: "icon",
          type: "image/png",
          sizes: "96x96",
          href: "/favicon-96x96.png"
        }
      ),
      /* @__PURE__ */ jsx(
        "link",
        {
          rel: "icon",
          type: "image/png",
          sizes: "16x16",
          href: "/favicon-16x16.png"
        }
      ),
      /* @__PURE__ */ jsx("link", { rel: "shortcut icon", href: "/favicon.ico" }),
      /* @__PURE__ */ jsx("link", { rel: "manifest", href: "/manifest.json" }),
      /* @__PURE__ */ jsx("meta", { name: "msapplication-TileColor", content: "#ffffff" }),
      /* @__PURE__ */ jsx("meta", { name: "msapplication-TileImage", content: "/ms-icon-144x144.png" }),
      /* @__PURE__ */ jsx("meta", { name: "theme-color", content: "#ffffff" }),
      /* @__PURE__ */ jsx("link", { rel: "stylesheet", href: "/assets/main.css" }),
      /* @__PURE__ */ jsx("style", { children: `
          .htmx-indicator {
            display: none;
          }
          .htmx-request .htmx-indicator {
            display: block;
          }
          .htmx-request.htmx-indicator {
            display: block;
          }
          /* Default: Hide skeleton, show results container */
          #searchResultsContainer .search-skeleton { display: none; }
          #searchResultsContainer .search-results { display: block; } /* Or as needed */

          /* Request in progress: Show skeleton, hide results */
          #searchResultsContainer.htmx-request .search-skeleton { display: block; } /* Or flex etc. */
          #searchResultsContainer.htmx-request .search-results { display: none; }

          /* Keep button spinner logic */
          form .htmx-indicator .spinner { display: flex; }
          form .htmx-indicator .search-text { display: none; }
          form .spinner { display: none; }
          ` })
    ] }),
    /* @__PURE__ */ jsxs("body", { class: "bg-gray-50 dark:bg-gray-900", "hx-ext": "morph", children: [
      /* @__PURE__ */ jsx(Toast, {}),
      /* @__PURE__ */ jsx(
        "header",
        {
          class: "bg-white border-b border-gray-200 dark:bg-gray-800 dark:border-gray-700",
          "x-data": versionInitializer,
          "x-init": "queueCheck()",
          children: /* @__PURE__ */ jsxs("div", { class: "container max-w-2xl mx-auto px-4 py-4", children: [
            /* @__PURE__ */ jsxs("div", { class: "hidden sm:flex items-center justify-between", children: [
              /* @__PURE__ */ jsxs("div", { class: "flex items-center gap-3", children: [
                /* @__PURE__ */ jsxs(
                  "a",
                  {
                    href: "https://grounded.tools",
                    target: "_blank",
                    rel: "noopener noreferrer",
                    class: "text-xl font-medium text-gray-900 dark:text-white hover:text-primary-500 dark:hover:text-primary-400 transition-colors font-brand",
                    children: [
                      /* @__PURE__ */ jsx("span", { class: "text-primary-600 dark:text-primary-300", children: "grounded" }),
                      /* @__PURE__ */ jsx("span", { class: "text-accent-500", children: "." }),
                      /* @__PURE__ */ jsx("span", { class: "text-gray-900 dark:text-gray-100", children: "tools" })
                    ]
                  }
                ),
                /* @__PURE__ */ jsx("span", { class: "text-gray-400 dark:text-gray-400", children: "|" }),
                /* @__PURE__ */ jsx(
                  "a",
                  {
                    href: "/",
                    class: "text-lg font-semibold text-gray-900 dark:text-white hover:text-primary-500 dark:hover:text-primary-400 transition-colors font-brand",
                    children: "Grounded Docs"
                  }
                ),
                /* @__PURE__ */ jsxs(
                  "span",
                  {
                    safe: true,
                    class: "text-sm font-normal text-gray-500 dark:text-slate-400",
                    title: `Version ${versionString}`,
                    children: [
                      "v",
                      versionString
                    ]
                  }
                )
              ] }),
              /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsxs(
                "span",
                {
                  "x-show": "hasUpdate",
                  "x-cloak": true,
                  class: "inline-flex items-center gap-2 rounded-full bg-amber-100 dark:bg-amber-500/20 px-3 py-1.5 text-sm font-medium text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30",
                  role: "status",
                  "aria-live": "polite",
                  children: [
                    /* @__PURE__ */ jsx("span", { class: "flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-amber-800 dark:text-amber-900 text-xs font-bold", children: "!" }),
                    /* @__PURE__ */ jsx(
                      "a",
                      {
                        "x-bind:href": "latestReleaseUrl",
                        target: "_blank",
                        rel: "noopener noreferrer",
                        class: "hover:text-amber-800 dark:hover:text-amber-200 transition-colors",
                        children: /* @__PURE__ */ jsx("span", { class: "mr-1", children: "Update available" })
                      }
                    )
                  ]
                }
              ) })
            ] }),
            /* @__PURE__ */ jsxs("div", { class: "sm:hidden space-y-2", children: [
              /* @__PURE__ */ jsx("div", { class: "flex justify-center", children: /* @__PURE__ */ jsxs(
                "a",
                {
                  href: "https://grounded.tools",
                  target: "_blank",
                  rel: "noopener noreferrer",
                  class: "text-xl font-medium text-gray-900 dark:text-white hover:text-primary-500 dark:hover:text-primary-400 transition-colors font-brand",
                  children: [
                    /* @__PURE__ */ jsx("span", { class: "text-primary-600 dark:text-primary-300", children: "grounded" }),
                    /* @__PURE__ */ jsx("span", { class: "text-accent-500", children: "." }),
                    /* @__PURE__ */ jsx("span", { class: "text-gray-900 dark:text-gray-100", children: "tools" })
                  ]
                }
              ) }),
              /* @__PURE__ */ jsxs("div", { class: "flex items-center justify-center gap-2", children: [
                /* @__PURE__ */ jsx(
                  "a",
                  {
                    href: "/",
                    class: "text-lg font-semibold text-gray-900 dark:text-white hover:text-primary-500 dark:hover:text-primary-400 transition-colors font-brand",
                    children: "Grounded Docs"
                  }
                ),
                /* @__PURE__ */ jsxs(
                  "span",
                  {
                    safe: true,
                    class: "text-sm font-normal text-gray-500 dark:text-slate-400",
                    title: `Version ${versionString}`,
                    children: [
                      "v",
                      versionString
                    ]
                  }
                )
              ] }),
              /* @__PURE__ */ jsx("div", { class: "flex justify-center", children: /* @__PURE__ */ jsxs(
                "span",
                {
                  "x-show": "hasUpdate",
                  "x-cloak": true,
                  class: "inline-flex items-center gap-2 rounded-full bg-amber-100 dark:bg-amber-500/20 px-3 py-1.5 text-sm font-medium text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30",
                  role: "status",
                  "aria-live": "polite",
                  children: [
                    /* @__PURE__ */ jsx("span", { class: "flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-amber-800 dark:text-amber-900 text-xs font-bold", children: "!" }),
                    /* @__PURE__ */ jsx(
                      "a",
                      {
                        "x-bind:href": "latestReleaseUrl",
                        target: "_blank",
                        rel: "noopener noreferrer",
                        class: "hover:text-amber-800 dark:hover:text-amber-200 transition-colors",
                        children: /* @__PURE__ */ jsx("span", { class: "mr-1", children: "Update available" })
                      }
                    )
                  ]
                }
              ) })
            ] })
          ] })
        }
      ),
      /* @__PURE__ */ jsx("div", { class: "container max-w-2xl mx-auto px-4 py-6", children: /* @__PURE__ */ jsx("main", { children }) }),
      /* @__PURE__ */ jsx("script", { children: `window.__EVENT_CLIENT_CONFIG__ = ${JSON.stringify(eventClientConfig)};` }),
      /* @__PURE__ */ jsx("script", { type: "module", src: "/assets/main.js" }),
      /* @__PURE__ */ jsx("script", { children: `
            window.addEventListener('message', (event) => {
              if (event.data && event.data.type === 'theme') {
                const { mode, vars } = event.data;
                const html = document.documentElement;
                
                if (mode === 'dark') {
                  html.classList.add('dark');
                } else {
                  html.classList.remove('dark');
                }

                // Apply dynamic VS Code variables
                if (vars) {
                  for (const [key, value] of Object.entries(vars)) {
                    html.style.setProperty(key, value);
                  }
                }
              }
            });
          ` })
    ] })
  ] });
};
function registerIndexRoute(server, externalWorkerUrl) {
  server.get("/", async (_, reply) => {
    reply.type("text/html");
    const useRemoteWorker = Boolean(externalWorkerUrl);
    const trpcUrl = externalWorkerUrl ? `${externalWorkerUrl}/api` : void 0;
    return "<!DOCTYPE html>" + /* @__PURE__ */ jsxs(
      Layout,
      {
        title: "MCP Docs",
        eventClientConfig: {
          useRemoteWorker,
          trpcUrl
        },
        children: [
          /* @__PURE__ */ jsx(
            "div",
            {
              id: "analytics-stats",
              "hx-get": "/web/stats",
              "hx-trigger": "load, library-change from:body",
              "hx-swap": "morph:innerHTML",
              children: /* @__PURE__ */ jsxs("div", { class: "grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4 animate-pulse", children: [
                /* @__PURE__ */ jsx("div", { class: "p-4 bg-white rounded-lg shadow dark:bg-gray-800 border border-gray-300 dark:border-gray-600 h-20" }),
                /* @__PURE__ */ jsx("div", { class: "p-4 bg-white rounded-lg shadow dark:bg-gray-800 border border-gray-300 dark:border-gray-600 h-20" }),
                /* @__PURE__ */ jsx("div", { class: "p-4 bg-white rounded-lg shadow dark:bg-gray-800 border border-gray-300 dark:border-gray-600 h-20" })
              ] })
            }
          ),
          /* @__PURE__ */ jsxs("section", { class: "mb-4 p-4 bg-white rounded-lg shadow dark:bg-gray-800 border border-gray-300 dark:border-gray-600", children: [
            /* @__PURE__ */ jsxs("div", { class: "flex items-center justify-between mb-2", children: [
              /* @__PURE__ */ jsx("h2", { class: "text-xl font-semibold text-gray-900 dark:text-white", children: "Job Queue" }),
              /* @__PURE__ */ jsx(
                "button",
                {
                  id: "clear-completed-btn",
                  type: "button",
                  class: "text-xs px-3 py-1.5 text-gray-400 bg-gray-50 border border-gray-200 rounded-lg cursor-not-allowed focus:ring-4 focus:outline-none transition-colors duration-150 dark:bg-gray-700 dark:text-gray-500 dark:border-gray-600",
                  title: "Clear all completed, cancelled, and failed jobs",
                  "hx-post": "/web/jobs/clear-completed",
                  "hx-trigger": "click",
                  "hx-on": "htmx:afterRequest: document.dispatchEvent(new Event('job-list-refresh'))",
                  "hx-swap": "none",
                  disabled: true,
                  children: "Clear Completed Jobs"
                }
              )
            ] }),
            /* @__PURE__ */ jsx(
              "div",
              {
                id: "job-queue",
                "hx-get": "/web/jobs",
                "hx-trigger": "load, job-status-change from:body, job-progress from:body, job-list-change from:body, job-list-refresh from:body",
                "hx-swap": "morph:innerHTML",
                children: /* @__PURE__ */ jsxs("div", { class: "animate-pulse", children: [
                  /* @__PURE__ */ jsx("div", { class: "h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-48 mb-4" }),
                  /* @__PURE__ */ jsx("div", { class: "h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-full mb-2.5" }),
                  /* @__PURE__ */ jsx("div", { class: "h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-full mb-2.5" })
                ] })
              }
            )
          ] }),
          /* @__PURE__ */ jsx("section", { class: "mb-8", children: /* @__PURE__ */ jsx("div", { id: "addJobForm", children: /* @__PURE__ */ jsx(AddJobButton, {}) }) }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("h2", { class: "text-xl font-semibold mb-2 text-gray-900 dark:text-white", children: "Indexed Documentation" }),
            /* @__PURE__ */ jsx(
              "div",
              {
                id: "indexed-docs",
                "hx-get": "/web/libraries",
                "hx-trigger": "load, library-change from:body",
                "hx-swap": "morph:innerHTML",
                children: /* @__PURE__ */ jsxs("div", { class: "animate-pulse", children: [
                  /* @__PURE__ */ jsx("div", { class: "h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-48 mb-4" }),
                  /* @__PURE__ */ jsx("div", { class: "h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-full mb-2.5" }),
                  /* @__PURE__ */ jsx("div", { class: "h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-full mb-2.5" })
                ] })
              }
            )
          ] })
        ]
      }
    );
  });
}
function registerCancelJobRoute(server, cancelJobTool) {
  server.post(
    "/web/jobs/:jobId/cancel",
    async (request, reply) => {
      const { jobId } = request.params;
      try {
        await cancelJobTool.execute({ jobId });
        return { success: true, message: "Job cancelled successfully" };
      } catch (error) {
        if (error instanceof ToolError) {
          reply.status(400);
          return { success: false, message: error.message };
        } else {
          reply.status(500);
          return { success: false, message: "Internal server error" };
        }
      }
    }
  );
}
function registerClearCompletedJobsRoute(server, clearCompletedJobsTool) {
  server.post("/web/jobs/clear-completed", async (_, reply) => {
    try {
      await clearCompletedJobsTool.execute({});
      reply.type("application/json");
      return {
        success: true,
        message: "Completed jobs cleared successfully"
      };
    } catch (error) {
      if (error instanceof ToolError) {
        reply.code(400);
        return {
          success: false,
          message: error.message
        };
      } else {
        reply.code(500);
        return {
          success: false,
          message: `Internal server error: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }
  });
}
const VersionBadge = ({ version }) => {
  if (!version) {
    return null;
  }
  return /* @__PURE__ */ jsx("span", { class: "bg-primary-100 text-primary-800 text-xs font-medium me-2 px-1.5 py-0.5 rounded dark:bg-primary-900 dark:text-primary-300", children: /* @__PURE__ */ jsx("span", { safe: true, children: version }) });
};
function getStatusClasses(status) {
  const baseClasses = "px-1.5 py-0.5 text-xs font-medium rounded";
  switch (status) {
    case VersionStatus.COMPLETED:
      return `${baseClasses} bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300`;
    case VersionStatus.RUNNING:
    case VersionStatus.UPDATING:
      return `${baseClasses} bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300`;
    case VersionStatus.QUEUED:
      return `${baseClasses} bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300`;
    case VersionStatus.FAILED:
      return `${baseClasses} bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300`;
    case VersionStatus.CANCELLED:
      return `${baseClasses} bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300`;
    case VersionStatus.NOT_INDEXED:
    default:
      return `${baseClasses} bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400`;
  }
}
const StatusBadge = ({ status, showDescription = true }) => /* @__PURE__ */ jsx("span", { class: getStatusClasses(status), children: showDescription ? getStatusDescription(status) : status });
const ProgressBar = ({ progress, showText = true }) => {
  const isIndeterminate = progress.totalDiscovered === 1;
  const percentage = progress.totalPages > 0 ? Math.round(progress.pages / progress.totalPages * 100) : 0;
  const getProgressText = () => {
    if (isIndeterminate) {
      return "Discovering pages...";
    }
    const baseText = `${progress.pages}/${progress.totalPages} pages (${percentage}%)`;
    if (progress.totalDiscovered > progress.totalPages) {
      return `${baseText} • ${progress.totalDiscovered} total`;
    }
    return baseText;
  };
  return /* @__PURE__ */ jsxs("div", { class: "w-full", children: [
    showText && /* @__PURE__ */ jsxs("div", { class: "flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1", children: [
      /* @__PURE__ */ jsx("span", { children: "Progress" }),
      /* @__PURE__ */ jsx("span", { safe: true, children: getProgressText() })
    ] }),
    /* @__PURE__ */ jsx("div", { class: "w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700", children: isIndeterminate ? (
      // Indeterminate progress bar with animation
      /* @__PURE__ */ jsx(
        "div",
        {
          class: "bg-blue-600 h-2 rounded-full animate-pulse",
          style: "width: 30%"
        }
      )
    ) : /* @__PURE__ */ jsx(
      "div",
      {
        class: "bg-blue-600 h-2 rounded-full transition-all duration-300",
        style: `width: ${percentage}%`
      }
    ) })
  ] });
};
const LoadingSpinner = ({
  class: className = "text-white"
}) => /* @__PURE__ */ jsxs(
  "svg",
  {
    class: `animate-spin h-4 w-4 ${className}`,
    xmlns: "http://www.w3.org/2000/svg",
    fill: "none",
    viewBox: "0 0 24 24",
    children: [
      /* @__PURE__ */ jsx(
        "circle",
        {
          class: "opacity-25",
          cx: "12",
          cy: "12",
          r: "10",
          stroke: "currentColor",
          "stroke-width": "4"
        }
      ),
      /* @__PURE__ */ jsx(
        "path",
        {
          class: "opacity-75",
          fill: "currentColor",
          d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        }
      )
    ]
  }
);
const JobItem = ({ job }) => {
  job.dbStatus || job.status;
  const isActiveJob = job.dbStatus ? isActiveStatus(job.dbStatus) : job.status === PipelineJobStatus.QUEUED || job.status === PipelineJobStatus.RUNNING;
  const defaultStateClasses = "border border-gray-300 bg-white text-red-600 hover:bg-red-50 focus:ring-4 focus:outline-none focus:ring-red-100 dark:border-gray-600 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-gray-700 dark:focus:ring-red-900";
  const confirmingStateClasses = "bg-red-600 text-white border-red-600 focus:ring-4 focus:outline-none focus:ring-red-300 dark:bg-red-700 dark:border-red-700 dark:focus:ring-red-800";
  return /* @__PURE__ */ jsx(
    "div",
    {
      id: `job-item-${job.id}`,
      class: "block p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600",
      "data-job-id": job.id,
      "x-data": "{ jobId: $el.dataset.jobId, confirming: $el.dataset.confirming === 'true', isStopping: false }",
      children: /* @__PURE__ */ jsxs("div", { class: "flex items-start justify-between", children: [
        /* @__PURE__ */ jsxs("div", { class: "flex-1", children: [
          /* @__PURE__ */ jsxs("p", { class: "text-sm font-medium text-gray-900 dark:text-white", children: [
            /* @__PURE__ */ jsx("span", { safe: true, children: job.library }),
            " ",
            /* @__PURE__ */ jsx(VersionBadge, { version: job.version })
          ] }),
          /* @__PURE__ */ jsx("div", { class: "text-xs text-gray-500 dark:text-gray-400 mt-1", children: job.startedAt ? /* @__PURE__ */ jsxs("div", { children: [
            "Last Indexed:",
            " ",
            /* @__PURE__ */ jsx("span", { safe: true, children: new Date(job.startedAt).toLocaleString() })
          ] }) : null }),
          job.progress && job.progress.totalPages > 0 && isActiveJob ? /* @__PURE__ */ jsx("div", { class: "mt-2", children: /* @__PURE__ */ jsx(ProgressBar, { progress: job.progress }) }) : null,
          job.errorMessage || job.error ? /* @__PURE__ */ jsxs("div", { class: "mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-xs", children: [
            /* @__PURE__ */ jsx("div", { class: "font-medium text-red-800 dark:text-red-300 mb-1", children: "Error:" }),
            /* @__PURE__ */ jsx("div", { safe: true, class: "text-red-700 dark:text-red-400", children: job.errorMessage || job.error })
          ] }) : null
        ] }),
        /* @__PURE__ */ jsxs("div", { class: "flex flex-col items-end gap-2 ml-4", children: [
          /* @__PURE__ */ jsxs("div", { class: "flex items-center gap-2", children: [
            job.dbStatus ? /* @__PURE__ */ jsx(StatusBadge, { status: job.dbStatus }) : /* @__PURE__ */ jsx(
              "span",
              {
                class: `px-1.5 py-0.5 text-xs font-medium rounded ${job.status === PipelineJobStatus.COMPLETED ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" : job.error ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300"}`,
                children: job.status
              }
            ),
            isActiveJob && /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                class: "font-medium rounded-lg text-xs p-1 text-center inline-flex items-center transition-colors duration-150 ease-in-out",
                title: "Stop this job",
                "x-bind:class": `confirming ? '${confirmingStateClasses}' : '${defaultStateClasses}'`,
                "x-on:click": "\n                if (confirming) {\n                  isStopping = true;\n                  window.confirmationManager.clear($root.id);\n                  fetch('/web/jobs/' + jobId + '/cancel', {\n                    method: 'POST',\n                    headers: { 'Accept': 'application/json' },\n                  })\n                    .then(r => r.json())\n                    .then(() => {\n                      confirming = false;\n                      isStopping = false;\n                      document.dispatchEvent(new CustomEvent('job-list-refresh'));\n                    })\n                    .catch(() => { isStopping = false; });\n                } else {\n                  confirming = true;\n                  isStopping = false;\n                  window.confirmationManager.start($root.id);\n                }\n              ",
                "x-bind:disabled": "isStopping",
                children: [
                  /* @__PURE__ */ jsxs("span", { "x-show": "!confirming && !isStopping", children: [
                    /* @__PURE__ */ jsx(
                      "svg",
                      {
                        class: "w-4 h-4",
                        "aria-hidden": "true",
                        fill: "currentColor",
                        viewBox: "0 0 20 20",
                        children: /* @__PURE__ */ jsx("rect", { x: "5", y: "5", width: "10", height: "10", rx: "2" })
                      }
                    ),
                    /* @__PURE__ */ jsx("span", { class: "sr-only", children: "Stop job" })
                  ] }),
                  /* @__PURE__ */ jsx("span", { "x-show": "confirming && !isStopping", class: "px-2", children: "Cancel?" }),
                  /* @__PURE__ */ jsxs("span", { "x-show": "isStopping", children: [
                    /* @__PURE__ */ jsx(LoadingSpinner, {}),
                    /* @__PURE__ */ jsx("span", { class: "sr-only", children: "Stopping..." })
                  ] })
                ]
              }
            )
          ] }),
          job.error ? (
            // Keep the error badge for clarity if an error occurred
            /* @__PURE__ */ jsx("span", { class: "bg-red-100 text-red-800 text-xs font-medium px-1.5 py-0.5 rounded dark:bg-red-900 dark:text-red-300", children: "Error" })
          ) : null
        ] })
      ] })
    }
  );
};
const JobList = ({ jobs }) => {
  const hasJobs = jobs.length > 0;
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("div", { id: "job-list", class: "space-y-2 animate-[fadeSlideIn_0.2s_ease-out]", children: hasJobs ? jobs.map((job) => /* @__PURE__ */ jsx(JobItem, { job })) : /* @__PURE__ */ jsx("p", { class: "text-center text-gray-500 dark:text-gray-400", children: "No pending jobs." }) }),
    /* @__PURE__ */ jsx(
      "button",
      {
        id: "clear-completed-btn",
        "hx-swap-oob": "true",
        type: "button",
        class: `text-xs px-3 py-1.5 rounded-lg focus:ring-4 focus:outline-none transition-colors duration-150 ${hasJobs ? "text-gray-700 bg-gray-100 border border-gray-300 hover:bg-gray-200 focus:ring-gray-100 dark:bg-gray-600 dark:text-gray-300 dark:border-gray-500 dark:hover:bg-gray-700 dark:focus:ring-gray-700" : "text-gray-400 bg-gray-50 border border-gray-200 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500 dark:border-gray-600"}`,
        title: "Clear all completed, cancelled, and failed jobs",
        "hx-post": "/web/jobs/clear-completed",
        "hx-trigger": "click",
        "hx-on": "htmx:afterRequest: document.dispatchEvent(new Event('job-list-refresh'))",
        "hx-swap": "none",
        disabled: !hasJobs,
        children: "Clear Completed Jobs"
      }
    )
  ] });
};
function registerJobListRoutes(server, listJobsTool) {
  server.get("/web/jobs", async () => {
    const result = await listJobsTool.execute({});
    return /* @__PURE__ */ jsx(JobList, { jobs: result.jobs });
  });
}
const AddVersionButton = ({ libraryName }) => {
  return /* @__PURE__ */ jsx(
    PrimaryButton,
    {
      "hx-get": `/web/libraries/${encodeURIComponent(libraryName)}/add-version-form`,
      "hx-target": "#add-version-form-container",
      "hx-swap": "innerHTML",
      children: "Add New Version"
    }
  );
};
const Alert = ({ type, title, message }) => {
  let iconSvg;
  let colorClasses;
  let defaultTitle;
  switch (type) {
    case "success":
      defaultTitle = "Success:";
      colorClasses = "text-green-800 border-green-300 bg-green-50 dark:bg-gray-800 dark:text-green-400 dark:border-green-800";
      iconSvg = /* @__PURE__ */ jsx(
        "svg",
        {
          class: "shrink-0 inline w-4 h-4 me-3",
          "aria-hidden": "true",
          xmlns: "http://www.w3.org/2000/svg",
          fill: "currentColor",
          viewBox: "0 0 20 20",
          children: /* @__PURE__ */ jsx("path", { d: "M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5Zm9.5 9.5A9.5 9.5 0 0 1 10 19a9.46 9.46 0 0 1-1.671-.14c-.165-.05-.3-.19-.42-.335l-.165-.165c-.19-.2-.3-.425-.3-.655A4.2 4.2 0 0 1 4.5 10a4.25 4.25 0 0 1 7.462-2.882l1.217 1.217a3.175 3.175 0 0 0 4.5.01l.106-.106a.934.934 0 0 0 .1-.36ZM10 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" })
        }
      );
      break;
    case "error":
      defaultTitle = "Error:";
      colorClasses = "text-red-800 border-red-300 bg-red-50 dark:bg-gray-800 dark:text-red-400 dark:border-red-800";
      iconSvg = /* @__PURE__ */ jsx(
        "svg",
        {
          class: "shrink-0 inline w-4 h-4 me-3",
          "aria-hidden": "true",
          xmlns: "http://www.w3.org/2000/svg",
          fill: "currentColor",
          viewBox: "0 0 20 20",
          children: /* @__PURE__ */ jsx("path", { d: "M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM9.5 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 15H8a1 1 0 0 1 0-2h1v-3h-1a1 1 0 0 1 0-2h2a1 1 0 0 1 1 1v4h1a1 1 0 0 1 0 2Z" })
        }
      );
      break;
    case "warning":
      defaultTitle = "Warning:";
      colorClasses = "text-yellow-800 border-yellow-300 bg-yellow-50 dark:bg-gray-800 dark:text-yellow-300 dark:border-yellow-800";
      iconSvg = /* @__PURE__ */ jsx(
        "svg",
        {
          class: "shrink-0 inline w-4 h-4 me-3",
          "aria-hidden": "true",
          xmlns: "http://www.w3.org/2000/svg",
          fill: "currentColor",
          viewBox: "0 0 20 20",
          children: /* @__PURE__ */ jsx("path", { d: "M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM9.5 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 15H8a1 1 0 0 1 0-2h1v-3h-1a1 1 0 0 1 0-2h2a1 1 0 0 1 1 1v4h1a1 1 0 0 1 0 2Z" })
        }
      );
      break;
    case "info":
    default:
      defaultTitle = "Info:";
      colorClasses = "text-blue-800 border-blue-300 bg-blue-50 dark:bg-gray-800 dark:text-blue-400 dark:border-blue-800";
      iconSvg = /* @__PURE__ */ jsx(
        "svg",
        {
          class: "shrink-0 inline w-4 h-4 me-3",
          "aria-hidden": "true",
          xmlns: "http://www.w3.org/2000/svg",
          fill: "currentColor",
          viewBox: "0 0 20 20",
          children: /* @__PURE__ */ jsx("path", { d: "M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM9.5 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 15H8a1 1 0 0 1 0-2h1v-3H8a1 1 0 0 1 0-2h2a1 1 0 0 1 1 1v4h1a1 1 0 0 1 0 2Z" })
        }
      );
      break;
  }
  const displayTitle = title ?? defaultTitle;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      class: `flex items-center p-4 mb-4 text-sm border rounded-lg ${colorClasses}`,
      role: "alert",
      children: [
        iconSvg,
        /* @__PURE__ */ jsx("span", { class: "sr-only", children: "Info" }),
        /* @__PURE__ */ jsxs("div", { children: [
          displayTitle ? /* @__PURE__ */ jsx("span", { class: "font-medium", safe: true, children: displayTitle }) : null,
          " ",
          message
        ] })
      ]
    }
  );
};
const Tooltip = ({ text, position = "top" }) => {
  const positionClasses = {
    top: "bottom-full left-1/2 transform -translate-x-1/2 -translate-y-1 mb-1",
    right: "left-full top-1/2 transform -translate-y-1/2 translate-x-1 ml-1",
    bottom: "top-full left-1/2 transform -translate-x-1/2 translate-y-1 mt-1",
    left: "right-full top-1/2 transform -translate-y-1/2 -translate-x-1 mr-1"
  };
  return /* @__PURE__ */ jsxs(
    "div",
    {
      class: "relative ml-1.5 flex items-center",
      "x-data": "{ isVisible: false }",
      children: [
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            class: "text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400 focus:outline-none flex items-center",
            "aria-label": "Help",
            "x-on:mouseenter": "isVisible = true",
            "x-on:mouseleave": "isVisible = false",
            "x-on:focus": "isVisible = true",
            "x-on:blur": "isVisible = false",
            tabindex: "0",
            children: /* @__PURE__ */ jsx(
              "svg",
              {
                xmlns: "http://www.w3.org/2000/svg",
                fill: "none",
                viewBox: "0 0 24 24",
                "stroke-width": "1.5",
                stroke: "currentColor",
                class: "w-4 h-4",
                children: /* @__PURE__ */ jsx(
                  "path",
                  {
                    "stroke-linecap": "round",
                    "stroke-linejoin": "round",
                    d: "M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"
                  }
                )
              }
            )
          }
        ),
        /* @__PURE__ */ jsx(
          "div",
          {
            "x-show": "isVisible",
            "x-cloak": true,
            class: `absolute z-10 w-64 p-2 text-sm text-gray-500 bg-white border border-gray-200 rounded-lg shadow-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-400 ${positionClasses[position]}`,
            children: text
          }
        )
      ]
    }
  );
};
const ScrapeFormContent = ({
  defaultExcludePatterns,
  initialValues,
  mode = "new",
  scraperConfig
}) => {
  const isAddVersionMode = mode === "add-version";
  const urlValue = initialValues?.url || "";
  const libraryValue = initialValues?.library || "";
  const maxPagesValue = initialValues?.maxPages?.toString() || "";
  const maxDepthValue = initialValues?.maxDepth?.toString() || "";
  const scopeValue = initialValues?.scope || "subpages";
  const includePatternsValue = initialValues?.includePatterns || "";
  const scrapeModeValue = initialValues?.scrapeMode || ScrapeMode.Auto;
  const followRedirectsValue = initialValues?.followRedirects ?? true;
  const ignoreErrorsValue = initialValues?.ignoreErrors ?? true;
  const excludePatternsText = initialValues?.excludePatterns !== void 0 ? initialValues.excludePatterns : defaultExcludePatterns?.join("\n") || "";
  const headersJson = JSON.stringify(initialValues?.headers || []);
  const closeButtonAttrs = isAddVersionMode ? {
    "hx-get": `/web/libraries/${encodeURIComponent(libraryValue)}/add-version-button`,
    "hx-target": "#add-version-form-container",
    "hx-swap": "innerHTML"
  } : {
    "hx-get": "/web/jobs/new-button",
    "hx-target": "#addJobForm",
    "hx-swap": "innerHTML"
  };
  const formTarget = isAddVersionMode ? "#add-version-form-container" : "#addJobForm";
  const title = isAddVersionMode ? "Add New Version" : "Add New Documentation";
  return /* @__PURE__ */ jsxs("div", { class: "mt-4 p-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-300 dark:border-gray-600 relative animate-[fadeSlideIn_0.2s_ease-out]", children: [
    /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        ...closeButtonAttrs,
        class: "absolute top-3 right-3 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-150",
        title: "Close",
        children: /* @__PURE__ */ jsx(
          "svg",
          {
            class: "w-5 h-5",
            fill: "none",
            stroke: "currentColor",
            viewBox: "0 0 24 24",
            xmlns: "http://www.w3.org/2000/svg",
            children: /* @__PURE__ */ jsx(
              "path",
              {
                "stroke-linecap": "round",
                "stroke-linejoin": "round",
                "stroke-width": "2",
                d: "M6 18L18 6M6 6l12 12"
              }
            )
          }
        )
      }
    ),
    /* @__PURE__ */ jsx("h3", { class: "text-xl font-semibold text-gray-900 dark:text-white mb-2 pr-8", children: title }),
    /* @__PURE__ */ jsxs(
      "form",
      {
        "hx-post": "/web/jobs/scrape",
        "hx-target": formTarget,
        "hx-swap": "innerHTML",
        class: "space-y-2",
        "data-initial-url": urlValue,
        "data-initial-headers": headersJson,
        "x-data": "{\n          url: '',\n          hasPath: false,\n          headers: [],\n          checkUrlPath() {\n            try {\n              const url = new URL(this.url);\n              this.hasPath = url.pathname !== '/' && url.pathname !== '';\n            } catch (e) {\n              this.hasPath = false;\n            }\n          }\n        }",
        "x-init": "\n          url = $el.dataset.initialUrl || '';\n          headers = JSON.parse($el.dataset.initialHeaders || '[]');\n          checkUrlPath();\n        ",
        children: [
          /* @__PURE__ */ jsx("input", { type: "hidden", name: "formMode", value: mode }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsxs("div", { class: "flex items-center", children: [
              /* @__PURE__ */ jsx(
                "label",
                {
                  for: "url",
                  class: "block text-sm font-medium text-gray-700 dark:text-gray-300",
                  children: "URL"
                }
              ),
              /* @__PURE__ */ jsx(
                Tooltip,
                {
                  text: /* @__PURE__ */ jsxs("div", { children: [
                    /* @__PURE__ */ jsx("p", { children: "Enter the URL of the documentation you want to scrape." }),
                    /* @__PURE__ */ jsxs("p", { class: "mt-2", children: [
                      "For local files/folders, you must use the",
                      " ",
                      /* @__PURE__ */ jsx("code", { children: "file://" }),
                      " prefix and ensure the path is accessible to the server."
                    ] }),
                    /* @__PURE__ */ jsxs("p", { class: "mt-2", children: [
                      "If running in Docker, ",
                      /* @__PURE__ */ jsx("b", { children: "mount the folder" }),
                      " (see README for details)."
                    ] })
                  ] })
                }
              )
            ] }),
            /* @__PURE__ */ jsx(
              "input",
              {
                type: "url",
                name: "url",
                id: "url",
                required: true,
                "x-model": "url",
                "x-on:input": "checkUrlPath",
                "x-on:paste": "$nextTick(() => checkUrlPath())",
                placeholder: "https://docs.example.com/library/",
                class: "mt-0.5 block w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              }
            ),
            /* @__PURE__ */ jsx(
              "div",
              {
                "x-show": "hasPath && !(url.startsWith('file://'))",
                "x-cloak": true,
                "x-transition:enter": "transition ease-out duration-300",
                "x-transition:enter-start": "opacity-0 transform -translate-y-2",
                "x-transition:enter-end": "opacity-100 transform translate-y-0",
                class: "mt-2",
                children: /* @__PURE__ */ jsx(
                  Alert,
                  {
                    type: "info",
                    message: "By default, only subpages under the given URL will be scraped. To scrape the whole website, adjust the 'Scope' option in Advanced Options."
                  }
                )
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsxs("div", { class: "flex items-center", children: [
              /* @__PURE__ */ jsx(
                "label",
                {
                  for: "library",
                  class: "block text-sm font-medium text-gray-700 dark:text-gray-300",
                  children: "Library Name"
                }
              ),
              /* @__PURE__ */ jsx(Tooltip, { text: "The name of the library you're documenting. This will be used when searching." })
            ] }),
            isAddVersionMode ? /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsx("input", { type: "hidden", name: "library", value: libraryValue }),
              /* @__PURE__ */ jsx("div", { class: "mt-0.5 px-2 py-1 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md border border-gray-300 dark:border-gray-600", children: /* @__PURE__ */ jsx("span", { safe: true, children: libraryValue }) })
            ] }) : /* @__PURE__ */ jsx(
              "input",
              {
                type: "text",
                name: "library",
                id: "library",
                required: true,
                value: libraryValue,
                placeholder: "e.g. react, vue, express",
                class: "mt-0.5 block w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsxs("div", { class: "flex items-center", children: [
              /* @__PURE__ */ jsx(
                "label",
                {
                  for: "version",
                  class: "block text-sm font-medium text-gray-700 dark:text-gray-300",
                  children: "Version (optional)"
                }
              ),
              /* @__PURE__ */ jsx(Tooltip, { text: "Specify the version of the library documentation you're indexing (e.g. 2.0.0). Leave empty or enter 'latest' to index without a specific version. This allows for version-specific searches." })
            ] }),
            /* @__PURE__ */ jsx(
              "input",
              {
                type: "text",
                name: "version",
                id: "version",
                placeholder: "e.g. 2.0.0 or leave empty for latest",
                class: "mt-0.5 block w-full max-w-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              }
            )
          ] }),
          /* @__PURE__ */ jsxs(
            "div",
            {
              class: "bg-gray-50 dark:bg-gray-900 p-2 rounded-md",
              "data-should-open": isAddVersionMode && (maxPagesValue || maxDepthValue || scopeValue !== "subpages" || includePatternsValue || excludePatternsText || scrapeModeValue !== ScrapeMode.Auto) ? "true" : "false",
              "x-data": "{ open: false }",
              "x-init": "open = $el.dataset.shouldOpen === 'true'",
              children: [
                /* @__PURE__ */ jsxs(
                  "button",
                  {
                    type: "button",
                    class: "w-full flex items-center gap-1.5 cursor-pointer text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors",
                    "x-on:click": "open = !open",
                    children: [
                      /* @__PURE__ */ jsx(
                        "svg",
                        {
                          class: "w-4 h-4 transform transition-transform duration-200",
                          "x-bind:class": "{ 'rotate-90': open }",
                          fill: "none",
                          stroke: "currentColor",
                          viewBox: "0 0 24 24",
                          children: /* @__PURE__ */ jsx(
                            "path",
                            {
                              "stroke-linecap": "round",
                              "stroke-linejoin": "round",
                              "stroke-width": "2",
                              d: "M9 5l7 7-7 7"
                            }
                          )
                        }
                      ),
                      /* @__PURE__ */ jsx("span", { children: "Advanced Options" })
                    ]
                  }
                ),
                /* @__PURE__ */ jsxs("div", { "x-show": "open", "x-cloak": true, "x-collapse": true, class: "mt-2 space-y-2", children: [
                  /* @__PURE__ */ jsxs("div", { children: [
                    /* @__PURE__ */ jsxs("div", { class: "flex items-center", children: [
                      /* @__PURE__ */ jsx(
                        "label",
                        {
                          for: "maxPages",
                          class: "block text-sm font-medium text-gray-700 dark:text-gray-300",
                          children: "Max Pages"
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        Tooltip,
                        {
                          text: `The maximum number of pages to scrape. Default is ${scraperConfig?.maxPages ?? 1e3}. Setting this too high may result in longer processing times.`
                        }
                      )
                    ] }),
                    /* @__PURE__ */ jsx(
                      "input",
                      {
                        type: "number",
                        name: "maxPages",
                        id: "maxPages",
                        min: "1",
                        placeholder: scraperConfig?.maxPages?.toString() || "1000",
                        value: maxPagesValue,
                        class: "mt-0.5 block w-full max-w-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      }
                    )
                  ] }),
                  /* @__PURE__ */ jsxs("div", { children: [
                    /* @__PURE__ */ jsxs("div", { class: "flex items-center", children: [
                      /* @__PURE__ */ jsx(
                        "label",
                        {
                          for: "maxDepth",
                          class: "block text-sm font-medium text-gray-700 dark:text-gray-300",
                          children: "Max Depth"
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        Tooltip,
                        {
                          text: `How many links deep the scraper should follow. Default is ${scraperConfig?.maxDepth || 3}. Higher values capture more content but increase processing time.`
                        }
                      )
                    ] }),
                    /* @__PURE__ */ jsx(
                      "input",
                      {
                        type: "number",
                        name: "maxDepth",
                        id: "maxDepth",
                        min: "0",
                        placeholder: scraperConfig?.maxDepth?.toString() || "3",
                        value: maxDepthValue,
                        class: "mt-0.5 block w-full max-w-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      }
                    )
                  ] }),
                  /* @__PURE__ */ jsxs("div", { children: [
                    /* @__PURE__ */ jsxs("div", { class: "flex items-center", children: [
                      /* @__PURE__ */ jsx(
                        "label",
                        {
                          for: "scope",
                          class: "block text-sm font-medium text-gray-700 dark:text-gray-300",
                          children: "Scope"
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        Tooltip,
                        {
                          text: /* @__PURE__ */ jsxs("div", { children: [
                            "Controls which pages are scraped:",
                            /* @__PURE__ */ jsxs("ul", { class: "list-disc pl-5", children: [
                              /* @__PURE__ */ jsx("li", { children: "'Subpages' only scrapes under the given URL path," }),
                              /* @__PURE__ */ jsx("li", { children: "'Hostname' scrapes all content on the same host (e.g., all of docs.example.com)," }),
                              /* @__PURE__ */ jsx("li", { children: "'Domain' scrapes all content on the domain and its subdomains (e.g., all of example.com)." })
                            ] })
                          ] })
                        }
                      )
                    ] }),
                    /* @__PURE__ */ jsxs(
                      "select",
                      {
                        name: "scope",
                        id: "scope",
                        class: "mt-0.5 block w-full max-w-sm pl-2 pr-10 py-1 text-base border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white",
                        children: [
                          /* @__PURE__ */ jsx("option", { value: "subpages", selected: scopeValue === "subpages", children: "Subpages (Default)" }),
                          /* @__PURE__ */ jsx("option", { value: "hostname", selected: scopeValue === "hostname", children: "Hostname" }),
                          /* @__PURE__ */ jsx("option", { value: "domain", selected: scopeValue === "domain", children: "Domain" })
                        ]
                      }
                    )
                  ] }),
                  /* @__PURE__ */ jsxs("div", { children: [
                    /* @__PURE__ */ jsxs("div", { class: "flex items-center", children: [
                      /* @__PURE__ */ jsx(
                        "label",
                        {
                          for: "includePatterns",
                          class: "block text-sm font-medium text-gray-700 dark:text-gray-300",
                          children: "Include Patterns"
                        }
                      ),
                      /* @__PURE__ */ jsx(Tooltip, { text: "Glob or regex patterns for URLs to include. One per line or comma-separated. Regex patterns must be wrapped in slashes, e.g. /pattern/." })
                    ] }),
                    /* @__PURE__ */ jsx(
                      "textarea",
                      {
                        name: "includePatterns",
                        id: "includePatterns",
                        rows: "2",
                        placeholder: "e.g. docs/* or /api\\/v1.*/",
                        class: "mt-0.5 block w-full max-w-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white",
                        safe: true,
                        children: includePatternsValue
                      }
                    )
                  ] }),
                  /* @__PURE__ */ jsxs("div", { children: [
                    /* @__PURE__ */ jsxs("div", { class: "flex items-center", children: [
                      /* @__PURE__ */ jsx(
                        "label",
                        {
                          for: "excludePatterns",
                          class: "block text-sm font-medium text-gray-700 dark:text-gray-300",
                          children: "Exclude Patterns"
                        }
                      ),
                      /* @__PURE__ */ jsx(Tooltip, { text: "Glob or regex patterns for URLs to exclude. One per line or comma-separated. Exclude takes precedence over include. Regex patterns must be wrapped in slashes, e.g. /pattern/. Edit or clear this field to customize exclusions." })
                    ] }),
                    /* @__PURE__ */ jsx(
                      "textarea",
                      {
                        name: "excludePatterns",
                        id: "excludePatterns",
                        rows: "5",
                        safe: true,
                        class: "mt-0.5 block w-full max-w-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-xs",
                        children: excludePatternsText
                      }
                    ),
                    /* @__PURE__ */ jsx("p", { class: "mt-1 text-xs text-gray-500 dark:text-gray-400", children: isAddVersionMode ? "Patterns from previous version. Edit as needed." : "Default patterns are pre-filled. Edit to customize or clear to exclude nothing." })
                  ] }),
                  /* @__PURE__ */ jsxs("div", { children: [
                    /* @__PURE__ */ jsxs("div", { class: "flex items-center", children: [
                      /* @__PURE__ */ jsx(
                        "label",
                        {
                          for: "scrapeMode",
                          class: "block text-sm font-medium text-gray-700 dark:text-gray-300",
                          children: "Scrape Mode"
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        Tooltip,
                        {
                          text: /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsxs("ul", { class: "list-disc pl-5", children: [
                            /* @__PURE__ */ jsx("li", { children: "'Auto' automatically selects the best method," }),
                            /* @__PURE__ */ jsx("li", { children: "'Fetch' uses simple HTTP requests (faster but may miss dynamic content)," }),
                            /* @__PURE__ */ jsx("li", { children: "'Playwright' uses a headless browser (slower but better for JS-heavy sites)." })
                          ] }) })
                        }
                      )
                    ] }),
                    /* @__PURE__ */ jsxs(
                      "select",
                      {
                        name: "scrapeMode",
                        id: "scrapeMode",
                        class: "mt-0.5 block w-full max-w-sm pl-2 pr-10 py-1 text-base border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white",
                        children: [
                          /* @__PURE__ */ jsx(
                            "option",
                            {
                              value: ScrapeMode.Auto,
                              selected: scrapeModeValue === ScrapeMode.Auto,
                              children: "Auto (Default)"
                            }
                          ),
                          /* @__PURE__ */ jsx(
                            "option",
                            {
                              value: ScrapeMode.Fetch,
                              selected: scrapeModeValue === ScrapeMode.Fetch,
                              children: "Fetch"
                            }
                          ),
                          /* @__PURE__ */ jsx(
                            "option",
                            {
                              value: ScrapeMode.Playwright,
                              selected: scrapeModeValue === ScrapeMode.Playwright,
                              children: "Playwright"
                            }
                          )
                        ]
                      }
                    )
                  ] }),
                  /* @__PURE__ */ jsxs("div", { children: [
                    /* @__PURE__ */ jsxs("div", { class: "flex items-center mb-1", children: [
                      /* @__PURE__ */ jsx("label", { class: "block text-sm font-medium text-gray-700 dark:text-gray-300", children: "Custom HTTP Headers" }),
                      /* @__PURE__ */ jsx(Tooltip, { text: "Add custom HTTP headers (e.g., for authentication). These will be sent with every HTTP request." })
                    ] }),
                    /* @__PURE__ */ jsxs("div", { children: [
                      /* @__PURE__ */ jsx("template", { "x-for": "(header, idx) in headers", children: /* @__PURE__ */ jsxs("div", { class: "flex space-x-2 mb-1", children: [
                        /* @__PURE__ */ jsx(
                          "input",
                          {
                            type: "text",
                            class: "w-1/3 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs",
                            placeholder: "Header Name",
                            "x-model": "header.name",
                            required: true
                          }
                        ),
                        /* @__PURE__ */ jsx("span", { class: "text-gray-500", children: ":" }),
                        /* @__PURE__ */ jsx(
                          "input",
                          {
                            type: "text",
                            class: "w-1/2 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs",
                            placeholder: "Header Value",
                            "x-model": "header.value",
                            required: true
                          }
                        ),
                        /* @__PURE__ */ jsx(
                          "button",
                          {
                            type: "button",
                            class: "text-red-500 hover:text-red-700 text-xs",
                            "x-on:click": "headers.splice(idx, 1)",
                            children: "Remove"
                          }
                        ),
                        /* @__PURE__ */ jsx(
                          "input",
                          {
                            type: "hidden",
                            name: "header[]",
                            "x-bind:value": "header.name && header.value ? header.name + ':' + header.value : ''"
                          }
                        )
                      ] }) }),
                      /* @__PURE__ */ jsx(
                        "button",
                        {
                          type: "button",
                          class: "mt-1 px-2 py-0.5 bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-200 rounded text-xs",
                          "x-on:click": "headers.push({ name: '', value: '' })",
                          children: "+ Add Header"
                        }
                      )
                    ] })
                  ] }),
                  /* @__PURE__ */ jsxs("div", { class: "flex items-center", children: [
                    /* @__PURE__ */ jsx(
                      "input",
                      {
                        id: "followRedirects",
                        name: "followRedirects",
                        type: "checkbox",
                        checked: followRedirectsValue,
                        class: "h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                      }
                    ),
                    /* @__PURE__ */ jsx(
                      "label",
                      {
                        for: "followRedirects",
                        class: "ml-1 block text-sm text-gray-900 dark:text-gray-300",
                        children: "Follow Redirects"
                      }
                    )
                  ] }),
                  /* @__PURE__ */ jsxs("div", { class: "flex items-center", children: [
                    /* @__PURE__ */ jsx(
                      "input",
                      {
                        id: "ignoreErrors",
                        name: "ignoreErrors",
                        type: "checkbox",
                        checked: ignoreErrorsValue,
                        class: "h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                      }
                    ),
                    /* @__PURE__ */ jsx(
                      "label",
                      {
                        for: "ignoreErrors",
                        class: "ml-1 block text-sm text-gray-900 dark:text-gray-300",
                        children: "Ignore Errors During Scraping"
                      }
                    )
                  ] })
                ] })
              ]
            }
          ),
          /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsx(
            "button",
            {
              type: "submit",
              class: "w-full flex justify-center py-1.5 px-3 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500",
              children: "Start Indexing"
            }
          ) })
        ]
      }
    ),
    /* @__PURE__ */ jsx("div", { id: "job-response", class: "mt-2 text-sm" })
  ] });
};
const ScrapeForm = ({
  defaultExcludePatterns,
  scraperConfig
}) => /* @__PURE__ */ jsx("div", { id: "scrape-form-container", class: "animate-[fadeSlideIn_0.2s_ease-out]", children: /* @__PURE__ */ jsx(
  ScrapeFormContent,
  {
    defaultExcludePatterns,
    scraperConfig
  }
) });
const DEFAULT_FILE_EXCLUSIONS = [
  // CHANGELOG files (case variations)
  "**/CHANGELOG.md",
  "**/changelog.md",
  "**/CHANGELOG.mdx",
  "**/changelog.mdx",
  // LICENSE files (case variations)
  "**/LICENSE",
  "**/LICENSE.md",
  "**/license.md",
  // CODE_OF_CONDUCT files (case variations)
  "**/CODE_OF_CONDUCT.md",
  "**/code_of_conduct.md",
  // Test files
  "**/*.test.*",
  "**/*.spec.*",
  "**/*_test.py",
  "**/*_test.go",
  // Package manager lock files
  "**/*.lock",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/go.sum",
  // Build artifacts
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
  "**/*.d.ts",
  // IDE/System files
  "**/.DS_Store",
  "**/Thumbs.db",
  "**/*.swp",
  "**/*.swo",
  // Internal config files (using regex pattern)
  "/.*\\.(ini|cfg|conf|log|pid)$/"
];
const DEFAULT_FOLDER_EXCLUSIONS = [
  // Archive and deprecated content (matches anywhere in path)
  "**/archive/**",
  "**/archived/**",
  "**/deprecated/**",
  "**/legacy/**",
  "**/old/**",
  "**/outdated/**",
  "**/previous/**",
  "**/superseded/**",
  // Specific paths that don't follow the general pattern
  "docs/old/**",
  // Test directories
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/spec/**",
  // Build output directories
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/target/**",
  "**/.next/**",
  "**/.nuxt/**",
  // IDE directories
  "**/.vscode/**",
  "**/.idea/**",
  // Internationalization folders - non-English locales
  "**/i18n/ar*/**",
  "**/i18n/de*/**",
  "**/i18n/es*/**",
  "**/i18n/fr*/**",
  "**/i18n/hi*/**",
  "**/i18n/it*/**",
  "**/i18n/ja*/**",
  "**/i18n/ko*/**",
  "**/i18n/nl*/**",
  "**/i18n/pl*/**",
  "**/i18n/pt*/**",
  "**/i18n/ru*/**",
  "**/i18n/sv*/**",
  "**/i18n/th*/**",
  "**/i18n/tr*/**",
  "**/i18n/vi*/**",
  "**/i18n/zh*/**",
  // Common locale folder patterns
  "**/zh-cn/**",
  "**/zh-hk/**",
  "**/zh-mo/**",
  "**/zh-sg/**",
  "**/zh-tw/**"
];
const DEFAULT_EXCLUSION_PATTERNS = [
  ...DEFAULT_FILE_EXCLUSIONS,
  ...DEFAULT_FOLDER_EXCLUSIONS
];
function getEffectiveExclusionPatterns(userPatterns) {
  if (userPatterns !== void 0) {
    return userPatterns;
  }
  return DEFAULT_EXCLUSION_PATTERNS;
}
function registerNewJobRoutes(server, scrapeTool, scraperConfig) {
  server.get("/web/jobs/new", async () => {
    return /* @__PURE__ */ jsx(
      ScrapeForm,
      {
        defaultExcludePatterns: DEFAULT_EXCLUSION_PATTERNS,
        scraperConfig
      }
    );
  });
  server.get("/web/jobs/new-button", async () => {
    return /* @__PURE__ */ jsx(AddJobButton, {});
  });
  server.post(
    "/web/jobs/scrape",
    async (request, reply) => {
      const body = request.body;
      reply.type("text/html");
      try {
        let parsePatterns = function(input) {
          if (!input) return void 0;
          return input.split(/\n|,/).map((s) => s.trim()).filter((s) => s.length > 0);
        }, parseHeaders2 = function(input) {
          if (!input) return void 0;
          const arr = Array.isArray(input) ? input : [input];
          const headers = {};
          for (const entry of arr) {
            const idx = entry.indexOf(":");
            if (idx > 0) {
              const name = entry.slice(0, idx).trim();
              const value = entry.slice(idx + 1).trim();
              if (name) headers[name] = value;
            }
          }
          return Object.keys(headers).length > 0 ? headers : void 0;
        };
        if (!body.url || !body.library) {
          reply.status(400);
          return /* @__PURE__ */ jsx(
            Alert,
            {
              type: "error",
              title: "Validation Error:",
              message: "URL and Library Name are required."
            }
          );
        }
        const normalizedVersion = !body.version || body.version.trim() === "" || body.version.trim().toLowerCase() === "latest" ? null : body.version.trim();
        const scrapeOptions = {
          url: body.url,
          library: body.library,
          version: normalizedVersion,
          waitForCompletion: false,
          // Don't wait in UI
          options: {
            maxPages: body.maxPages ? Number.parseInt(body.maxPages, 10) : void 0,
            maxDepth: body.maxDepth ? Number.parseInt(body.maxDepth, 10) : void 0,
            scope: body.scope,
            scrapeMode: body.scrapeMode,
            // Checkboxes send 'on' when checked, otherwise undefined
            followRedirects: body.followRedirects === "on",
            ignoreErrors: body.ignoreErrors === "on",
            includePatterns: parsePatterns(body.includePatterns),
            excludePatterns: parsePatterns(body.excludePatterns),
            headers: parseHeaders2(body["header[]"])
            // <-- propagate custom headers from web UI
          }
        };
        const result = await scrapeTool.execute(scrapeOptions);
        if ("jobId" in result) {
          const versionDisplay = normalizedVersion || "latest";
          reply.header(
            "HX-Trigger",
            JSON.stringify({
              toast: {
                message: `Indexing started for ${body.library}@${versionDisplay}`,
                type: "success"
              }
            })
          );
          if (body.formMode === "add-version") {
            return /* @__PURE__ */ jsx(AddVersionButton, { libraryName: body.library });
          }
          return /* @__PURE__ */ jsx(AddJobButton, {});
        }
        return /* @__PURE__ */ jsx(Alert, { type: "warning", message: "Job finished unexpectedly quickly." });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(`❌ Scrape job submission failed: ${error}`);
        if (error instanceof ValidationError) {
          reply.status(400);
        } else {
          reply.status(500);
        }
        return /* @__PURE__ */ jsx(
          Alert,
          {
            type: "error",
            title: "Error:",
            message: /* @__PURE__ */ jsx("span", { safe: true, children: errorMessage })
          }
        );
      }
    }
  );
}
const VersionDetailsRow = ({
  version,
  libraryName,
  showDelete = true,
  showRefresh = false
}) => {
  const indexedDate = version.indexedAt ? new Date(version.indexedAt).toLocaleDateString() : "N/A";
  const versionLabel = version.ref.version || "Latest";
  const versionParam = version.ref.version || "";
  const sanitizedLibraryName = libraryName.replace(/[^a-zA-Z0-9-_]/g, "-");
  const sanitizedVersionParam = versionParam.replace(/[^a-zA-Z0-9-_]/g, "-");
  const rowId = `row-${sanitizedLibraryName}-${sanitizedVersionParam}`;
  const initialIsRefreshing = isActiveStatus(version.status);
  const defaultStateClasses = "text-red-700 border border-red-700 hover:bg-red-700 hover:text-white focus:ring-4 focus:outline-none focus:ring-red-300 dark:border-red-500 dark:text-red-500 dark:hover:text-white dark:focus:ring-red-800 dark:hover:bg-red-500";
  const confirmingStateClasses = "bg-red-600 text-white border-red-600 focus:ring-4 focus:outline-none focus:ring-red-300 dark:bg-red-700 dark:border-red-700 dark:focus:ring-red-800";
  return (
    // Use flexbox for layout, add border between rows
    /* @__PURE__ */ jsxs(
      "div",
      {
        id: rowId,
        class: "flex justify-between items-center py-1 border-b border-gray-200 dark:border-gray-600 last:border-b-0",
        "data-library-name": libraryName,
        "data-version-param": versionParam,
        "data-is-refreshing": initialIsRefreshing ? "true" : "false",
        "x-data": "{ \n        library: $el.dataset.libraryName, \n        version: $el.dataset.versionParam, \n        confirming: $el.dataset.confirming === 'true', \n        isDeleting: false,\n        isRefreshing: $el.dataset.isRefreshing === 'true',\n        setRefreshing(val) {\n          this.isRefreshing = !!val;\n          this.$el.dataset.isRefreshing = val ? 'true' : 'false';\n        },\n        init() {\n          const rowId = this.$el.id;\n          const myLibrary = this.library;\n          const myVersion = this.version;\n          \n          document.body.addEventListener('job-status-change', (e) => {\n            const job = e.detail;\n            const jobVersion = job.version || '';\n            if (job.library === myLibrary && jobVersion === myVersion) {\n              const newValue = ['queued', 'running'].includes(job.status);\n              const el = document.getElementById(rowId);\n              if (el) {\n                el.dispatchEvent(new CustomEvent('set-refreshing', { detail: newValue, bubbles: true }));\n              }\n            }\n          });\n        }\n      }",
        "x-on:set-refreshing": "setRefreshing($event.detail)",
        children: [
          /* @__PURE__ */ jsx(
            "span",
            {
              class: "text-sm text-gray-900 dark:text-white w-1/4 truncate",
              title: versionLabel,
              children: version.ref.version ? /* @__PURE__ */ jsx(VersionBadge, { version: version.ref.version }) : /* @__PURE__ */ jsx("span", { class: "text-gray-600 dark:text-gray-400", children: "Latest" })
            }
          ),
          /* @__PURE__ */ jsxs("div", { class: "flex space-x-2 text-sm text-gray-600 dark:text-gray-400 w-3/4 justify-end items-center", children: [
            /* @__PURE__ */ jsxs("span", { title: "Number of unique pages indexed", children: [
              "Pages:",
              " ",
              /* @__PURE__ */ jsx("span", { class: "font-semibold", safe: true, children: version.counts.uniqueUrls.toLocaleString() })
            ] }),
            /* @__PURE__ */ jsxs("span", { title: "Number of indexed snippets", children: [
              "Chunks:",
              " ",
              /* @__PURE__ */ jsx("span", { class: "font-semibold", safe: true, children: version.counts.documents.toLocaleString() })
            ] }),
            /* @__PURE__ */ jsxs("span", { title: "Date last indexed", children: [
              "Last Update:",
              " ",
              /* @__PURE__ */ jsx("span", { class: "font-semibold", safe: true, children: indexedDate })
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { class: "flex items-center ml-2 space-x-1", children: [
            showRefresh && /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsx("template", { "x-if": "!isRefreshing", children: /* @__PURE__ */ jsxs(
                "button",
                {
                  type: "button",
                  class: "font-medium rounded-lg text-sm p-1 w-6 h-6 text-center inline-flex items-center justify-center transition-colors duration-150 ease-in-out text-gray-500 border border-gray-300 hover:bg-gray-100 hover:text-gray-700 focus:ring-4 focus:outline-none focus:ring-gray-200 dark:border-gray-600 dark:text-gray-400 dark:hover:text-white dark:focus:ring-gray-700 dark:hover:bg-gray-600",
                  title: "Refresh this version (re-scrape changed pages)",
                  "x-on:click": "\n                  isRefreshing = true;\n                  $root.dataset.isRefreshing = 'true';\n                  $el.dispatchEvent(new CustomEvent('trigger-refresh', { bubbles: true }));\n                ",
                  "hx-post": `/web/libraries/${encodeURIComponent(libraryName)}/versions/${encodeURIComponent(versionParam)}/refresh`,
                  "hx-swap": "none",
                  "hx-trigger": "trigger-refresh",
                  children: [
                    /* @__PURE__ */ jsx(
                      "svg",
                      {
                        class: "w-4 h-4",
                        "aria-hidden": "true",
                        xmlns: "http://www.w3.org/2000/svg",
                        fill: "none",
                        viewBox: "0 0 24 24",
                        children: /* @__PURE__ */ jsx(
                          "path",
                          {
                            stroke: "currentColor",
                            "stroke-linecap": "round",
                            "stroke-linejoin": "round",
                            "stroke-width": "2",
                            d: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          }
                        )
                      }
                    ),
                    /* @__PURE__ */ jsx("span", { class: "sr-only", children: "Refresh version" })
                  ]
                }
              ) }),
              /* @__PURE__ */ jsx("template", { "x-if": "isRefreshing", children: /* @__PURE__ */ jsxs(
                "button",
                {
                  type: "button",
                  class: "font-medium rounded-lg text-sm p-1 w-6 h-6 text-center inline-flex items-center justify-center transition-colors duration-150 ease-in-out text-gray-500 border border-gray-300 dark:border-gray-600 dark:text-gray-400",
                  title: "Refresh in progress...",
                  disabled: true,
                  children: [
                    /* @__PURE__ */ jsx(LoadingSpinner, { class: "text-gray-500 dark:text-gray-400" }),
                    /* @__PURE__ */ jsx("span", { class: "sr-only", children: "Refreshing..." })
                  ]
                }
              ) })
            ] }),
            showDelete && /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                class: "font-medium rounded-lg text-sm p-1 min-w-6 h-6 text-center inline-flex items-center justify-center transition-colors duration-150 ease-in-out",
                title: "Remove this version",
                "x-bind:class": `confirming ? '${confirmingStateClasses}' : '${defaultStateClasses}'`,
                "x-bind:disabled": "isDeleting",
                "x-on:click": "\n              if (confirming) {\n                isDeleting = true;\n                window.confirmationManager.clear($root.id);\n                $el.dispatchEvent(new CustomEvent('confirmed-delete', { bubbles: true }));\n              } else {\n                confirming = true;\n                isDeleting = false;\n                window.confirmationManager.start($root.id);\n              }\n            ",
                "hx-delete": `/web/libraries/${encodeURIComponent(libraryName)}/versions/${encodeURIComponent(versionParam)}`,
                "hx-target": `#${rowId}`,
                "hx-swap": "outerHTML",
                "hx-trigger": "confirmed-delete",
                children: [
                  /* @__PURE__ */ jsxs("span", { "x-show": "!confirming && !isDeleting", children: [
                    /* @__PURE__ */ jsx(
                      "svg",
                      {
                        class: "w-4 h-4",
                        "aria-hidden": "true",
                        xmlns: "http://www.w3.org/2000/svg",
                        fill: "none",
                        viewBox: "0 0 18 20",
                        children: /* @__PURE__ */ jsx(
                          "path",
                          {
                            stroke: "currentColor",
                            "stroke-linecap": "round",
                            "stroke-linejoin": "round",
                            "stroke-width": "2",
                            d: "M1 5h16M7 8v8m4-8v8M7 1h4a1 1 0 0 1 1 1v3H6V2a1 1 0 0 1-1-1ZM3 5h12v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5Z"
                          }
                        )
                      }
                    ),
                    /* @__PURE__ */ jsx("span", { class: "sr-only", children: "Remove version" })
                  ] }),
                  /* @__PURE__ */ jsxs("span", { "x-show": "confirming && !isDeleting", class: "mx-1", children: [
                    "Confirm?",
                    /* @__PURE__ */ jsx("span", { class: "sr-only", children: "Confirm delete" })
                  ] }),
                  /* @__PURE__ */ jsxs("span", { "x-show": "isDeleting", children: [
                    /* @__PURE__ */ jsx(LoadingSpinner, {}),
                    /* @__PURE__ */ jsx("span", { class: "sr-only", children: "Loading..." })
                  ] })
                ]
              }
            )
          ] })
        ]
      }
    )
  );
};
const LibraryDetailCard = ({ library }) => {
  const versions = library.versions || [];
  const latestVersion = versions[0];
  return /* @__PURE__ */ jsxs("div", { class: "block p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-300 dark:border-gray-600 mb-4", children: [
    /* @__PURE__ */ jsx("div", { class: "flex justify-between items-start mb-1", children: /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("h3", { class: "text-lg font-medium text-gray-900 dark:text-white", children: /* @__PURE__ */ jsx("span", { safe: true, children: library.name }) }),
      latestVersion?.sourceUrl ? /* @__PURE__ */ jsx("div", { class: "text-sm text-gray-500 dark:text-gray-400", children: /* @__PURE__ */ jsx(
        "a",
        {
          href: latestVersion.sourceUrl,
          target: "_blank",
          class: "hover:underline",
          safe: true,
          children: latestVersion.sourceUrl
        }
      ) }) : null
    ] }) }),
    /* @__PURE__ */ jsx(
      "div",
      {
        class: "mt-2",
        id: "version-list",
        "hx-get": `/web/libraries/${encodeURIComponent(library.name)}/versions-list`,
        "hx-trigger": "library-change from:body",
        "hx-swap": "morph:innerHTML",
        children: versions.length > 0 ? versions.map((v) => {
          const adapted = {
            id: -1,
            ref: { library: library.name, version: v.version },
            status: v.status,
            progress: v.progress,
            counts: {
              documents: v.documentCount,
              uniqueUrls: v.uniqueUrlCount
            },
            indexedAt: v.indexedAt,
            sourceUrl: v.sourceUrl ?? void 0
          };
          return /* @__PURE__ */ jsx(
            VersionDetailsRow,
            {
              libraryName: library.name,
              version: adapted,
              showDelete: true,
              showRefresh: true
            }
          );
        }) : /* @__PURE__ */ jsx("p", { class: "text-sm text-gray-500 dark:text-gray-400 italic", children: "No versions indexed." })
      }
    ),
    /* @__PURE__ */ jsx("div", { id: "add-version-form-container", class: "mt-4", children: /* @__PURE__ */ jsx(AddVersionButton, { libraryName: library.name }) })
  ] });
};
const LibrarySearchCard = ({ library }) => {
  return /* @__PURE__ */ jsxs("div", { class: "block p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-300 dark:border-gray-600 mb-4", children: [
    /* @__PURE__ */ jsxs("h2", { class: "text-xl font-semibold mb-2 text-gray-900 dark:text-white", safe: true, children: [
      "Search ",
      library.name,
      " Documentation"
    ] }),
    /* @__PURE__ */ jsxs(
      "form",
      {
        "hx-get": `/web/libraries/${encodeURIComponent(library.name)}/search`,
        "hx-target": "#searchResultsContainer .search-results",
        "hx-swap": "innerHTML",
        "hx-indicator": "#searchResultsContainer",
        class: "flex space-x-2",
        children: [
          /* @__PURE__ */ jsxs(
            "select",
            {
              name: "version",
              class: "w-40 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500",
              children: [
                /* @__PURE__ */ jsx("option", { value: "", children: "Latest" }),
                " ",
                library.versions.map((version) => /* @__PURE__ */ jsx("option", { value: version.version || "latest", safe: true, children: version.version || "Latest" }))
              ]
            }
          ),
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "text",
              name: "query",
              placeholder: "Search query...",
              required: true,
              class: "flex-grow bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
            }
          ),
          /* @__PURE__ */ jsxs(
            "button",
            {
              type: "submit",
              class: "text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800 relative",
              children: [
                /* @__PURE__ */ jsx("span", { class: "search-text", children: "Search" }),
                /* @__PURE__ */ jsx("span", { class: "spinner absolute inset-0 flex items-center justify-center", children: /* @__PURE__ */ jsx(LoadingSpinner, {}) })
              ]
            }
          )
        ]
      }
    )
  ] });
};
const SearchResultItem = async ({ result }) => {
  const isMarkdown = result.mimeType ? MimeTypeUtils.isMarkdown(result.mimeType) : true;
  const jsdom = createJSDOM("");
  const purifier = DOMPurify(jsdom.window);
  let contentElement;
  if (isMarkdown) {
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkHtml);
    const file = await processor.process(result.content);
    const rawHtml = String(file);
    const safeHtml = purifier.sanitize(rawHtml);
    contentElement = /* @__PURE__ */ jsx("div", { class: "format dark:format-invert max-w-none", children: safeHtml });
  } else {
    const safeContent = escapeHtml(result.content);
    contentElement = /* @__PURE__ */ jsx("div", { class: "format dark:format-invert max-w-none", children: /* @__PURE__ */ jsx("pre", { children: /* @__PURE__ */ jsx("code", { children: safeContent }) }) });
  }
  return /* @__PURE__ */ jsxs("div", { class: "block px-4 py-2 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-300 dark:border-gray-600 mb-2", children: [
    /* @__PURE__ */ jsxs("div", { class: "text-sm text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-2", children: [
      /* @__PURE__ */ jsx(
        "a",
        {
          href: result.url,
          target: "_blank",
          rel: "noopener noreferrer",
          class: "underline underline-offset-4 flex-1",
          safe: true,
          children: result.url
        }
      ),
      result.mimeType ? /* @__PURE__ */ jsx("span", { class: "text-xs opacity-75 font-mono", safe: true, children: result.mimeType }) : null
    ] }),
    contentElement
  ] });
};
const SearchResultList = ({ results }) => {
  if (results.length === 0) {
    return /* @__PURE__ */ jsx("p", { class: "text-gray-500 dark:text-gray-400 italic", children: "No results found." });
  }
  return /* @__PURE__ */ jsx("div", { class: "space-y-2", children: results.map((result) => /* @__PURE__ */ jsx(SearchResultItem, { result })) });
};
const SearchResultSkeletonItem = () => /* @__PURE__ */ jsxs("div", { class: "block px-4 py-2 bg-white dark:bg-gray-800 rounded-lg shadow-sm mb-2 animate-pulse", children: [
  /* @__PURE__ */ jsx("div", { class: "h-[0.8em] bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2" }),
  /* @__PURE__ */ jsx("div", { class: "h-[0.8em] bg-gray-200 dark:bg-gray-700 rounded w-full mb-2" }),
  /* @__PURE__ */ jsx("div", { class: "h-[0.8em] bg-gray-200 dark:bg-gray-700 rounded w-5/6" })
] });
function registerLibraryDetailRoutes(server, listLibrariesTool, searchTool, scrapeTool, docService) {
  server.get(
    "/libraries/:libraryName",
    async (request, reply) => {
      const { libraryName } = request.params;
      try {
        const result = await listLibrariesTool.execute();
        const libraryInfo = result.libraries.find(
          (lib) => lib.name.toLowerCase() === libraryName.toLowerCase()
        );
        if (!libraryInfo) {
          reply.status(404).send("Library not found");
          return;
        }
        reply.type("text/html; charset=utf-8");
        return "<!DOCTYPE html>" + /* @__PURE__ */ jsxs(Layout, { title: `MCP Docs - ${libraryInfo.name}`, children: [
          /* @__PURE__ */ jsx(LibraryDetailCard, { library: libraryInfo }),
          /* @__PURE__ */ jsx(LibrarySearchCard, { library: libraryInfo }),
          /* @__PURE__ */ jsxs("div", { id: "searchResultsContainer", children: [
            /* @__PURE__ */ jsxs("div", { class: "search-skeleton space-y-2", children: [
              /* @__PURE__ */ jsx(SearchResultSkeletonItem, {}),
              /* @__PURE__ */ jsx(SearchResultSkeletonItem, {}),
              /* @__PURE__ */ jsx(SearchResultSkeletonItem, {})
            ] }),
            /* @__PURE__ */ jsx("div", { class: "search-results" })
          ] })
        ] });
      } catch (error) {
        server.log.error(
          error,
          `Failed to load library details for ${libraryName}`
        );
        reply.status(500).send("Internal Server Error");
      }
    }
  );
  server.get(
    "/web/libraries/:libraryName/search",
    async (request, reply) => {
      const { libraryName } = request.params;
      const { query, version } = request.query;
      if (!query) {
        reply.status(400).send("Search query is required.");
        return;
      }
      const versionParam = version === "latest" ? void 0 : version;
      try {
        const searchResult = await searchTool.execute({
          library: libraryName,
          query,
          version: versionParam,
          limit: 10
          // Limit search results
        });
        reply.type("text/html; charset=utf-8");
        return /* @__PURE__ */ jsx(SearchResultList, { results: searchResult.results });
      } catch (error) {
        server.log.error(error, `Failed to search library ${libraryName}`);
        reply.type("text/html; charset=utf-8");
        const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred during the search.";
        return /* @__PURE__ */ jsx(Alert, { type: "error", message: errorMessage });
      }
    }
  );
  server.get(
    "/web/libraries/:libraryName/versions-list",
    async (request, reply) => {
      const { libraryName } = request.params;
      try {
        const result = await listLibrariesTool.execute();
        const libraryInfo = result.libraries.find(
          (lib) => lib.name.toLowerCase() === libraryName.toLowerCase()
        );
        if (!libraryInfo) {
          reply.status(404).send("Library not found");
          return;
        }
        const versions = libraryInfo.versions || [];
        reply.type("text/html; charset=utf-8");
        if (versions.length === 0) {
          return /* @__PURE__ */ jsx("p", { class: "text-sm text-gray-500 dark:text-gray-400 italic", children: "No versions indexed." });
        }
        return /* @__PURE__ */ jsx(Fragment, { children: versions.map((v) => {
          const adapted = {
            id: -1,
            ref: { library: libraryInfo.name, version: v.version },
            status: v.status,
            progress: v.progress,
            counts: {
              documents: v.documentCount,
              uniqueUrls: v.uniqueUrlCount
            },
            indexedAt: v.indexedAt,
            sourceUrl: v.sourceUrl ?? void 0
          };
          return /* @__PURE__ */ jsx(
            VersionDetailsRow,
            {
              libraryName: libraryInfo.name,
              version: adapted,
              showDelete: true,
              showRefresh: true
            }
          );
        }) });
      } catch (error) {
        logger.error(`Failed to fetch versions for ${libraryName}: ${error}`);
        reply.status(500).send("Internal Server Error");
      }
    }
  );
  server.get(
    "/web/libraries/:libraryName/add-version-button",
    async (request, reply) => {
      const { libraryName } = request.params;
      reply.type("text/html; charset=utf-8");
      return /* @__PURE__ */ jsx(AddVersionButton, { libraryName });
    }
  );
  server.get(
    "/web/libraries/:libraryName/add-version-form",
    async (request, reply) => {
      const { libraryName } = request.params;
      try {
        const result = await listLibrariesTool.execute();
        const libraryInfo = result.libraries.find(
          (lib) => lib.name.toLowerCase() === libraryName.toLowerCase()
        );
        if (!libraryInfo) {
          reply.status(404).send("Library not found");
          return;
        }
        const versions = libraryInfo.versions || [];
        const latestVersion = versions[0];
        let initialValues = {
          library: libraryName
        };
        if (latestVersion) {
          const summaries = await docService.listLibraries();
          const libSummary = summaries.find(
            (s) => s.library.toLowerCase() === libraryName.toLowerCase()
          );
          if (libSummary) {
            const versionSummary = libSummary.versions.find(
              (v) => v.ref.version === (latestVersion.version || "") || !latestVersion.version && v.ref.version === ""
            );
            if (versionSummary) {
              const scraperConfig = await docService.getScraperOptions(
                versionSummary.id
              );
              if (scraperConfig) {
                const opts = scraperConfig.options;
                initialValues = {
                  library: libraryName,
                  url: scraperConfig.sourceUrl,
                  maxPages: opts.maxPages,
                  maxDepth: opts.maxDepth,
                  scope: opts.scope,
                  includePatterns: opts.includePatterns?.join("\n"),
                  excludePatterns: opts.excludePatterns?.join("\n"),
                  scrapeMode: opts.scrapeMode,
                  headers: opts.headers ? Object.entries(opts.headers).map(([name, value]) => ({
                    name,
                    value
                  })) : void 0,
                  followRedirects: opts.followRedirects,
                  ignoreErrors: opts.ignoreErrors
                };
              }
            }
          }
        }
        reply.type("text/html; charset=utf-8");
        return /* @__PURE__ */ jsx(ScrapeFormContent, { initialValues, mode: "add-version" });
      } catch (error) {
        logger.error(
          `Failed to load add-version form for ${libraryName}: ${error}`
        );
        reply.type("text/html; charset=utf-8");
        return /* @__PURE__ */ jsx(Alert, { type: "error", message: "Failed to load the add version form." });
      }
    }
  );
}
const LibraryItem = ({ library }) => {
  const versions = library.versions || [];
  const latestVersion = versions[0];
  return (
    // Use Flowbite Card structure with updated padding and border, and white background
    /* @__PURE__ */ jsxs(
      "div",
      {
        id: `library-item-${library.name}`,
        class: "block px-4 py-2 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-300 dark:border-gray-600",
        children: [
          /* @__PURE__ */ jsx("h3", { class: "text-lg font-medium text-gray-900 dark:text-white", children: /* @__PURE__ */ jsx(
            "a",
            {
              href: `/libraries/${encodeURIComponent(library.name)}`,
              class: "hover:underline",
              children: /* @__PURE__ */ jsx("span", { safe: true, children: library.name })
            }
          ) }),
          latestVersion?.sourceUrl ? /* @__PURE__ */ jsx("div", { class: "text-sm text-gray-500 dark:text-gray-400 overflow-hidden h-5 @container", children: /* @__PURE__ */ jsx(
            "a",
            {
              href: latestVersion.sourceUrl,
              target: "_blank",
              class: "inline-block whitespace-nowrap hover:underline hover:animate-[scrollText_2s_ease-in-out_forwards]",
              title: latestVersion.sourceUrl,
              safe: true,
              children: latestVersion.sourceUrl
            }
          ) }) : null,
          /* @__PURE__ */ jsx("div", { class: "mt-2", children: versions.length > 0 ? versions.map((v) => {
            const adapted = {
              id: -1,
              ref: { library: library.name, version: v.version },
              status: v.status,
              progress: v.progress,
              counts: {
                documents: v.documentCount,
                uniqueUrls: v.uniqueUrlCount
              },
              indexedAt: v.indexedAt,
              sourceUrl: v.sourceUrl ?? void 0
            };
            return /* @__PURE__ */ jsx(VersionDetailsRow, { libraryName: library.name, version: adapted });
          }) : (
            // Display message if no versions are indexed
            /* @__PURE__ */ jsx("p", { class: "text-sm text-gray-500 dark:text-gray-400 italic", children: "No versions indexed." })
          ) })
        ]
      }
    )
  );
};
const LibraryList = ({ libraries }) => {
  if (libraries.length === 0) {
    return /* @__PURE__ */ jsx(
      Alert,
      {
        type: "info",
        title: "Welcome!",
        message: /* @__PURE__ */ jsxs(Fragment, { children: [
          "To get started, click",
          " ",
          /* @__PURE__ */ jsx("span", { class: "font-semibold", children: "Add New Documentation" }),
          " above and enter the URL of a documentation site to index. For more information, check the",
          " ",
          /* @__PURE__ */ jsx(
            "a",
            {
              href: "https://grounded.tools",
              target: "_blank",
              rel: "noopener noreferrer",
              class: "font-medium underline hover:no-underline",
              children: "official website"
            }
          ),
          "."
        ] })
      }
    );
  }
  return /* @__PURE__ */ jsx(
    "div",
    {
      id: "library-list",
      class: "space-y-2 animate-[fadeSlideIn_0.2s_ease-out]",
      children: libraries.map((library) => /* @__PURE__ */ jsx(LibraryItem, { library }))
    }
  );
};
function registerLibrariesRoutes(server, listLibrariesTool, removeTool, refreshVersionTool) {
  server.get("/web/libraries", async (_request, reply) => {
    try {
      const result = await listLibrariesTool.execute();
      reply.type("text/html; charset=utf-8");
      return /* @__PURE__ */ jsx(LibraryList, { libraries: result.libraries });
    } catch (error) {
      logger.error(`Failed to list libraries: ${error}`);
      reply.status(500).send("Internal Server Error");
    }
  });
  server.delete(
    "/web/libraries/:libraryName/versions/:versionParam",
    async (request, reply) => {
      const { libraryName, versionParam } = request.params;
      const version = versionParam === "latest" ? void 0 : versionParam;
      try {
        await removeTool.execute({ library: libraryName, version });
        const result = await listLibrariesTool.execute();
        const libraryStillExists = result.libraries.some(
          (lib) => lib.name.toLowerCase() === libraryName.toLowerCase()
        );
        if (!libraryStillExists) {
          reply.header("HX-Redirect", "/");
        }
        reply.status(204).send();
      } catch (error) {
        logger.error(
          `Failed to remove ${libraryName}@${versionParam}: ${error}`
        );
        reply.status(500).send({ message: error.message || "Failed to remove version." });
      }
    }
  );
  server.post(
    "/web/libraries/:libraryName/versions/:versionParam/refresh",
    async (request, reply) => {
      const { libraryName, versionParam } = request.params;
      const version = versionParam === "latest" || versionParam === "" ? void 0 : versionParam;
      try {
        await refreshVersionTool.execute({
          library: libraryName,
          version,
          waitForCompletion: false
        });
        const versionDisplay = version || "latest";
        reply.header(
          "HX-Trigger",
          JSON.stringify({
            toast: {
              message: `Refresh started for ${libraryName}@${versionDisplay}`,
              type: "success"
            }
          })
        );
        reply.status(204).send();
      } catch (error) {
        logger.error(
          `Failed to refresh ${libraryName}@${versionParam}: ${error}`
        );
        const errorMessage = error instanceof Error ? error.message : "Failed to refresh version.";
        reply.header(
          "HX-Trigger",
          JSON.stringify({
            toast: {
              message: errorMessage,
              type: "error"
            }
          })
        );
        reply.status(500).send();
      }
    }
  );
}
function formatNumber(num) {
  if (num >= 1e9) {
    return `${(num / 1e9).toFixed(1)}B`;
  }
  if (num >= 1e6) {
    return `${(num / 1e6).toFixed(1)}M`;
  }
  if (num >= 1e3) {
    return `${(num / 1e3).toFixed(1)}K`;
  }
  return num.toString();
}
const AnalyticsCards = ({
  totalChunks,
  activeLibraries,
  activeVersions,
  indexedPages
}) => /* @__PURE__ */ jsxs("div", { class: "grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4 animate-[fadeSlideIn_0.2s_ease-out]", children: [
  /* @__PURE__ */ jsx("div", { class: "p-4 bg-white rounded-lg shadow dark:bg-gray-800 border border-gray-300 dark:border-gray-600", children: /* @__PURE__ */ jsx("div", { class: "flex items-center", children: /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsx("p", { class: "text-sm font-medium text-gray-500 dark:text-gray-400", children: "Total Knowledge Base" }),
    /* @__PURE__ */ jsxs("p", { class: "text-xl font-semibold text-gray-900 dark:text-white", safe: true, children: [
      formatNumber(totalChunks),
      " Chunks"
    ] })
  ] }) }) }),
  /* @__PURE__ */ jsx("div", { class: "p-4 bg-white rounded-lg shadow dark:bg-gray-800 border border-gray-300 dark:border-gray-600", children: /* @__PURE__ */ jsx("div", { class: "flex items-center", children: /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsx("p", { class: "text-sm font-medium text-gray-500 dark:text-gray-400", children: "Libraries / Versions" }),
    /* @__PURE__ */ jsxs("p", { class: "text-xl font-semibold text-gray-900 dark:text-white", children: [
      activeLibraries,
      " / ",
      activeVersions
    ] })
  ] }) }) }),
  /* @__PURE__ */ jsx("div", { class: "p-4 bg-white rounded-lg shadow dark:bg-gray-800 border border-gray-300 dark:border-gray-600", children: /* @__PURE__ */ jsx("div", { class: "flex items-center", children: /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsx("p", { class: "text-sm font-medium text-gray-500 dark:text-gray-400", children: "Indexed Pages" }),
    /* @__PURE__ */ jsx("p", { class: "text-xl font-semibold text-gray-900 dark:text-white", safe: true, children: formatNumber(indexedPages) })
  ] }) }) })
] });
function registerStatsRoute(server, docService) {
  server.get("/web/stats", async (_request, reply) => {
    try {
      const libraries = await docService.listLibraries();
      let totalChunks = 0;
      let indexedPages = 0;
      let activeVersions = 0;
      for (const lib of libraries) {
        activeVersions += lib.versions.length;
        for (const version of lib.versions) {
          totalChunks += version.counts.documents;
          indexedPages += version.counts.uniqueUrls;
        }
      }
      const activeLibraries = libraries.length;
      reply.type("text/html; charset=utf-8");
      return /* @__PURE__ */ jsx(
        AnalyticsCards,
        {
          totalChunks,
          activeLibraries,
          activeVersions,
          indexedPages
        }
      );
    } catch (error) {
      logger.error(`Failed to fetch stats: ${error}`);
      reply.status(500).send("Internal Server Error");
    }
  });
}
async function registerWebService(server, docService, pipeline, eventBus, appConfig, externalWorkerUrl) {
  const listLibrariesTool = new ListLibrariesTool(docService);
  const listJobsTool = new ListJobsTool(pipeline);
  const scrapeTool = new ScrapeTool(pipeline, appConfig.scraper);
  const removeTool = new RemoveTool(docService, pipeline);
  const refreshVersionTool = new RefreshVersionTool(pipeline);
  const searchTool = new SearchTool(docService);
  const cancelJobTool = new CancelJobTool(pipeline);
  const clearCompletedJobsTool = new ClearCompletedJobsTool(pipeline);
  registerIndexRoute(server, externalWorkerUrl);
  registerLibrariesRoutes(server, listLibrariesTool, removeTool, refreshVersionTool);
  registerLibraryDetailRoutes(
    server,
    listLibrariesTool,
    searchTool,
    scrapeTool,
    docService
  );
  registerJobListRoutes(server, listJobsTool);
  registerNewJobRoutes(server, scrapeTool, appConfig.scraper);
  registerCancelJobRoute(server, cancelJobTool);
  registerClearCompletedJobsRoute(server, clearCompletedJobsTool);
  registerEventsRoute(server, eventBus);
  registerStatsRoute(server, docService);
  server.get("/api/search", async (request, reply) => {
    const query = request.query.q;
    if (!query) return reply.status(400).send({ error: "Missing query" });
    try {
      const result = await searchTool.execute({ query, limit: 5, library: "" });
      return result;
    } catch (e) {
      server.log.error(e);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });
}
async function registerWorkerService(pipeline) {
  await pipeline.start();
  logger.debug("Worker service started");
}
async function stopWorkerService(pipeline) {
  await pipeline.stop();
  logger.debug("Worker service stopped");
}
class AppServer {
  constructor(docService, pipeline, eventBus, serverConfig, appConfig) {
    this.docService = docService;
    this.pipeline = pipeline;
    this.eventBus = eventBus;
    this.serverConfig = serverConfig;
    this.appConfig = appConfig;
    this.server = Fastify({
      logger: false
      // Use our own logger
    });
  }
  server;
  mcpServer = null;
  authManager = null;
  serverConfig;
  appConfig;
  remoteEventProxy = null;
  wss = null;
  /**
   * Validate the server configuration for invalid service combinations.
   */
  validateConfig() {
    if (this.serverConfig.enableWebInterface) {
      if (!this.serverConfig.enableWorker && !this.serverConfig.externalWorkerUrl) {
        throw new Error(
          "Web interface requires either embedded worker (enableWorker: true) or external worker (externalWorkerUrl)"
        );
      }
    }
    if (this.serverConfig.enableMcpServer) {
      if (!this.serverConfig.enableWorker && !this.serverConfig.externalWorkerUrl) {
        throw new Error(
          "MCP server requires either embedded worker (enableWorker: true) or external worker (externalWorkerUrl)"
        );
      }
    }
  }
  /**
   * Start the application server with the configured services.
   */
  async start() {
    this.validateConfig();
    const embeddingConfig = this.docService.getActiveEmbeddingConfig();
    if (this.appConfig.app.telemetryEnabled && shouldEnableTelemetry()) {
      try {
        if (telemetry.isEnabled()) {
          telemetry.setGlobalContext({
            appVersion: "1.33.1",
            appPlatform: process.platform,
            appNodeVersion: process.version,
            appServicesEnabled: this.getActiveServicesList(),
            appAuthEnabled: Boolean(this.appConfig.auth.enabled),
            appReadOnly: Boolean(this.appConfig.app.readOnly),
            // Add embedding configuration to global context
            ...embeddingConfig && {
              aiEmbeddingProvider: embeddingConfig.provider,
              aiEmbeddingModel: embeddingConfig.model,
              aiEmbeddingDimensions: embeddingConfig.dimensions
            }
          });
          telemetry.track(TelemetryEvent.APP_STARTED, {
            services: this.getActiveServicesList(),
            port: this.serverConfig.port,
            externalWorker: Boolean(this.serverConfig.externalWorkerUrl),
            // Include startup context when available
            ...this.serverConfig.startupContext?.cliCommand && {
              cliCommand: this.serverConfig.startupContext.cliCommand
            },
            ...this.serverConfig.startupContext?.mcpProtocol && {
              mcpProtocol: this.serverConfig.startupContext.mcpProtocol
            },
            ...this.serverConfig.startupContext?.mcpTransport && {
              mcpTransport: this.serverConfig.startupContext.mcpTransport
            }
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
        host: this.appConfig.server.host
      });
      if (this.serverConfig.enableApiServer) {
        this.setupWebSocketServer();
      }
      if (this.remoteEventProxy) {
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
  async stop() {
    try {
      if (this.remoteEventProxy) {
        this.remoteEventProxy.disconnect();
      }
      if (this.serverConfig.enableWorker) {
        await stopWorkerService(this.pipeline);
      }
      if (this.mcpServer) {
        await cleanupMcpService(this.mcpServer);
      }
      if (this.wss) {
        for (const client of this.wss.clients) {
          client.terminate();
        }
        await new Promise((resolve, reject) => {
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
      if (telemetry.isEnabled()) {
        telemetry.track(TelemetryEvent.APP_SHUTDOWN, {
          graceful: true
        });
      }
      await telemetry.shutdown();
      if (this.server.server) {
        this.server.server.closeAllConnections();
      }
      await this.server.close();
      logger.info("🛑 AppServer stopped");
    } catch (error) {
      logger.error(`❌ Failed to stop AppServer gracefully: ${error}`);
      if (telemetry.isEnabled()) {
        telemetry.track(TelemetryEvent.APP_SHUTDOWN, {
          graceful: false,
          error: error instanceof Error ? error.constructor.name : "UnknownError"
        });
        await telemetry.shutdown();
      }
      throw error;
    }
  }
  /**
   * Setup global error handling for telemetry
   */
  setupErrorHandling() {
    if (!process.listenerCount("unhandledRejection")) {
      process.on("unhandledRejection", (reason) => {
        logger.error(`Unhandled Promise Rejection: ${reason}`);
        if (telemetry.isEnabled()) {
          const error = reason instanceof Error ? reason : new Error(String(reason));
          telemetry.captureException(error, {
            error_category: "system",
            component: AppServer.constructor.name,
            context: "process_unhandled_rejection"
          });
        }
      });
    }
    if (!process.listenerCount("uncaughtException")) {
      process.on("uncaughtException", (error) => {
        logger.error(`Uncaught Exception: ${error.message}`);
        if (telemetry.isEnabled()) {
          telemetry.captureException(error, {
            error_category: "system",
            component: AppServer.constructor.name,
            context: "process_uncaught_exception"
          });
        }
      });
    }
    if (typeof this.server.setErrorHandler === "function") {
      this.server.setErrorHandler(async (error, request, reply) => {
        if (telemetry.isEnabled()) {
          telemetry.captureException(error, {
            errorCategory: "http",
            component: "FastifyServer",
            statusCode: error.statusCode || 500,
            method: request.method,
            route: request.routeOptions?.url || request.url,
            context: "http_request_error"
          });
        }
        logger.error(`HTTP Error on ${request.method} ${request.url}: ${error.message}`);
        const statusCode = error.statusCode || 500;
        reply.status(statusCode).send({
          error: "Internal Server Error",
          statusCode,
          message: statusCode < 500 ? error.message : "An unexpected error occurred"
        });
      });
    }
  }
  /**
   * Get list of currently active services for telemetry
   */
  getActiveServicesList() {
    const services = [];
    if (this.serverConfig.enableMcpServer) services.push("mcp");
    if (this.serverConfig.enableWebInterface) services.push("web");
    if (this.serverConfig.enableApiServer) services.push("api");
    if (this.serverConfig.enableWorker) services.push("worker");
    return services;
  }
  /**
   * Setup the server with plugins and conditionally enabled services.
   */
  async setupServer() {
    this.setupErrorHandling();
    this.setupRemoteEventProxy();
    if (this.appConfig.auth.enabled) {
      await this.initializeAuth();
    }
    await this.server.register(formBody);
    if (this.appConfig.auth.enabled) {
      this.server.addHook("onRequest", async (request) => {
        if (request.url.includes("/oauth") || request.url.includes("/auth") || request.url.includes("/register")) {
          logger.debug(
            `${request.method} ${request.url} - Headers: ${JSON.stringify(request.headers)}`
          );
        }
      });
    }
    if (this.appConfig.auth.enabled && this.authManager) {
      await this.setupAuthMetadataEndpoint();
    }
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
    if (this.serverConfig.enableWebInterface) {
      await this.setupStaticFiles();
    }
  }
  /**
   * Initialize remote event proxy if using an external worker.
   * The proxy is created here but connection is deferred until after server starts.
   */
  setupRemoteEventProxy() {
    if (this.serverConfig.externalWorkerUrl) {
      this.remoteEventProxy = new RemoteEventProxy(
        this.serverConfig.externalWorkerUrl,
        this.eventBus
      );
      logger.debug(
        "Remote event proxy created for external worker (connection deferred)"
      );
    }
  }
  /**
   * Enable web interface service.
   */
  async enableWebInterface() {
    await registerWebService(
      this.server,
      this.docService,
      this.pipeline,
      this.eventBus,
      this.appConfig,
      this.serverConfig.externalWorkerUrl
    );
    logger.debug("Web interface service enabled");
  }
  /**
   * Enable MCP server service.
   */
  async enableMcpServer() {
    this.mcpServer = await registerMcpService(
      this.server,
      this.docService,
      this.pipeline,
      this.appConfig,
      this.authManager || void 0
    );
    logger.debug("MCP server service enabled");
  }
  /**
   * Enable Pipeline RPC (tRPC) service.
   */
  async enableTrpcApi() {
    await registerTrpcService(this.server, this.pipeline, this.docService, this.eventBus);
    logger.debug("API server (tRPC) enabled");
  }
  /**
   * Setup WebSocket server for tRPC subscriptions.
   * This is called after the HTTP server is listening.
   */
  setupWebSocketServer() {
    if (!this.server.server) {
      throw new Error(
        "Cannot setup WebSocket server: HTTP server not available. This method must be called after server.listen() completes."
      );
    }
    this.wss = new WebSocketServer({
      noServer: true
    });
    this.server.server.on("upgrade", (request, socket, head) => {
      this.wss?.handleUpgrade(request, socket, head, (ws) => {
        this.wss?.emit("connection", ws, request);
      });
    });
    applyTrpcWebSocketHandler(this.wss, this.pipeline, this.docService, this.eventBus);
    logger.debug("WebSocket server initialized for tRPC subscriptions");
  }
  /**
   * Enable worker service.
   */
  async enableWorker() {
    await registerWorkerService(this.pipeline);
    logger.debug("Worker service enabled");
  }
  /**
   * Setup static file serving with root prefix as fallback.
   */
  async setupStaticFiles() {
    await this.server.register(fastifyStatic, {
      root: path.join(getProjectRoot(), "public"),
      prefix: "/",
      index: false
    });
  }
  /**
   * Initialize OAuth2/OIDC authentication manager.
   */
  async initializeAuth() {
    if (!this.appConfig.auth.enabled) {
      return;
    }
    if (!this.appConfig.auth.issuerUrl || !this.appConfig.auth.audience) {
      throw new Error(
        "Authentication is enabled but auth.issuerUrl or auth.audience is not configured."
      );
    }
    this.authManager = new ProxyAuthManager({
      enabled: true,
      issuerUrl: this.appConfig.auth.issuerUrl,
      audience: this.appConfig.auth.audience,
      scopes: ["openid", "profile"]
    });
    await this.authManager.initialize();
    logger.debug("Proxy auth manager initialized");
  }
  /**
   * Setup OAuth2 endpoints using ProxyAuthManager.
   */
  async setupAuthMetadataEndpoint() {
    if (!this.authManager) {
      return;
    }
    const baseUrl = new URL(`http://localhost:${this.serverConfig.port}`);
    this.authManager.registerRoutes(this.server, baseUrl);
    logger.debug("OAuth2 proxy endpoints registered");
  }
  /**
   * Log startup information showing which services are enabled.
   */
  logStartupInfo(address) {
    const isWorkerOnly = this.serverConfig.enableWorker && !this.serverConfig.enableWebInterface && !this.serverConfig.enableMcpServer;
    const isWebOnly = this.serverConfig.enableWebInterface && !this.serverConfig.enableWorker && !this.serverConfig.enableMcpServer;
    const isMcpOnly = this.serverConfig.enableMcpServer && !this.serverConfig.enableWebInterface && !this.serverConfig.enableWorker;
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
    const enabledServices = [];
    if (this.serverConfig.enableWebInterface && isCombined) {
      enabledServices.push(`Web interface: ${address}`);
    }
    if (this.serverConfig.enableMcpServer) {
      enabledServices.push(`MCP endpoints: ${address}/mcp, ${address}/sse`);
    }
    if (!this.serverConfig.enableWorker && this.serverConfig.externalWorkerUrl) {
      enabledServices.push(`Worker: ${this.serverConfig.externalWorkerUrl}`);
    }
    if (this.serverConfig.enableWorker) {
      const embeddingConfig = this.docService.getActiveEmbeddingConfig();
      if (embeddingConfig) {
        enabledServices.push(
          `Embeddings: ${embeddingConfig.provider}:${embeddingConfig.model}`
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
async function startAppServer(docService, pipeline, eventBus, serverConfig, appConfig) {
  const appServer = new AppServer(
    docService,
    pipeline,
    eventBus,
    serverConfig,
    appConfig
  );
  await appServer.start();
  return appServer;
}
async function startStdioServer(tools, config) {
  const server = createMcpServerInstance(tools, config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("🤖 MCP server listening on stdio");
  return server;
}
class PipelineClient {
  baseUrl;
  wsUrl;
  client;
  wsClient;
  eventBus;
  constructor(serverUrl, eventBus) {
    this.baseUrl = serverUrl.replace(/\/$/, "");
    this.eventBus = eventBus;
    const url = new URL(this.baseUrl);
    const baseWsUrl = `${url.protocol}//${url.host}`;
    this.wsUrl = baseWsUrl.replace(/^http/, "ws");
    this.wsClient = createWSClient({
      url: this.wsUrl
    });
    this.client = createTRPCProxyClient({
      links: [
        splitLink({
          condition: (op) => op.type === "subscription",
          true: wsLink({ client: this.wsClient, transformer: superjson }),
          false: httpBatchLink({ url: this.baseUrl, transformer: superjson })
        })
      ]
    });
    logger.debug(
      `PipelineClient (tRPC) created for: ${this.baseUrl} (ws: ${this.wsUrl})`
    );
  }
  async start() {
    try {
      await this.client.ping.query();
      logger.debug("PipelineClient connected to external worker via tRPC");
    } catch (error) {
      throw new Error(
        `Failed to connect to external worker at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async stop() {
    this.wsClient.close();
    logger.debug("PipelineClient stopped");
  }
  async enqueueScrapeJob(library, version, options) {
    try {
      const normalizedVersion = typeof version === "string" && version.trim().length === 0 ? null : version ?? null;
      const result = await this.client.enqueueScrapeJob.mutate({
        library,
        version: normalizedVersion,
        options
      });
      logger.debug(`Job ${result.jobId} enqueued successfully`);
      return result.jobId;
    } catch (error) {
      throw new Error(
        `Failed to enqueue job: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async enqueueRefreshJob(library, version) {
    try {
      const normalizedVersion = typeof version === "string" && version.trim().length === 0 ? null : version ?? null;
      const result = await this.client.enqueueRefreshJob.mutate({
        library,
        version: normalizedVersion
      });
      logger.debug(`Refresh job ${result.jobId} enqueued successfully`);
      return result.jobId;
    } catch (error) {
      throw new Error(
        `Failed to enqueue refresh job: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async getJob(jobId) {
    try {
      return await this.client.getJob.query({ id: jobId });
    } catch (error) {
      throw new Error(
        `Failed to get job ${jobId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async getJobs(status) {
    try {
      const result = await this.client.getJobs.query({ status });
      return result.jobs || [];
    } catch (error) {
      logger.error(`❌ Failed to get jobs from external worker: ${error}`);
      throw error;
    }
  }
  async cancelJob(jobId) {
    try {
      await this.client.cancelJob.mutate({ id: jobId });
      logger.debug(`Job cancelled via external worker: ${jobId}`);
    } catch (error) {
      logger.error(`❌ Failed to cancel job ${jobId} via external worker: ${error}`);
      throw error;
    }
  }
  async clearCompletedJobs() {
    try {
      const result = await this.client.clearCompletedJobs.mutate();
      logger.debug(`Cleared ${result.count} completed jobs via external worker`);
      return result.count || 0;
    } catch (error) {
      logger.error(`❌ Failed to clear completed jobs via external worker: ${error}`);
      throw error;
    }
  }
  async waitForJobCompletion(jobId) {
    return new Promise((resolve, reject) => {
      const unsubscribe = this.eventBus.on(
        EventType.JOB_STATUS_CHANGE,
        (job) => {
          if (job.id !== jobId) {
            return;
          }
          if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
            unsubscribe();
            if (job.status === "failed" && job.error) {
              reject(new Error(job.error.message));
            } else {
              resolve();
            }
          }
        }
      );
    });
  }
  setCallbacks(_callbacks) {
    logger.debug("PipelineClient.setCallbacks called - no-op for external worker");
  }
}
function isRegexPattern(pattern) {
  return pattern.length > 2 && pattern.startsWith("/") && pattern.endsWith("/");
}
function patternToRegExp(pattern) {
  if (isRegexPattern(pattern)) {
    return new RegExp(pattern.slice(1, -1));
  }
  const re = minimatch.makeRe(pattern, { dot: true });
  if (!re) throw new Error(`Invalid glob pattern: ${pattern}`);
  return re;
}
function matchesAnyPattern(path2, patterns) {
  if (!patterns || patterns.length === 0) return false;
  const normalizedPath = path2.startsWith("/") ? path2 : `/${path2}`;
  return patterns.some((pattern) => {
    if (isRegexPattern(pattern)) {
      return patternToRegExp(pattern).test(normalizedPath);
    }
    const pathForMatch = normalizedPath.replace(/^\//, "");
    const patternForMatch = pattern.startsWith("/") ? pattern.slice(1) : pattern;
    return minimatch(pathForMatch, patternForMatch, { dot: true });
  });
}
function extractPathAndQuery(url) {
  try {
    const u = new URL(url);
    return u.pathname + (u.search || "");
  } catch {
    return url;
  }
}
function shouldIncludeUrl(url, includePatterns, excludePatterns) {
  const path2 = extractPathAndQuery(url);
  const normalizedPath = path2.startsWith("/") ? path2 : `/${path2}`;
  let basename;
  if (url.startsWith("file://")) {
    try {
      const u = new URL(url);
      basename = u.pathname ? u.pathname.split("/").pop() : void 0;
    } catch {
    }
  }
  const stripSlash = (patterns) => patterns?.map((p) => p.startsWith("/") ? p.slice(1) : p);
  const effectiveExcludePatterns = getEffectiveExclusionPatterns(excludePatterns);
  if (matchesAnyPattern(url, effectiveExcludePatterns) || matchesAnyPattern(normalizedPath, effectiveExcludePatterns) || basename && matchesAnyPattern(basename, stripSlash(effectiveExcludePatterns)))
    return false;
  if (!includePatterns || includePatterns.length === 0) return true;
  return matchesAnyPattern(url, includePatterns) || matchesAnyPattern(normalizedPath, includePatterns) || (basename ? matchesAnyPattern(basename, stripSlash(includePatterns)) : false);
}
function computeBaseDirectory(pathname) {
  if (pathname === "") return "/";
  if (pathname.endsWith("/")) return pathname;
  const lastSegment = pathname.split("/").at(-1) || "";
  const looksLikeFile = lastSegment.includes(".");
  if (looksLikeFile) {
    return pathname.replace(/\/[^/]*$/, "/");
  }
  return `${pathname}/`;
}
function isInScope(baseUrl, targetUrl, scope) {
  if (baseUrl.protocol !== targetUrl.protocol) return false;
  switch (scope) {
    case "subpages": {
      if (baseUrl.hostname !== targetUrl.hostname) return false;
      const baseDir = computeBaseDirectory(baseUrl.pathname);
      return targetUrl.pathname.startsWith(baseDir);
    }
    case "hostname":
      return baseUrl.hostname === targetUrl.hostname;
    case "domain": {
      return extractPrimaryDomain(baseUrl.hostname) === extractPrimaryDomain(targetUrl.hostname);
    }
    default:
      return false;
  }
}
class BaseScraperStrategy {
  /**
   * Set of normalized URLs that have been marked for processing.
   *
   * IMPORTANT: URLs are added to this set BEFORE they are actually processed, not after.
   * This prevents the same URL from being queued multiple times when discovered from different sources.
   *
   * Usage flow:
   * 1. Initial queue setup: Root URL and initialQueue items are added to visited
   * 2. During processing: When a page returns links, each link is checked against visited
   * 3. In processBatch deduplication: Only links NOT in visited are added to the queue AND to visited
   *
   * This approach ensures:
   * - No URL is processed more than once
   * - No URL appears in the queue multiple times
   * - Efficient deduplication across concurrent processing
   */
  visited = /* @__PURE__ */ new Set();
  pageCount = 0;
  totalDiscovered = 0;
  // Track total URLs discovered (unlimited)
  effectiveTotal = 0;
  // Track effective total (limited by maxPages)
  canonicalBaseUrl;
  options;
  config;
  constructor(config, options = {}) {
    this.config = config;
    this.options = options;
  }
  /**
   * Determines if a URL should be processed based on scope and include/exclude patterns in ScraperOptions.
   * Scope is checked first, then patterns.
   */
  shouldProcessUrl(url, options) {
    if (options.scope) {
      try {
        const base = this.canonicalBaseUrl ?? new URL$1(options.url);
        const target = new URL$1(url);
        if (!isInScope(base, target, options.scope)) return false;
      } catch {
        return false;
      }
    }
    return shouldIncludeUrl(url, options.includePatterns, options.excludePatterns);
  }
  async processBatch(batch, baseUrl, options, progressCallback, signal) {
    const maxPages = options.maxPages ?? this.config.scraper.maxPages;
    const results = await Promise.all(
      batch.map(async (item) => {
        if (signal?.aborted) {
          throw new CancellationError("Scraping cancelled during batch processing");
        }
        const maxDepth = options.maxDepth ?? this.config.scraper.maxDepth;
        if (item.depth > maxDepth) {
          return [];
        }
        try {
          const result = await this.processItem(item, options, signal);
          const shouldCount = item.pageId !== void 0 || result.content !== void 0;
          let currentPageCount = this.pageCount;
          if (shouldCount) {
            currentPageCount = ++this.pageCount;
            logger.info(
              `🌐 Scraping page ${currentPageCount}/${this.effectiveTotal} (depth ${item.depth}/${maxDepth}): ${item.url}`
            );
          }
          if (result.status === FetchStatus.NOT_MODIFIED) {
            logger.debug(`Page unchanged (304): ${item.url}`);
            if (shouldCount) {
              await progressCallback({
                pagesScraped: currentPageCount,
                totalPages: this.effectiveTotal,
                totalDiscovered: this.totalDiscovered,
                currentUrl: item.url,
                depth: item.depth,
                maxDepth,
                result: null,
                pageId: item.pageId
              });
            }
            return [];
          }
          if (result.status === FetchStatus.NOT_FOUND) {
            logger.debug(`Page deleted (404): ${item.url}`);
            if (shouldCount) {
              await progressCallback({
                pagesScraped: currentPageCount,
                totalPages: this.effectiveTotal,
                totalDiscovered: this.totalDiscovered,
                currentUrl: item.url,
                depth: item.depth,
                maxDepth,
                result: null,
                pageId: item.pageId,
                deleted: true
              });
            }
            return [];
          }
          if (result.status !== FetchStatus.SUCCESS) {
            logger.error(`❌ Unknown fetch status: ${result.status}`);
            return [];
          }
          const finalUrl = result.url || item.url;
          if (result.content) {
            await progressCallback({
              pagesScraped: currentPageCount,
              totalPages: this.effectiveTotal,
              totalDiscovered: this.totalDiscovered,
              currentUrl: finalUrl,
              depth: item.depth,
              maxDepth,
              result: {
                url: finalUrl,
                title: result.content.title?.trim() || result.title?.trim() || "",
                contentType: result.contentType || "",
                textContent: result.content.textContent || "",
                links: result.content.links || [],
                errors: result.content.errors || [],
                chunks: result.content.chunks || [],
                etag: result.etag || null,
                lastModified: result.lastModified || null
              },
              pageId: item.pageId
            });
          }
          const nextItems = result.links || [];
          const linkBaseUrl = finalUrl ? new URL$1(finalUrl) : baseUrl;
          return nextItems.map((value) => {
            try {
              const targetUrl = new URL$1(value, linkBaseUrl);
              if (!this.shouldProcessUrl(targetUrl.href, options)) {
                return null;
              }
              return {
                url: targetUrl.href,
                depth: item.depth + 1
              };
            } catch (_error) {
              logger.warn(`❌ Invalid URL: ${value}`);
            }
            return null;
          }).filter((item2) => item2 !== null);
        } catch (error) {
          if (options.ignoreErrors) {
            logger.error(`❌ Failed to process ${item.url}: ${error}`);
            return [];
          }
          throw error;
        }
      })
    );
    const allLinks = results.flat();
    const uniqueLinks = [];
    for (const item of allLinks) {
      const normalizedUrl = normalizeUrl(item.url, this.options.urlNormalizerOptions);
      if (!this.visited.has(normalizedUrl)) {
        this.visited.add(normalizedUrl);
        uniqueLinks.push(item);
        this.totalDiscovered++;
        if (this.effectiveTotal < maxPages) {
          this.effectiveTotal++;
        }
      }
    }
    return uniqueLinks;
  }
  async scrape(options, progressCallback, signal) {
    this.visited.clear();
    this.pageCount = 0;
    const initialQueue = options.initialQueue || [];
    const isRefreshMode = initialQueue.length > 0;
    this.canonicalBaseUrl = new URL$1(options.url);
    let baseUrl = this.canonicalBaseUrl;
    const queue = [];
    const normalizedRootUrl = normalizeUrl(
      options.url,
      this.options.urlNormalizerOptions
    );
    if (isRefreshMode) {
      logger.debug(
        `Starting refresh mode with ${initialQueue.length} pre-populated pages`
      );
      for (const item of initialQueue) {
        const normalizedUrl = normalizeUrl(item.url, this.options.urlNormalizerOptions);
        if (!this.visited.has(normalizedUrl)) {
          this.visited.add(normalizedUrl);
          queue.push(item);
        }
      }
    }
    if (!this.visited.has(normalizedRootUrl)) {
      this.visited.add(normalizedRootUrl);
      queue.unshift({ url: options.url, depth: 0 });
    }
    this.totalDiscovered = queue.length;
    this.effectiveTotal = queue.length;
    const maxPages = options.maxPages ?? this.config.scraper.maxPages;
    const maxConcurrency = options.maxConcurrency ?? this.config.scraper.maxConcurrency;
    while (queue.length > 0 && this.pageCount < maxPages) {
      if (signal?.aborted) {
        logger.debug(`${isRefreshMode ? "Refresh" : "Scraping"} cancelled by signal.`);
        throw new CancellationError(
          `${isRefreshMode ? "Refresh" : "Scraping"} cancelled by signal`
        );
      }
      const remainingPages = maxPages - this.pageCount;
      if (remainingPages <= 0) {
        break;
      }
      const batchSize = Math.min(maxConcurrency, remainingPages, queue.length);
      const batch = queue.splice(0, batchSize);
      baseUrl = this.canonicalBaseUrl ?? baseUrl;
      const newUrls = await this.processBatch(
        batch,
        baseUrl,
        options,
        progressCallback,
        signal
      );
      queue.push(...newUrls);
    }
  }
  /**
   * Cleanup resources used by this strategy.
   * Default implementation does nothing - override in derived classes as needed.
   */
  async cleanup() {
  }
}
class GitHubRepoProcessor {
  httpFetcher;
  pipelines;
  constructor(config) {
    this.httpFetcher = new HttpFetcher(config.scraper);
    this.pipelines = PipelineFactory$1.createStandardPipelines(config);
  }
  /**
   * Parses an HTTPS blob URL to extract repository information.
   * Format: https://github.com/owner/repo/blob/branch/filepath
   */
  parseHttpsBlobUrl(url) {
    const parsedUrl = new URL(url);
    const segments = parsedUrl.pathname.split("/").filter(Boolean);
    if (segments.length < 5 || segments[2] !== "blob") {
      throw new Error(
        `Invalid GitHub blob URL format. Expected: https://github.com/owner/repo/blob/branch/filepath. Got: ${url}`
      );
    }
    const owner = segments[0];
    const repo = segments[1];
    const branch = segments[3];
    const filePath = segments.slice(4).join("/");
    return { owner, repo, branch, filePath };
  }
  /**
   * Fetches the raw content of a file from GitHub.
   */
  async fetchFileContent(repoInfo, filePath, etag, signal) {
    const { owner, repo, branch } = repoInfo;
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    const rawContent = await this.httpFetcher.fetch(rawUrl, { signal, etag });
    const detectedMimeType = MimeTypeUtils.detectMimeTypeFromPath(filePath);
    if (detectedMimeType && rawContent.mimeType === "text/plain") {
      return {
        ...rawContent,
        mimeType: detectedMimeType
      };
    }
    return rawContent;
  }
  /**
   * Processes a single GitHub repository file from an HTTPS blob URL.
   */
  async process(item, options, signal) {
    const repoInfo = this.parseHttpsBlobUrl(item.url);
    const { owner, repo, branch, filePath } = repoInfo;
    const rawContent = await this.fetchFileContent(
      { owner, repo, branch },
      filePath,
      item.etag,
      signal
    );
    if (rawContent.status !== FetchStatus.SUCCESS) {
      return { url: item.url, links: [], status: rawContent.status };
    }
    let processed;
    for (const pipeline of this.pipelines) {
      const contentBuffer = Buffer.isBuffer(rawContent.content) ? rawContent.content : Buffer.from(rawContent.content);
      if (pipeline.canProcess(rawContent.mimeType || "text/plain", contentBuffer)) {
        logger.debug(
          `Selected ${pipeline.constructor.name} for content type "${rawContent.mimeType}" (${filePath})`
        );
        const gitHubOptions = { ...options, scrapeMode: ScrapeMode.Fetch };
        processed = await pipeline.process(rawContent, gitHubOptions, this.httpFetcher);
        break;
      }
    }
    if (!processed) {
      logger.warn(
        `⚠️  Unsupported content type "${rawContent.mimeType}" for file ${filePath}. Skipping processing.`
      );
      return { url: item.url, links: [], status: FetchStatus.SUCCESS };
    }
    for (const err of processed.errors ?? []) {
      logger.warn(`⚠️  Processing error for ${filePath}: ${err.message}`);
    }
    const githubUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`;
    const filename = filePath.split("/").pop() || "Untitled";
    return {
      url: githubUrl,
      title: processed.title?.trim() || filename || "Untitled",
      etag: rawContent.etag,
      lastModified: rawContent.lastModified,
      contentType: rawContent.mimeType,
      content: processed,
      links: [],
      // Always return empty links array for individual files
      status: FetchStatus.SUCCESS
    };
  }
  /**
   * Cleanup resources used by this processor.
   */
  async cleanup() {
    await Promise.allSettled(this.pipelines.map((pipeline) => pipeline.close()));
  }
}
class GitHubWikiProcessor {
  httpFetcher;
  pipelines;
  constructor(config) {
    this.httpFetcher = new HttpFetcher(config.scraper);
    this.pipelines = PipelineFactory$1.createStandardPipelines(config);
  }
  /**
   * Parses a GitHub wiki URL to extract repository information.
   */
  parseGitHubWikiUrl(url) {
    const parsedUrl = new URL(url);
    const match = parsedUrl.pathname.match(/^\/([^/]+)\/([^/]+)\/wiki/);
    if (!match) {
      throw new Error(`Invalid GitHub wiki URL: ${url}`);
    }
    const [, owner, repo] = match;
    return { owner, repo };
  }
  /**
   * Determines if a URL should be processed within the wiki scope.
   */
  shouldProcessUrl(url, options) {
    try {
      const parsedUrl = new URL(url);
      const baseWikiInfo = this.parseGitHubWikiUrl(options.url);
      const expectedWikiPath = `/${baseWikiInfo.owner}/${baseWikiInfo.repo}/wiki`;
      if (!parsedUrl.pathname.startsWith(expectedWikiPath)) {
        return false;
      }
      const wikiPagePath = parsedUrl.pathname.replace(expectedWikiPath, "").replace(/^\//, "");
      return shouldIncludeUrl(
        wikiPagePath || "Home",
        options.includePatterns,
        options.excludePatterns
      );
    } catch {
      return false;
    }
  }
  /**
   * Processes a single GitHub wiki page.
   */
  async process(item, options, signal) {
    const currentUrl = item.url;
    try {
      const rawContent = await this.httpFetcher.fetch(currentUrl, {
        signal,
        etag: item.etag
      });
      if (rawContent.status !== FetchStatus.SUCCESS) {
        return { url: currentUrl, links: [], status: rawContent.status };
      }
      let processed;
      for (const pipeline of this.pipelines) {
        if (pipeline.canProcess(rawContent.mimeType, rawContent.content)) {
          logger.debug(
            `Selected ${pipeline.constructor.name} for content type "${rawContent.mimeType}" (${currentUrl})`
          );
          const wikiOptions = { ...options, scrapeMode: ScrapeMode.Fetch };
          processed = await pipeline.process(rawContent, wikiOptions, this.httpFetcher);
          break;
        }
      }
      if (!processed) {
        logger.warn(
          `⚠️  Unsupported content type "${rawContent.mimeType}" for wiki page ${currentUrl}. Skipping processing.`
        );
        return { url: currentUrl, links: [], status: FetchStatus.SUCCESS };
      }
      for (const err of processed.errors ?? []) {
        logger.warn(`⚠️  Processing error for ${currentUrl}: ${err.message}`);
      }
      const parsedUrl = new URL(currentUrl);
      const wikiInfo = this.parseGitHubWikiUrl(currentUrl);
      const wikiPagePath = parsedUrl.pathname.replace(`/${wikiInfo.owner}/${wikiInfo.repo}/wiki`, "").replace(/^\//, "");
      const pageTitle = wikiPagePath || "Home";
      const links = processed.links || [];
      const wikiLinks = links.filter((link) => {
        if (!link || link.trim() === "" || link === "invalid-url" || link === "not-a-url-at-all") {
          return false;
        }
        return true;
      }).map((link) => {
        try {
          return new URL(link, currentUrl).href;
        } catch {
          return null;
        }
      }).filter((link) => link !== null).filter((link) => {
        try {
          const linkUrl = new URL(link);
          return linkUrl.hostname === parsedUrl.hostname && linkUrl.pathname.startsWith(`/${wikiInfo.owner}/${wikiInfo.repo}/wiki`);
        } catch {
          return false;
        }
      });
      return {
        url: currentUrl,
        title: pageTitle,
        etag: rawContent.etag,
        lastModified: rawContent.lastModified,
        contentType: rawContent.mimeType,
        content: processed,
        links: wikiLinks,
        status: FetchStatus.SUCCESS
      };
    } catch (error) {
      logger.warn(`⚠️  Failed to process wiki page ${currentUrl}: ${error}`);
      return { url: currentUrl, links: [], status: FetchStatus.SUCCESS };
    }
  }
  /**
   * Cleanup resources used by this processor.
   */
  async cleanup() {
    await Promise.allSettled(this.pipelines.map((pipeline) => pipeline.close()));
  }
}
class GitHubScraperStrategy extends BaseScraperStrategy {
  httpFetcher;
  wikiProcessor;
  repoProcessor;
  constructor(config) {
    super(config);
    this.httpFetcher = new HttpFetcher(config.scraper);
    this.wikiProcessor = new GitHubWikiProcessor(config);
    this.repoProcessor = new GitHubRepoProcessor(config);
  }
  canHandle(url) {
    if (url.startsWith("github-file://")) {
      return true;
    }
    try {
      const parsedUrl = new URL(url);
      const { hostname, pathname } = parsedUrl;
      if (!["github.com", "www.github.com"].includes(hostname)) {
        return false;
      }
      const baseMatch = pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
      if (baseMatch) {
        return true;
      }
      const treeMatch = pathname.match(/^\/([^/]+)\/([^/]+)\/tree\//);
      if (treeMatch) {
        return true;
      }
      const blobMatch = pathname.match(/^\/([^/]+)\/([^/]+)\/blob\//);
      if (blobMatch) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  /**
   * Parses a GitHub URL to extract repository information.
   */
  parseGitHubUrl(url) {
    const parsedUrl = new URL(url);
    const match = parsedUrl.pathname.match(/^\/([^/]+)\/([^/]+)/);
    if (!match) {
      throw new Error(`Invalid GitHub repository URL: ${url}`);
    }
    const [, owner, repo] = match;
    const segments = parsedUrl.pathname.split("/").filter(Boolean);
    if (segments.length >= 4 && segments[2] === "blob") {
      const branch = segments[3];
      const filePath = segments.length > 4 ? segments.slice(4).join("/") : void 0;
      return { owner, repo, branch, filePath, isBlob: true };
    }
    if (segments.length >= 4 && segments[2] === "tree") {
      const branch = segments[3];
      const subPath = segments.length > 4 ? segments.slice(4).join("/") : void 0;
      return { owner, repo, branch, subPath };
    }
    return { owner, repo };
  }
  /**
   * Fetches the repository tree structure from GitHub API.
   */
  async fetchRepositoryTree(repoInfo, signal) {
    const { owner, repo, branch } = repoInfo;
    let targetBranch = branch;
    if (!targetBranch) {
      try {
        const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
        logger.debug(`Fetching repository info: ${repoUrl}`);
        const repoContent = await this.httpFetcher.fetch(repoUrl, { signal });
        const content2 = typeof repoContent.content === "string" ? repoContent.content : repoContent.content.toString("utf-8");
        const repoData = JSON.parse(content2);
        targetBranch = repoData.default_branch;
        logger.debug(`Using default branch: ${targetBranch}`);
      } catch (error) {
        logger.warn(`⚠️  Could not fetch default branch, using 'main': ${error}`);
        targetBranch = "main";
      }
    }
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${targetBranch}?recursive=1`;
    logger.debug(`Fetching repository tree: ${treeUrl}`);
    const rawContent = await this.httpFetcher.fetch(treeUrl, { signal });
    const content = typeof rawContent.content === "string" ? rawContent.content : rawContent.content.toString("utf-8");
    const treeData = JSON.parse(content);
    if (treeData.truncated) {
      logger.warn(
        `⚠️  Repository tree was truncated for ${owner}/${repo}. Some files may be missing.`
      );
    }
    return { tree: treeData, resolvedBranch: targetBranch };
  }
  /**
   * Determines if a file should be processed based on its path and type.
   */
  shouldProcessFile(item, options) {
    if (item.type !== "blob") {
      return false;
    }
    const path2 = item.path;
    const textExtensions = [
      ".md",
      ".mdx",
      ".txt",
      ".rst",
      ".adoc",
      ".asciidoc",
      ".html",
      ".htm",
      ".xml",
      ".css",
      ".scss",
      ".sass",
      ".less",
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
      ".py",
      ".java",
      ".c",
      ".cpp",
      ".cc",
      ".cxx",
      ".h",
      ".hpp",
      ".cs",
      ".go",
      ".rs",
      ".rb",
      ".php",
      ".swift",
      ".kt",
      ".scala",
      ".clj",
      ".cljs",
      ".hs",
      ".elm",
      ".dart",
      ".r",
      ".m",
      ".mm",
      ".sh",
      ".bash",
      ".zsh",
      ".fish",
      ".ps1",
      ".bat",
      ".cmd",
      ".json",
      ".yaml",
      ".yml",
      ".toml",
      ".ini",
      ".cfg",
      ".conf",
      ".properties",
      ".env",
      ".gitignore",
      ".dockerignore",
      ".gitattributes",
      ".editorconfig",
      ".gradle",
      ".pom",
      ".sbt",
      ".maven",
      ".cmake",
      ".make",
      ".dockerfile",
      ".mod",
      ".sum",
      ".sql",
      ".graphql",
      ".gql",
      ".proto",
      ".thrift",
      ".avro",
      ".csv",
      ".tsv",
      ".log"
    ];
    const pathLower = path2.toLowerCase();
    const hasTextExtension = textExtensions.some((ext) => pathLower.endsWith(ext));
    const hasCompoundExtension = pathLower.includes(".env.") || pathLower.endsWith(".env") || pathLower.includes(".config.") || pathLower.includes(".lock");
    const fileName = path2.split("/").pop() || "";
    const fileNameLower = fileName.toLowerCase();
    const commonTextFiles = [
      "readme",
      "license",
      "changelog",
      "contributing",
      "authors",
      "maintainers",
      "dockerfile",
      "makefile",
      "rakefile",
      "gemfile",
      "podfile",
      "cartfile",
      "brewfile",
      "procfile",
      "vagrantfile",
      "gulpfile",
      "gruntfile",
      ".prettierrc",
      ".eslintrc",
      ".babelrc",
      ".nvmrc",
      ".npmrc"
    ];
    const isCommonTextFile = commonTextFiles.some((name) => {
      if (name.startsWith(".")) {
        return fileNameLower === name || fileNameLower.startsWith(`${name}.`);
      }
      return fileNameLower === name || fileNameLower.startsWith(`${name}.`);
    });
    if (hasTextExtension || hasCompoundExtension || isCommonTextFile) {
      return shouldIncludeUrl(path2, options.includePatterns, options.excludePatterns);
    }
    const mimeType = mime.getType(path2);
    if (mimeType?.startsWith("text/")) {
      logger.debug(`Including file with text MIME type: ${path2} (${mimeType})`);
      return shouldIncludeUrl(path2, options.includePatterns, options.excludePatterns);
    }
    return false;
  }
  /**
   * Checks if a path is within the specified subpath.
   */
  isWithinSubPath(path2, subPath) {
    if (!subPath) {
      return true;
    }
    const trimmedSubPath = subPath.replace(/^\/+/, "").replace(/\/+$/, "");
    if (trimmedSubPath.length === 0) {
      return true;
    }
    const normalizedPath = path2.replace(/^\/+/, "").replace(/\/+$/, "");
    if (normalizedPath === trimmedSubPath) {
      return true;
    }
    return normalizedPath.startsWith(`${trimmedSubPath}/`);
  }
  async processItem(item, options, signal) {
    if (item.url.startsWith("github-file://")) {
      logger.info(
        `🗑️  Legacy github-file:// URL detected, marking as deleted: ${item.url}`
      );
      return {
        url: item.url,
        links: [],
        status: FetchStatus.NOT_FOUND
      };
    }
    try {
      const parsedUrl = new URL(item.url);
      if (/^\/[^/]+\/[^/]+\/wiki($|\/)/.test(parsedUrl.pathname)) {
        return await this.wikiProcessor.process(item, options, signal);
      }
    } catch {
    }
    if (item.depth === 0) {
      const repoInfo = this.parseGitHubUrl(options.url);
      const { owner, repo } = repoInfo;
      logger.debug(`Discovering GitHub repository ${owner}/${repo}`);
      const discoveredLinks = [];
      if ("isBlob" in repoInfo && repoInfo.isBlob && repoInfo.filePath) {
        const { branch = "main", filePath } = repoInfo;
        logger.debug(
          `Single file URL detected: ${owner}/${repo}/${filePath} - indexing file only`
        );
        discoveredLinks.push(
          `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`
        );
        return {
          url: item.url,
          links: discoveredLinks,
          status: FetchStatus.SUCCESS
        };
      }
      const wikiUrl = `${options.url.replace(/\/$/, "")}/wiki`;
      discoveredLinks.push(wikiUrl);
      logger.debug(`Discovered wiki URL: ${wikiUrl}`);
      const { tree, resolvedBranch } = await this.fetchRepositoryTree(repoInfo, signal);
      const fileItems = tree.tree.filter((treeItem) => this.isWithinSubPath(treeItem.path, repoInfo.subPath)).filter((treeItem) => this.shouldProcessFile(treeItem, options));
      logger.debug(
        `Discovered ${fileItems.length} processable files in repository (branch: ${resolvedBranch})`
      );
      const fileUrls = fileItems.map(
        (treeItem) => `https://github.com/${owner}/${repo}/blob/${resolvedBranch}/${treeItem.path}`
      );
      discoveredLinks.push(...fileUrls);
      logger.debug(
        `Discovery complete: ${fileUrls.length} repo file(s) + 1 wiki URL = ${discoveredLinks.length} total URLs`
      );
      return { url: item.url, links: discoveredLinks, status: FetchStatus.SUCCESS };
    }
    try {
      const parsedUrl = new URL(item.url);
      if (/^\/[^/]+\/[^/]+\/blob\//.test(parsedUrl.pathname)) {
        logger.debug(`Processing HTTPS blob URL at depth ${item.depth}: ${item.url}`);
        return await this.repoProcessor.process(item, options, signal);
      }
    } catch (error) {
      logger.warn(`⚠️  Failed to parse blob URL ${item.url}: ${error}`);
      return { url: item.url, links: [], status: FetchStatus.SUCCESS };
    }
    logger.debug(`No further processing for URL at depth ${item.depth}: ${item.url}`);
    return { url: item.url, links: [], status: FetchStatus.SUCCESS };
  }
  async scrape(options, progressCallback, signal) {
    const url = new URL(options.url);
    if (!url.hostname.includes("github.com")) {
      throw new Error("URL must be a GitHub URL");
    }
    await super.scrape(options, progressCallback, signal);
  }
  async cleanup() {
    await Promise.all([this.wikiProcessor.cleanup(), this.repoProcessor.cleanup()]);
  }
}
class LocalFileStrategy extends BaseScraperStrategy {
  fileFetcher = new FileFetcher();
  pipelines;
  constructor(config) {
    super(config);
    this.pipelines = PipelineFactory$1.createStandardPipelines(config);
  }
  canHandle(url) {
    return url.startsWith("file://");
  }
  async processItem(item, options, _signal) {
    let filePath = item.url.replace(/^file:\/\/\/?/, "");
    filePath = decodeURIComponent(filePath);
    if (!filePath.startsWith("/") && process.platform !== "win32") {
      filePath = `/${filePath}`;
    }
    let stats;
    try {
      stats = await fs$1.stat(filePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        logger.info(`✓ File deleted or not available: ${filePath}`);
        return {
          url: item.url,
          links: [],
          status: FetchStatus.NOT_FOUND
        };
      }
      throw error;
    }
    if (stats.isDirectory()) {
      const contents = await fs$1.readdir(filePath);
      const links = contents.map((name) => `file://${path.join(filePath, name)}`).filter((url) => this.shouldProcessUrl(url, options));
      return { url: item.url, links, status: FetchStatus.SUCCESS };
    }
    const rawContent = await this.fileFetcher.fetch(item.url, {
      etag: item.etag
    });
    if (rawContent.status === FetchStatus.NOT_MODIFIED) {
      logger.debug(`✓ File unchanged: ${filePath}`);
      return { url: rawContent.source, links: [], status: FetchStatus.NOT_MODIFIED };
    }
    let processed;
    for (const pipeline of this.pipelines) {
      if (pipeline.canProcess(rawContent.mimeType, rawContent.content)) {
        logger.debug(
          `Selected ${pipeline.constructor.name} for content type "${rawContent.mimeType}" (${filePath})`
        );
        processed = await pipeline.process(rawContent, options, this.fileFetcher);
        break;
      }
    }
    if (!processed) {
      logger.warn(
        `⚠️  Unsupported content type "${rawContent.mimeType}" for file ${filePath}. Skipping processing.`
      );
      return { url: rawContent.source, links: [], status: FetchStatus.SUCCESS };
    }
    for (const err of processed.errors ?? []) {
      logger.warn(`⚠️  Processing error for ${filePath}: ${err.message}`);
    }
    const filename = path.basename(filePath);
    const title = processed.title?.trim() || filename || null;
    return {
      url: rawContent.source,
      title,
      etag: rawContent.etag,
      lastModified: rawContent.lastModified,
      contentType: rawContent.mimeType,
      content: processed,
      links: [],
      status: FetchStatus.SUCCESS
    };
  }
  /**
   * Cleanup resources used by this strategy, specifically the pipeline browser instances.
   */
  async cleanup() {
    await Promise.allSettled(this.pipelines.map((pipeline) => pipeline.close()));
  }
}
class WebScraperStrategy extends BaseScraperStrategy {
  fetcher;
  shouldFollowLinkFn;
  pipelines;
  constructor(config, options = {}) {
    super(config, { urlNormalizerOptions: options.urlNormalizerOptions });
    this.shouldFollowLinkFn = options.shouldFollowLink;
    this.fetcher = new AutoDetectFetcher(config.scraper);
    this.pipelines = PipelineFactory$1.createStandardPipelines(config);
  }
  canHandle(url) {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
    } catch {
      return false;
    }
  }
  // Removed custom isInScope logic; using shared scope utility for consistent behavior
  /**
   * Processes a single queue item by fetching its content and processing it through pipelines.
   * @param item - The queue item to process.
   * @param options - Scraper options including headers for HTTP requests.
   * @param _progressCallback - Optional progress callback (not used here).
   * @param signal - Optional abort signal for request cancellation.
   * @returns An object containing the processed document and extracted links.
   */
  async processItem(item, options, signal) {
    const { url } = item;
    try {
      if (item.etag) {
        logger.debug(`Processing ${url} with stored ETag: ${item.etag}`);
      }
      const fetchOptions = {
        signal,
        followRedirects: options.followRedirects,
        headers: options.headers,
        // Forward custom headers
        etag: item.etag
        // Pass ETag for conditional requests
      };
      const rawContent = await this.fetcher.fetch(url, fetchOptions);
      logger.debug(
        `Fetch result for ${url}: status=${rawContent.status}, etag=${rawContent.etag || "none"}`
      );
      if (rawContent.status !== FetchStatus.SUCCESS) {
        logger.debug(`Skipping pipeline for ${url} due to status: ${rawContent.status}`);
        return { url: rawContent.source, links: [], status: rawContent.status };
      }
      let processed;
      for (const pipeline of this.pipelines) {
        const contentBuffer = Buffer.isBuffer(rawContent.content) ? rawContent.content : Buffer.from(rawContent.content);
        if (pipeline.canProcess(rawContent.mimeType || "text/plain", contentBuffer)) {
          logger.debug(
            `Selected ${pipeline.constructor.name} for content type "${rawContent.mimeType}" (${url})`
          );
          processed = await pipeline.process(rawContent, options, this.fetcher);
          break;
        }
      }
      if (!processed) {
        logger.warn(
          `⚠️  Unsupported content type "${rawContent.mimeType}" for URL ${url}. Skipping processing.`
        );
        return { url: rawContent.source, links: [], status: FetchStatus.SUCCESS };
      }
      for (const err of processed.errors ?? []) {
        logger.warn(`⚠️  Processing error for ${url}: ${err.message}`);
      }
      if (!processed.textContent || !processed.textContent.trim()) {
        logger.warn(
          `⚠️  No processable content found for ${url} after pipeline execution.`
        );
        return {
          url: rawContent.source,
          links: processed.links,
          status: FetchStatus.SUCCESS
        };
      }
      if (item.depth === 0) {
        this.canonicalBaseUrl = new URL(rawContent.source);
      }
      const filteredLinks = processed.links?.filter((link) => {
        try {
          const targetUrl = new URL(link);
          if (!this.shouldProcessUrl(targetUrl.href, options)) {
            return false;
          }
          if (this.shouldFollowLinkFn) {
            const baseUrl = this.canonicalBaseUrl ?? new URL(options.url);
            return this.shouldFollowLinkFn(baseUrl, targetUrl);
          }
          return true;
        } catch {
          return false;
        }
      }) ?? [];
      return {
        url: rawContent.source,
        etag: rawContent.etag,
        lastModified: rawContent.lastModified,
        contentType: processed.contentType || rawContent.mimeType,
        content: processed,
        links: filteredLinks,
        status: FetchStatus.SUCCESS
      };
    } catch (error) {
      logger.error(`❌ Failed processing page ${url}: ${error}`);
      throw error;
    }
  }
  /**
   * Cleanup resources used by this strategy, specifically the pipeline browser instances and fetcher.
   */
  async cleanup() {
    await Promise.allSettled([
      ...this.pipelines.map((pipeline) => pipeline.close()),
      this.fetcher.close()
    ]);
  }
}
class NpmScraperStrategy {
  defaultStrategy;
  canHandle(url) {
    const { hostname } = new URL(url);
    return ["npmjs.org", "npmjs.com", "www.npmjs.com"].includes(hostname);
  }
  constructor(config) {
    this.defaultStrategy = new WebScraperStrategy(config, {
      urlNormalizerOptions: {
        ignoreCase: true,
        removeHash: true,
        removeTrailingSlash: true,
        removeQuery: true
        // Enable removeQuery for NPM packages
      }
    });
  }
  async scrape(options, progressCallback, signal) {
    await this.defaultStrategy.scrape(options, progressCallback, signal);
  }
  /**
   * Cleanup resources used by this strategy.
   */
  async cleanup() {
    await this.defaultStrategy.cleanup();
  }
}
class PyPiScraperStrategy {
  defaultStrategy;
  canHandle(url) {
    const { hostname } = new URL(url);
    return ["pypi.org", "www.pypi.org"].includes(hostname);
  }
  constructor(config) {
    this.defaultStrategy = new WebScraperStrategy(config, {
      urlNormalizerOptions: {
        ignoreCase: true,
        removeHash: true,
        removeTrailingSlash: true,
        removeQuery: true
        // Enable removeQuery for PyPI packages
      }
    });
  }
  async scrape(options, progressCallback, signal) {
    await this.defaultStrategy.scrape(options, progressCallback, signal);
  }
  /**
   * Cleanup resources used by this strategy.
   */
  async cleanup() {
    await this.defaultStrategy.cleanup();
  }
}
class ScraperRegistry {
  strategies;
  constructor(config) {
    this.strategies = [
      new NpmScraperStrategy(config),
      new PyPiScraperStrategy(config),
      new GitHubScraperStrategy(config),
      new WebScraperStrategy(config, {}),
      new LocalFileStrategy(config)
    ];
  }
  getStrategy(url) {
    validateUrl(url);
    const strategy = this.strategies.find((s) => s.canHandle(url));
    if (!strategy) {
      throw new ScraperError(`No strategy found for URL: ${url}`);
    }
    logger.debug(`Using strategy "${strategy.constructor.name}" for URL: ${url}`);
    return strategy;
  }
  /**
   * Cleanup all registered strategies to prevent resource leaks.
   * Should be called when the registry is no longer needed.
   */
  async cleanup() {
    await Promise.allSettled(this.strategies.map((strategy) => strategy.cleanup?.()));
  }
}
class ScraperService {
  registry;
  constructor(registry) {
    this.registry = registry;
  }
  /**
   * Scrapes content from the provided URL using the appropriate strategy.
   * Reports progress via callback and handles errors.
   */
  async scrape(options, progressCallback, signal) {
    const strategy = this.registry.getStrategy(options.url);
    if (!strategy) {
      throw new ScraperError(`No scraper strategy found for URL: ${options.url}`, false);
    }
    await strategy.scrape(options, progressCallback, signal);
  }
  /**
   * Cleanup the scraper registry and all its strategies.
   * Should be called when the service is no longer needed.
   */
  async cleanup() {
    await this.registry.cleanup();
  }
}
class PipelineWorker {
  // Dependencies are passed in, making the worker stateless regarding specific jobs
  store;
  scraperService;
  // Constructor accepts dependencies needed for execution
  constructor(store, scraperService) {
    this.store = store;
    this.scraperService = scraperService;
  }
  /**
   * Executes the given pipeline job.
   * @param job - The job to execute.
   * @param callbacks - Internal callbacks provided by the manager for reporting.
   */
  async executeJob(job, callbacks) {
    const { id: jobId, library, version, scraperOptions, abortController } = job;
    const signal = abortController.signal;
    logger.debug(`[${jobId}] Worker starting job for ${library}@${version}`);
    try {
      if (!scraperOptions.isRefresh) {
        await this.store.removeAllDocuments(library, version);
        logger.info(
          `💾 Cleared store for ${library}@${version || "latest"} before scraping.`
        );
      } else {
        logger.info(
          `🔄 Refresh operation - preserving existing data for ${library}@${version || "latest"}.`
        );
      }
      await this.scraperService.scrape(
        scraperOptions,
        async (progress) => {
          if (signal.aborted) {
            throw new CancellationError("Job cancelled during scraping progress");
          }
          await callbacks.onJobProgress?.(job, progress);
          if (progress.deleted && progress.pageId) {
            try {
              await this.store.deletePage(progress.pageId);
              logger.debug(
                `[${jobId}] Deleted page ${progress.pageId}: ${progress.currentUrl}`
              );
            } catch (docError) {
              logger.error(
                `❌ [${jobId}] Failed to delete page ${progress.pageId}: ${docError}`
              );
              const error = docError instanceof Error ? docError : new Error(String(docError));
              await callbacks.onJobError?.(job, error);
              throw error;
            }
          } else if (progress.result) {
            try {
              if (progress.pageId) {
                await this.store.deletePage(progress.pageId);
                logger.debug(
                  `[${jobId}] Refreshing page ${progress.pageId}: ${progress.currentUrl}`
                );
              }
              await this.store.addScrapeResult(
                library,
                version,
                progress.depth,
                progress.result
              );
              logger.debug(`[${jobId}] Stored processed content: ${progress.currentUrl}`);
            } catch (docError) {
              logger.error(
                `❌ [${jobId}] Failed to process content ${progress.currentUrl}: ${docError}`
              );
              await callbacks.onJobError?.(
                job,
                docError instanceof Error ? docError : new Error(String(docError)),
                progress.result
              );
            }
          }
        },
        signal
        // Pass signal to scraper service
      );
      if (signal.aborted) {
        throw new CancellationError("Job cancelled");
      }
      logger.debug(`[${jobId}] Worker finished job successfully.`);
    } catch (error) {
      logger.warn(`⚠️  [${jobId}] Worker encountered error: ${error}`);
      throw error;
    }
  }
  // --- Old methods removed ---
  // process()
  // stop()
  // setCallbacks()
  // handleScrapingProgress()
}
class PipelineManager {
  jobMap = /* @__PURE__ */ new Map();
  jobQueue = [];
  activeWorkers = /* @__PURE__ */ new Set();
  isRunning = false;
  concurrency;
  store;
  scraperService;
  shouldRecoverJobs;
  eventBus;
  appConfig;
  constructor(store, eventBus, options) {
    this.store = store;
    this.eventBus = eventBus;
    this.appConfig = options.appConfig;
    this.concurrency = this.appConfig.scraper.maxConcurrency;
    this.shouldRecoverJobs = options.recoverJobs ?? true;
    const registry = new ScraperRegistry(this.appConfig);
    this.scraperService = new ScraperService(registry);
  }
  /**
   * No-op method for backward compatibility with IPipeline interface.
   * Events are now emitted directly to EventBusService.
   */
  setCallbacks(_callbacks) {
  }
  /**
   * Converts internal job representation to public job interface.
   */
  toPublicJob(job) {
    return {
      id: job.id,
      library: job.library,
      version: job.version || null,
      // Convert empty string to null for public API
      status: job.status,
      progress: job.progress,
      error: job.error ? { message: job.error.message } : null,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      versionId: job.versionId,
      versionStatus: job.versionStatus,
      progressPages: job.progressPages,
      progressMaxPages: job.progressMaxPages,
      errorMessage: job.errorMessage,
      updatedAt: job.updatedAt,
      sourceUrl: job.sourceUrl,
      scraperOptions: job.scraperOptions
    };
  }
  /**
   * Starts the pipeline manager's worker processing.
   */
  async start() {
    if (this.isRunning) {
      logger.warn("⚠️  PipelineManager is already running.");
      return;
    }
    this.isRunning = true;
    logger.debug(
      `PipelineManager started with concurrency ${this.concurrency}, recoverJobs: ${this.shouldRecoverJobs}.`
    );
    if (this.shouldRecoverJobs) {
      await this.recoverPendingJobs();
    } else {
      logger.debug("Job recovery disabled for this PipelineManager instance");
    }
    this._processQueue().catch((error) => {
      logger.error(`❌ Error in processQueue during start: ${error}`);
    });
  }
  /**
   * Recovers pending jobs from the database after server restart.
   * Finds versions with RUNNING status and resets them to QUEUED for re-processing.
   * Also loads all QUEUED versions back into the pipeline queue.
   */
  async recoverPendingJobs() {
    try {
      const runningVersions = await this.store.getVersionsByStatus([
        VersionStatus.RUNNING
      ]);
      for (const version of runningVersions) {
        await this.store.updateVersionStatus(version.id, VersionStatus.QUEUED);
        logger.info(
          `🔄 Reset interrupted job to QUEUED: ${version.library_name}@${version.name || "latest"}`
        );
      }
      const queuedVersions = await this.store.getVersionsByStatus([VersionStatus.QUEUED]);
      for (const version of queuedVersions) {
        const jobId = v4();
        const abortController = new AbortController();
        let resolveCompletion;
        let rejectCompletion;
        const completionPromise = new Promise((resolve, reject) => {
          resolveCompletion = resolve;
          rejectCompletion = reject;
        });
        completionPromise.catch(() => {
        });
        let parsedScraperOptions = null;
        if (version.scraper_options) {
          try {
            parsedScraperOptions = JSON.parse(version.scraper_options);
          } catch (error) {
            logger.warn(
              `⚠️  Failed to parse scraper options for ${version.library_name}@${version.name || "latest"}: ${error}`
            );
          }
        }
        const job = {
          id: jobId,
          library: version.library_name,
          version: version.name || "",
          status: PipelineJobStatus.QUEUED,
          progress: null,
          error: null,
          createdAt: new Date(version.created_at),
          // For recovered QUEUED jobs, startedAt must be null to reflect queued state.
          startedAt: null,
          finishedAt: null,
          abortController,
          completionPromise,
          resolveCompletion,
          rejectCompletion,
          // Database fields (single source of truth)
          versionId: version.id,
          versionStatus: version.status,
          progressPages: version.progress_pages,
          progressMaxPages: version.progress_max_pages,
          errorMessage: version.error_message,
          updatedAt: new Date(version.updated_at),
          sourceUrl: version.source_url,
          scraperOptions: parsedScraperOptions
        };
        this.jobMap.set(jobId, job);
        this.jobQueue.push(jobId);
      }
      if (queuedVersions.length > 0) {
        logger.info(`📥 Recovered ${queuedVersions.length} pending job(s) from database`);
      } else {
        logger.debug("No pending jobs to recover from database");
      }
    } catch (error) {
      logger.error(`❌ Failed to recover pending jobs: ${error}`);
    }
  }
  /**
   * Stops the pipeline manager and attempts to gracefully shut down workers.
   * Currently, it just stops processing new jobs. Cancellation of active jobs
   * needs explicit `cancelJob` calls.
   */
  async stop() {
    if (!this.isRunning) {
      logger.warn("⚠️  PipelineManager is not running.");
      return;
    }
    this.isRunning = false;
    logger.debug("PipelineManager stopping. No new jobs will be started.");
    await this.scraperService.cleanup();
  }
  /**
   * Enqueues a new document processing job, aborting any existing QUEUED/RUNNING job for the same library+version (including unversioned).
   */
  async enqueueScrapeJob(library, version, options) {
    const normalizedVersion = version ?? "";
    const allJobs = await this.getJobs();
    const duplicateJobs = allJobs.filter(
      (job2) => job2.library === library && (job2.version ?? "") === normalizedVersion && // Normalize null to empty string for comparison
      [PipelineJobStatus.QUEUED, PipelineJobStatus.RUNNING].includes(job2.status)
    );
    for (const job2 of duplicateJobs) {
      logger.info(
        `🚫 Aborting duplicate job for ${library}@${normalizedVersion}: ${job2.id}`
      );
      await this.cancelJob(job2.id);
    }
    const jobId = v4();
    const abortController = new AbortController();
    let resolveCompletion;
    let rejectCompletion;
    const completionPromise = new Promise((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    completionPromise.catch(() => {
    });
    const job = {
      id: jobId,
      library,
      version: normalizedVersion,
      status: PipelineJobStatus.QUEUED,
      progress: null,
      error: null,
      createdAt: /* @__PURE__ */ new Date(),
      startedAt: null,
      finishedAt: null,
      abortController,
      completionPromise,
      resolveCompletion,
      rejectCompletion,
      // Database fields (single source of truth)
      // Will be populated by updateJobStatus
      progressPages: 0,
      progressMaxPages: 0,
      errorMessage: null,
      updatedAt: /* @__PURE__ */ new Date(),
      sourceUrl: options.url,
      scraperOptions: options
    };
    this.jobMap.set(jobId, job);
    this.jobQueue.push(jobId);
    logger.info(
      `📝 Job enqueued: ${jobId} for ${library}${normalizedVersion ? `@${normalizedVersion}` : " (latest)"}`
    );
    await this.updateJobStatus(job, PipelineJobStatus.QUEUED);
    if (this.isRunning) {
      this._processQueue().catch((error) => {
        logger.error(`❌ Error in processQueue during enqueue: ${error}`);
      });
    }
    return jobId;
  }
  /**
   * Enqueues a refresh job for an existing library version by re-scraping all pages
   * and using ETag comparison to skip unchanged content.
   *
   * If the version was never completed (interrupted or failed scrape), performs a
   * full re-scrape from scratch instead of a refresh to ensure completeness.
   */
  async enqueueRefreshJob(library, version) {
    const normalizedVersion = version ?? "";
    try {
      const versionId = await this.store.ensureVersion({
        library,
        version: normalizedVersion
      });
      const versionInfo = await this.store.getVersionById(versionId);
      if (!versionInfo) {
        throw new Error(`Version ID ${versionId} not found`);
      }
      const libraryInfo = await this.store.getLibraryById(versionInfo.library_id);
      if (!libraryInfo) {
        throw new Error(`Library ID ${versionInfo.library_id} not found`);
      }
      if (versionInfo && versionInfo.status !== VersionStatus.COMPLETED) {
        logger.info(
          `⚠️  Version ${library}@${normalizedVersion || "latest"} has status "${versionInfo.status}". Performing full re-scrape instead of refresh.`
        );
        return this.enqueueJobWithStoredOptions(library, normalizedVersion);
      }
      const pages = await this.store.getPagesByVersionId(versionId);
      if (pages.length > 0) {
        logger.debug(
          `Sample page data: url=${pages[0].url}, etag=${pages[0].etag}, depth=${pages[0].depth}`
        );
      }
      if (pages.length === 0) {
        throw new Error(
          `No pages found for ${library}@${normalizedVersion || "latest"}. Use scrape_docs to index it first.`
        );
      }
      logger.info(
        `🔄 Preparing refresh job for ${library}@${normalizedVersion || "latest"} with ${pages.length} page(s)`
      );
      const initialQueue = pages.map((page) => ({
        url: page.url,
        depth: page.depth ?? 0,
        // Use original depth, fallback to 0 for old data
        pageId: page.id,
        etag: page.etag
      }));
      const storedOptions = await this.store.getScraperOptions(versionId);
      const scraperOptions = {
        url: storedOptions?.sourceUrl || pages[0].url,
        // Required but not used when initialQueue is set
        library,
        version: normalizedVersion,
        ...storedOptions?.options || {},
        // Include stored options if available (spread first)
        // Override with refresh-specific options (these must come after the spread)
        initialQueue,
        // Pre-populated queue with existing pages
        isRefresh: true
        // Mark this as a refresh operation
      };
      logger.info(
        `📝 Enqueueing refresh job for ${library}@${normalizedVersion || "latest"}`
      );
      return this.enqueueScrapeJob(library, normalizedVersion, scraperOptions);
    } catch (error) {
      logger.error(`❌ Failed to enqueue refresh job: ${error}`);
      throw error;
    }
  }
  /**
   * Enqueues a job using stored scraper options from a previous indexing run.
   * If no stored options are found, throws an error.
   */
  async enqueueJobWithStoredOptions(library, version) {
    const normalizedVersion = version ?? "";
    try {
      const versionId = await this.store.ensureVersion({
        library,
        version: normalizedVersion
      });
      const stored = await this.store.getScraperOptions(versionId);
      if (!stored) {
        throw new Error(
          `No stored scraper options found for ${library}@${normalizedVersion || "latest"}`
        );
      }
      const storedOptions = stored.options;
      const completeOptions = {
        url: stored.sourceUrl,
        library,
        version: normalizedVersion,
        ...storedOptions
      };
      logger.info(
        `🔄 Re-indexing ${library}@${normalizedVersion || "latest"} with stored options from ${stored.sourceUrl}`
      );
      return this.enqueueScrapeJob(library, normalizedVersion, completeOptions);
    } catch (error) {
      logger.error(`❌ Failed to enqueue job with stored options: ${error}`);
      throw error;
    }
  }
  /**
   * Retrieves the current state of a specific job.
   */
  async getJob(jobId) {
    const internalJob = this.jobMap.get(jobId);
    return internalJob ? this.toPublicJob(internalJob) : void 0;
  }
  /**
   * Retrieves the current state of all jobs (or a subset based on status).
   */
  async getJobs(status) {
    const allJobs = Array.from(this.jobMap.values());
    const filteredJobs = status ? allJobs.filter((job) => job.status === status) : allJobs;
    return filteredJobs.map((job) => this.toPublicJob(job));
  }
  /**
   * Returns a promise that resolves when the specified job completes, fails, or is cancelled.
   * For cancelled jobs, this resolves successfully rather than rejecting.
   */
  async waitForJobCompletion(jobId) {
    const job = this.jobMap.get(jobId);
    if (!job) {
      throw new PipelineStateError(`Job not found: ${jobId}`);
    }
    try {
      await job.completionPromise;
    } catch (error) {
      if (error instanceof CancellationError || job.status === PipelineJobStatus.CANCELLED) {
        return;
      }
      throw error;
    }
  }
  /**
   * Attempts to cancel a queued or running job.
   */
  async cancelJob(jobId) {
    const job = this.jobMap.get(jobId);
    if (!job) {
      logger.warn(`❓ Attempted to cancel non-existent job: ${jobId}`);
      return;
    }
    switch (job.status) {
      case PipelineJobStatus.QUEUED:
        this.jobQueue = this.jobQueue.filter((id) => id !== jobId);
        await this.updateJobStatus(job, PipelineJobStatus.CANCELLED);
        job.finishedAt = /* @__PURE__ */ new Date();
        logger.info(`🚫 Job cancelled (was queued): ${jobId}`);
        job.rejectCompletion(new PipelineStateError("Job cancelled before starting"));
        break;
      case PipelineJobStatus.RUNNING:
        await this.updateJobStatus(job, PipelineJobStatus.CANCELLING);
        job.abortController.abort();
        logger.info(`🚫 Signalling cancellation for running job: ${jobId}`);
        break;
      case PipelineJobStatus.COMPLETED:
      case PipelineJobStatus.FAILED:
      case PipelineJobStatus.CANCELLED:
      case PipelineJobStatus.CANCELLING:
        logger.warn(
          `⚠️  Job ${jobId} cannot be cancelled in its current state: ${job.status}`
        );
        break;
      default:
        logger.error(`❌ Unhandled job status for cancellation: ${job.status}`);
        break;
    }
  }
  /**
   * Removes all jobs that are in a final state (completed, cancelled, or failed).
   * Only removes jobs that are not currently in the queue or actively running.
   * @returns The number of jobs that were cleared.
   */
  async clearCompletedJobs() {
    const completedStatuses = [
      PipelineJobStatus.COMPLETED,
      PipelineJobStatus.CANCELLED,
      PipelineJobStatus.FAILED
    ];
    let clearedCount = 0;
    const jobsToRemove = [];
    for (const [jobId, job] of this.jobMap.entries()) {
      if (completedStatuses.includes(job.status)) {
        jobsToRemove.push(jobId);
        clearedCount++;
      }
    }
    for (const jobId of jobsToRemove) {
      this.jobMap.delete(jobId);
    }
    if (clearedCount > 0) {
      logger.info(`🧹 Cleared ${clearedCount} completed job(s) from the queue`);
      this.eventBus.emit(EventType.JOB_LIST_CHANGE, void 0);
    } else {
      logger.debug("No completed jobs to clear");
    }
    return clearedCount;
  }
  // --- Private Methods ---
  /**
   * Processes the job queue, starting new workers if capacity allows.
   */
  async _processQueue() {
    if (!this.isRunning) return;
    while (this.activeWorkers.size < this.concurrency && this.jobQueue.length > 0) {
      const jobId = this.jobQueue.shift();
      if (!jobId) continue;
      const job = this.jobMap.get(jobId);
      if (!job || job.status !== PipelineJobStatus.QUEUED) {
        logger.warn(`⏭️ Skipping job ${jobId} in queue (not found or not queued).`);
        continue;
      }
      this.activeWorkers.add(jobId);
      await this.updateJobStatus(job, PipelineJobStatus.RUNNING);
      job.startedAt = /* @__PURE__ */ new Date();
      this._runJob(job).catch(async (error) => {
        logger.error(`❌ Unhandled error during job ${jobId} execution: ${error}`);
        if (job.status !== PipelineJobStatus.FAILED && job.status !== PipelineJobStatus.CANCELLED) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await this.updateJobStatus(job, PipelineJobStatus.FAILED, errorMessage);
          job.error = error instanceof Error ? error : new Error(String(error));
          job.finishedAt = /* @__PURE__ */ new Date();
          job.rejectCompletion(job.error);
        }
        this.activeWorkers.delete(jobId);
        this._processQueue().catch((error2) => {
          logger.error(`❌ Error in processQueue after job completion: ${error2}`);
        });
      });
    }
  }
  /**
   * Executes a single pipeline job by delegating to a PipelineWorker.
   * Handles final status updates and promise resolution/rejection.
   */
  async _runJob(job) {
    const { id: jobId, abortController } = job;
    const signal = abortController.signal;
    const worker = new PipelineWorker(this.store, this.scraperService);
    try {
      await worker.executeJob(job, {
        onJobProgress: async (internalJob, progress) => {
          await this.updateJobProgress(internalJob, progress);
        },
        onJobError: async (internalJob, error, document2) => {
          logger.warn(
            `⚠️  Job ${internalJob.id} error ${document2 ? `on document ${document2.url}` : ""}: ${error.message}`
          );
        }
      });
      if (signal.aborted) {
        throw new CancellationError("Job cancelled just before completion");
      }
      await this.updateJobStatus(job, PipelineJobStatus.COMPLETED);
      job.finishedAt = /* @__PURE__ */ new Date();
      job.resolveCompletion();
      logger.info(`✅ Job completed: ${jobId}`);
    } catch (error) {
      if (error instanceof CancellationError || signal.aborted) {
        await this.updateJobStatus(job, PipelineJobStatus.CANCELLED);
        job.finishedAt = /* @__PURE__ */ new Date();
        const cancellationError = error instanceof CancellationError ? error : new CancellationError("Job cancelled by signal");
        logger.info(`🚫 Job execution cancelled: ${jobId}: ${cancellationError.message}`);
        job.rejectCompletion(cancellationError);
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await this.updateJobStatus(job, PipelineJobStatus.FAILED, errorMessage);
        job.error = error instanceof Error ? error : new Error(String(error));
        job.finishedAt = /* @__PURE__ */ new Date();
        logger.error(`❌ Job failed: ${jobId}: ${job.error}`);
        job.rejectCompletion(job.error);
      }
    } finally {
      this.activeWorkers.delete(jobId);
      this._processQueue().catch((error) => {
        logger.error(`❌ Error in processQueue after job cleanup: ${error}`);
      });
    }
  }
  /**
   * Maps PipelineJobStatus to VersionStatus for database storage.
   */
  mapJobStatusToVersionStatus(jobStatus) {
    switch (jobStatus) {
      case PipelineJobStatus.QUEUED:
        return VersionStatus.QUEUED;
      case PipelineJobStatus.RUNNING:
        return VersionStatus.RUNNING;
      case PipelineJobStatus.COMPLETED:
        return VersionStatus.COMPLETED;
      case PipelineJobStatus.FAILED:
        return VersionStatus.FAILED;
      case PipelineJobStatus.CANCELLED:
        return VersionStatus.CANCELLED;
      case PipelineJobStatus.CANCELLING:
        return VersionStatus.RUNNING;
      // Keep as running in DB until actually cancelled
      default:
        return VersionStatus.NOT_INDEXED;
    }
  }
  /**
   * Updates both in-memory job status and database version status (write-through).
   */
  async updateJobStatus(job, newStatus, errorMessage) {
    job.status = newStatus;
    if (errorMessage) {
      job.errorMessage = errorMessage;
    }
    job.updatedAt = /* @__PURE__ */ new Date();
    try {
      const versionId = await this.store.ensureLibraryAndVersion(
        job.library,
        job.version
      );
      job.versionId = versionId;
      job.versionStatus = this.mapJobStatusToVersionStatus(newStatus);
      const dbStatus = this.mapJobStatusToVersionStatus(newStatus);
      await this.store.updateVersionStatus(versionId, dbStatus, errorMessage);
      if (newStatus === PipelineJobStatus.QUEUED && job.scraperOptions) {
        try {
          await this.store.storeScraperOptions(versionId, job.scraperOptions);
          logger.debug(
            `Stored scraper options for ${job.library}@${job.version}: ${job.sourceUrl}`
          );
        } catch (optionsError) {
          logger.warn(
            `⚠️  Failed to store scraper options for job ${job.id}: ${optionsError}`
          );
        }
      }
    } catch (error) {
      logger.error(`❌ Failed to update database status for job ${job.id}: ${error}`);
    }
    const publicJob = this.toPublicJob(job);
    this.eventBus.emit(EventType.JOB_STATUS_CHANGE, publicJob);
    this.eventBus.emit(EventType.LIBRARY_CHANGE, void 0);
    logger.debug(`Job ${job.id} status changed to: ${job.status}`);
  }
  /**
   * Updates both in-memory job progress and database progress (write-through).
   * Also emits progress events to the EventBusService.
   */
  async updateJobProgress(job, progress) {
    job.progress = progress;
    job.progressPages = progress.pagesScraped;
    job.progressMaxPages = progress.totalPages;
    job.updatedAt = /* @__PURE__ */ new Date();
    if (job.versionId) {
      try {
        await this.store.updateVersionProgress(
          job.versionId,
          progress.pagesScraped,
          progress.totalPages
        );
      } catch (error) {
        logger.error(`❌ Failed to update database progress for job ${job.id}: ${error}`);
      }
    }
    const publicJob = this.toPublicJob(job);
    this.eventBus.emit(EventType.JOB_PROGRESS, { job: publicJob, progress });
    logger.debug(
      `Job ${job.id} progress: ${progress.pagesScraped}/${progress.totalPages} pages`
    );
  }
}
var PipelineFactory2;
((PipelineFactory22) => {
  async function createPipeline(docService, eventBus, options) {
    const { recoverJobs = false, serverUrl, appConfig } = options;
    logger.debug(
      `Creating pipeline: recoverJobs=${recoverJobs}, serverUrl=${serverUrl || "none"}`
    );
    if (serverUrl) {
      if (!eventBus) {
        throw new Error("Remote pipeline requires EventBusService");
      }
      logger.debug(`Creating PipelineClient for external worker at: ${serverUrl}`);
      return new PipelineClient(serverUrl, eventBus);
    }
    if (!docService || !eventBus) {
      throw new Error(
        "Local pipeline requires both DocumentManagementService and EventBusService"
      );
    }
    return new PipelineManager(docService, eventBus, { recoverJobs, appConfig });
  }
  PipelineFactory22.createPipeline = createPipeline;
})(PipelineFactory2 || (PipelineFactory2 = {}));
let activeAppServer = null;
let activeMcpStdioServer = null;
let activeDocService = null;
let activePipelineManager = null;
let activeTelemetryService = null;
function registerGlobalServices(services) {
  if (services.appServer) activeAppServer = services.appServer;
  if (services.mcpStdioServer) activeMcpStdioServer = services.mcpStdioServer;
  if (services.docService) activeDocService = services.docService;
  if (services.pipeline) activePipelineManager = services.pipeline;
  if (services.telemetryService) activeTelemetryService = services.telemetryService;
}
function getActiveAppServer() {
  return activeAppServer;
}
function setActiveAppServer(server) {
  activeAppServer = server;
}
function getActiveMcpStdioServer() {
  return activeMcpStdioServer;
}
function setActiveMcpStdioServer(server) {
  activeMcpStdioServer = server;
}
function getActiveDocService() {
  return activeDocService;
}
function setActiveDocService(service) {
  activeDocService = service;
}
function getActivePipelineManager() {
  return activePipelineManager;
}
function setActivePipelineManager(pipeline) {
  activePipelineManager = pipeline;
}
function getActiveTelemetryService() {
  return activeTelemetryService;
}
function setActiveTelemetryService(service) {
  activeTelemetryService = service;
}
function getEventBus(argv) {
  const eventBus = argv._eventBus;
  if (!eventBus) {
    throw new Error("EventBusService not initialized");
  }
  return eventBus;
}
function ensurePlaywrightBrowsersInstalled() {
  if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1") {
    logger.debug(
      "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set, skipping Playwright browser install."
    );
    return;
  }
  const chromiumEnvPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (chromiumEnvPath && existsSync(chromiumEnvPath)) {
    logger.debug(
      `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is set to '${chromiumEnvPath}', skipping Playwright browser install.`
    );
    return;
  }
  try {
    const chromiumPath = chromium.executablePath();
    if (!chromiumPath || !existsSync(chromiumPath)) {
      throw new Error("Playwright Chromium browser not found");
    }
  } catch (error) {
    logger.debug(String(error));
    try {
      console.log(
        "🌐 Installing Playwright Chromium browser... (this may take a moment)"
      );
      execSync("npm exec -y playwright install --no-shell --with-deps chromium", {
        stdio: "ignore",
        // Suppress output
        cwd: getProjectRoot()
      });
    } catch (_installErr) {
      console.error(
        "❌ Failed to install Playwright browsers automatically. Please run:\n  npx playwright install --no-shell --with-deps chromium\nand try again."
      );
      process.exit(1);
    }
  }
}
function resolveProtocol(protocol) {
  if (protocol === "auto") {
    if (!process.stdin.isTTY && !process.stdout.isTTY) {
      return "stdio";
    }
    return "http";
  }
  if (protocol === "stdio" || protocol === "http") {
    return protocol;
  }
  throw new Error(`Invalid protocol: ${protocol}. Must be 'auto', 'stdio', or 'http'`);
}
const formatOutput = (data) => JSON.stringify(data, null, 2);
function setupLogging(options, protocol) {
  if (options.silent) {
    setLogLevel(LogLevel.ERROR);
  } else if (options.verbose) {
    setLogLevel(LogLevel.DEBUG);
  }
}
function validatePort(portString) {
  const port = Number.parseInt(portString, 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error("Invalid port number");
  }
  return port;
}
function validateHost(hostString) {
  const trimmed = hostString.trim();
  if (!trimmed) {
    throw new Error("Host cannot be empty");
  }
  if (trimmed.includes(" ") || trimmed.includes("	") || trimmed.includes("\n")) {
    throw new Error("Host cannot contain whitespace");
  }
  return trimmed;
}
function createAppServerConfig(options) {
  return {
    enableWebInterface: options.enableWebInterface ?? false,
    enableMcpServer: options.enableMcpServer ?? true,
    enableApiServer: options.enableApiServer ?? false,
    enableWorker: options.enableWorker ?? true,
    port: options.port,
    externalWorkerUrl: options.externalWorkerUrl,
    startupContext: options.startupContext
  };
}
function parseHeaders(headerOptions) {
  const headers = {};
  if (Array.isArray(headerOptions)) {
    for (const entry of headerOptions) {
      const idx = entry.indexOf(":");
      if (idx > 0) {
        const name = entry.slice(0, idx).trim();
        const value = entry.slice(idx + 1).trim();
        if (name) headers[name] = value;
      }
    }
  }
  return headers;
}
function parseAuthConfig(options) {
  if (!options.authEnabled) {
    return void 0;
  }
  return {
    enabled: true,
    issuerUrl: options.authIssuerUrl,
    audience: options.authAudience,
    scopes: ["openid", "profile"]
    // Default scopes for OAuth2/OIDC
  };
}
function validateAuthConfig(authConfig) {
  if (!authConfig.enabled) {
    return;
  }
  const errors = [];
  if (!authConfig.issuerUrl) {
    errors.push("--auth-issuer-url is required when auth is enabled");
  } else {
    try {
      const url = new URL(authConfig.issuerUrl);
      if (url.protocol !== "https:") {
        errors.push("Issuer URL must use HTTPS protocol");
      }
    } catch {
      errors.push("Issuer URL must be a valid URL");
    }
  }
  if (!authConfig.audience) {
    errors.push("--auth-audience is required when auth is enabled");
  } else {
    try {
      const url = new URL(authConfig.audience);
      if (url.protocol === "http:" && url.hostname !== "localhost") {
        logger.warn(
          "⚠️  Audience uses HTTP protocol - consider using HTTPS for production"
        );
      }
      if (url.hash) {
        errors.push("Audience must not contain URL fragments");
      }
    } catch {
      if (authConfig.audience.startsWith("urn:")) {
        const urnParts = authConfig.audience.split(":");
        if (urnParts.length < 3 || !urnParts[1] || !urnParts[2]) {
          errors.push("URN audience must follow format: urn:namespace:specific-string");
        }
      } else {
        errors.push(
          "Audience must be a valid absolute URL or URN (e.g., https://api.example.com or urn:company:service)"
        );
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`Auth configuration validation failed:
${errors.join("\n")}`);
  }
}
function warnHttpUsage(authConfig, port) {
  if (!authConfig?.enabled) {
    return;
  }
  const isLocalhost = process.env.NODE_ENV !== "production" || port === 6280 || // default dev port
  process.env.HOSTNAME?.includes("localhost");
  if (!isLocalhost) {
    logger.warn(
      "⚠️  Authentication is enabled but running over HTTP in production. Consider using HTTPS for security."
    );
  }
}
function createDefaultAction(cli) {
  cli.command(
    ["$0", "server"],
    "Starts the Docs MCP server (Unified Mode)",
    (yargs2) => {
      return yargs2.option("protocol", {
        type: "string",
        description: "Protocol for MCP server",
        choices: ["auto", "stdio", "http"],
        default: "auto"
      }).option("port", {
        type: "string",
        // Keep as string to match old behavior/validation, or number? Using string allows environment variable mapping via loadConfig if strict number parsing isn't desired immediately. Actually validation logic expects string often. But Yargs can parse number.
        description: "Port for the server"
      }).option("host", {
        type: "string",
        description: "Host to bind the server to"
      }).option("embedding-model", {
        type: "string",
        description: "Embedding model configuration (e.g., 'openai:text-embedding-3-small')",
        alias: "embeddingModel"
      }).option("resume", {
        type: "boolean",
        description: "Resume interrupted jobs on startup",
        default: false
      }).option("read-only", {
        type: "boolean",
        description: "Run in read-only mode (only expose read tools, disable write/job tools)",
        default: false,
        alias: "readOnly"
      }).option("auth-enabled", {
        type: "boolean",
        description: "Enable OAuth2/OIDC authentication for MCP endpoints",
        default: false,
        alias: "authEnabled"
      }).option("auth-issuer-url", {
        type: "string",
        description: "Issuer/discovery URL for OAuth2/OIDC provider",
        alias: "authIssuerUrl"
      }).option("auth-audience", {
        type: "string",
        description: "JWT audience claim (identifies this protected resource)",
        alias: "authAudience"
      });
    },
    async (argv) => {
      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "default",
        protocol: argv.protocol,
        port: argv.port,
        host: argv.host,
        resume: argv.resume,
        readOnly: argv.readOnly,
        authEnabled: !!argv.authEnabled
      });
      const resolvedProtocol = resolveProtocol(argv.protocol);
      if (resolvedProtocol === "stdio") {
        setLogLevel(LogLevel.ERROR);
      }
      logger.debug("No subcommand specified, starting unified server by default...");
      const appConfig = loadConfig(argv, {
        configPath: argv.config,
        searchDir: argv.storePath
      });
      const authConfig = parseAuthConfig({
        authEnabled: appConfig.auth.enabled,
        authIssuerUrl: appConfig.auth.issuerUrl,
        authAudience: appConfig.auth.audience
      });
      if (authConfig) {
        validateAuthConfig(authConfig);
        warnHttpUsage(authConfig, appConfig.server.ports.default);
      }
      ensurePlaywrightBrowsersInstalled();
      const eventBus = getEventBus(argv);
      const docService = await createLocalDocumentManagement(eventBus, appConfig);
      const pipelineOptions = {
        recoverJobs: argv.resume || false,
        appConfig
      };
      const pipeline = await PipelineFactory2.createPipeline(
        docService,
        eventBus,
        pipelineOptions
      );
      if (resolvedProtocol === "stdio") {
        logger.debug(`Auto-detected stdio protocol (no TTY)`);
        await pipeline.start();
        const mcpTools = await initializeTools(docService, pipeline, appConfig);
        const mcpServer = await startStdioServer(mcpTools, appConfig);
        registerGlobalServices({
          mcpStdioServer: mcpServer,
          docService,
          pipeline
        });
        await new Promise(() => {
        });
      } else {
        logger.debug(`Auto-detected http protocol (TTY available)`);
        const config = createAppServerConfig({
          enableWebInterface: true,
          enableMcpServer: true,
          enableApiServer: true,
          enableWorker: true,
          port: appConfig.server.ports.default,
          startupContext: {
            cliCommand: "default",
            mcpProtocol: "http"
          }
        });
        const appServer = await startAppServer(
          docService,
          pipeline,
          eventBus,
          config,
          appConfig
        );
        registerGlobalServices({
          appServer,
          docService
        });
        await new Promise(() => {
        });
      }
    }
  );
}
function createFetchUrlCommand(cli) {
  cli.command(
    "fetch-url <url>",
    "Fetch a URL and transform it into Markdown format",
    (yargs2) => {
      return yargs2.positional("url", {
        type: "string",
        description: "URL to fetch",
        demandOption: true
      }).option("follow-redirects", {
        type: "boolean",
        description: "Follow HTTP redirects",
        default: true
      }).option("no-follow-redirects", {
        type: "boolean",
        description: "Disable following HTTP redirects",
        hidden: true
      }).option("scrape-mode", {
        choices: Object.values(ScrapeMode),
        description: "HTML processing strategy",
        default: ScrapeMode.Auto,
        alias: "scrapeMode"
      }).option("header", {
        type: "string",
        array: true,
        description: "Custom HTTP header to send with the request (can be specified multiple times)",
        default: []
      });
    },
    async (argv) => {
      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "fetch-url",
        url: argv.url,
        scrapeMode: argv.scrapeMode,
        followRedirects: argv.followRedirects,
        hasHeaders: argv.header?.length > 0
      });
      const url = argv.url;
      const headers = parseHeaders(argv.header || []);
      const appConfig = loadConfig(argv, {
        configPath: argv.config,
        searchDir: argv.storePath
        // resolved globally
      });
      const fetchUrlTool = new FetchUrlTool(
        new AutoDetectFetcher(appConfig.scraper),
        appConfig
      );
      const content = await fetchUrlTool.execute({
        url,
        followRedirects: argv.followRedirects,
        scrapeMode: argv.scrapeMode,
        headers: Object.keys(headers).length > 0 ? headers : void 0
      });
      console.log(content);
    }
  );
}
function createFindVersionCommand(cli) {
  cli.command(
    "find-version <library>",
    "Resolve and display the best matching documentation version for a library",
    (yargs2) => {
      return yargs2.version(false).positional("library", {
        type: "string",
        description: "Library name",
        demandOption: true
      }).option("version", {
        type: "string",
        description: "Pattern to match (optional, supports ranges)",
        alias: "v"
      }).option("server-url", {
        type: "string",
        description: "URL of external pipeline worker RPC (e.g., http://localhost:8080/api)",
        alias: "serverUrl"
      });
    },
    async (argv) => {
      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "find-version",
        library: argv.library,
        version: argv.version,
        useServerUrl: !!argv.serverUrl
      });
      const library = argv.library;
      const version = argv.version;
      const serverUrl = argv.serverUrl;
      const appConfig = loadConfig(argv, {
        configPath: argv.config,
        searchDir: argv.storePath
        // resolved globally
      });
      const eventBus = getEventBus(argv);
      const docService = await createDocumentManagement({
        serverUrl,
        eventBus,
        appConfig
      });
      try {
        const findVersionTool = new FindVersionTool(docService);
        const versionInfo = await findVersionTool.execute({
          library,
          targetVersion: version
        });
        if (!versionInfo) throw new Error("Failed to get version information");
        console.log(versionInfo);
      } finally {
        await docService.shutdown();
      }
    }
  );
}
function createListCommand(cli) {
  cli.command(
    "list",
    "List all indexed libraries and their available versions",
    (yargs2) => {
      return yargs2.option("server-url", {
        type: "string",
        description: "URL of external pipeline worker RPC (e.g., http://localhost:8080/api)",
        alias: "serverUrl"
      });
    },
    async (argv) => {
      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "list",
        useServerUrl: !!argv.serverUrl
      });
      const serverUrl = argv.serverUrl;
      const appConfig = loadConfig(argv, {
        configPath: argv.config,
        searchDir: argv.storePath
        // resolved globally in index.ts middleware
      });
      const eventBus = getEventBus(argv);
      const docService = await createDocumentManagement({
        eventBus,
        serverUrl,
        appConfig
      });
      try {
        const listLibrariesTool = new ListLibrariesTool(docService);
        const result = await listLibrariesTool.execute();
        console.log(formatOutput(result.libraries));
      } finally {
        await docService.shutdown();
      }
    }
  );
}
function createMcpCommand(cli) {
  cli.command(
    "mcp",
    "Start the MCP server (Standalone Mode)",
    (yargs2) => {
      return yargs2.option("protocol", {
        type: "string",
        description: "Protocol for MCP server",
        choices: ["auto", "stdio", "http"],
        default: "auto"
      }).option("port", {
        type: "string",
        description: "Port for the MCP server"
      }).option("host", {
        type: "string",
        description: "Host to bind the MCP server to"
      }).option("embedding-model", {
        type: "string",
        description: "Embedding model configuration (e.g., 'openai:text-embedding-3-small')",
        alias: "embeddingModel"
      }).option("server-url", {
        type: "string",
        description: "URL of external pipeline worker RPC (e.g., http://localhost:8080/api)",
        alias: "serverUrl"
      }).option("read-only", {
        type: "boolean",
        description: "Run in read-only mode (only expose read tools, disable write/job tools)",
        default: false,
        alias: "readOnly"
      }).option("auth-enabled", {
        type: "boolean",
        description: "Enable OAuth2/OIDC authentication for MCP endpoints",
        default: false,
        alias: "authEnabled"
      }).option("auth-issuer-url", {
        type: "string",
        description: "Issuer/discovery URL for OAuth2/OIDC provider",
        alias: "authIssuerUrl"
      }).option("auth-audience", {
        type: "string",
        description: "JWT audience claim (identifies this protected resource)",
        alias: "authAudience"
      });
    },
    async (argv) => {
      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "mcp",
        protocol: argv.protocol,
        port: argv.port,
        host: argv.host,
        useServerUrl: !!argv.serverUrl,
        readOnly: argv.readOnly,
        authEnabled: !!argv.authEnabled
      });
      validatePort(argv.port || "6280");
      const resolvedProtocol = resolveProtocol(argv.protocol);
      if (resolvedProtocol === "stdio") {
        setLogLevel(LogLevel.ERROR);
      }
      const appConfig = loadConfig(argv, {
        configPath: argv.config,
        searchDir: argv.storePath
        // resolvedStorePath passed via argv by middleware
      });
      const authConfig = parseAuthConfig({
        authEnabled: appConfig.auth.enabled,
        authIssuerUrl: appConfig.auth.issuerUrl,
        authAudience: appConfig.auth.audience
      });
      if (authConfig) {
        validateAuthConfig(authConfig);
      }
      try {
        const serverUrl = argv.serverUrl;
        const eventBus = getEventBus(argv);
        const docService = await createDocumentManagement({
          serverUrl,
          eventBus,
          appConfig
        });
        const pipelineOptions = {
          recoverJobs: false,
          // MCP command doesn't support job recovery
          serverUrl,
          appConfig
        };
        const pipeline = serverUrl ? await PipelineFactory2.createPipeline(void 0, eventBus, {
          serverUrl,
          ...pipelineOptions
        }) : await PipelineFactory2.createPipeline(
          docService,
          eventBus,
          pipelineOptions
        );
        if (resolvedProtocol === "stdio") {
          logger.debug(`Auto-detected stdio protocol (no TTY)`);
          await pipeline.start();
          const mcpTools = await initializeTools(docService, pipeline, appConfig);
          const mcpServer = await startStdioServer(mcpTools, appConfig);
          registerGlobalServices({
            mcpStdioServer: mcpServer,
            docService,
            pipeline
          });
          await new Promise(() => {
          });
        } else {
          logger.debug(`Auto-detected http protocol (TTY available)`);
          const config = createAppServerConfig({
            enableWebInterface: false,
            enableMcpServer: true,
            enableApiServer: false,
            enableWorker: !serverUrl,
            port: appConfig.server.ports.mcp,
            externalWorkerUrl: serverUrl,
            startupContext: {
              cliCommand: "mcp",
              mcpProtocol: "http"
            }
          });
          const appServer = await startAppServer(
            docService,
            pipeline,
            eventBus,
            config,
            appConfig
          );
          registerGlobalServices({
            appServer,
            docService
          });
          await new Promise(() => {
          });
        }
      } catch (error) {
        logger.error(`❌ Failed to start MCP server: ${error}`);
        process.exit(1);
      }
    }
  );
}
function createRefreshCommand(cli) {
  cli.command(
    "refresh <library>",
    "Update an existing library version by re-scraping changed pages",
    (yargs2) => {
      return yargs2.positional("library", {
        type: "string",
        description: "Library name to refresh",
        demandOption: true
      }).option("version", {
        type: "string",
        description: "Version of the library (optional)",
        alias: "v"
      }).option("embedding-model", {
        type: "string",
        description: "Embedding model configuration (e.g., 'openai:text-embedding-3-small')",
        alias: "embeddingModel"
      }).option("server-url", {
        type: "string",
        description: "URL of external pipeline worker RPC (e.g., http://localhost:8080/api)",
        alias: "serverUrl"
      }).usage(
        "$0 refresh <library> [options]\n\nUses HTTP ETags to efficiently skip unchanged pages and only re-process\ncontent that has been modified or deleted since the last scrape.\n\nExamples:\n  refresh react --version 18.0.0\n  refresh mylib\n\nNote: The library and version must already be indexed. Use 'scrape' to index a new library/version."
      );
    },
    async (argv) => {
      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "refresh",
        library: argv.library,
        version: argv.version,
        useServerUrl: !!argv.serverUrl
      });
      const library = argv.library;
      const version = argv.version;
      const serverUrl = argv.serverUrl;
      const appConfig = loadConfig(argv, {
        configPath: argv.config,
        searchDir: argv.storePath
      });
      const eventBus = getEventBus(argv);
      const docService = await createDocumentManagement({
        serverUrl,
        eventBus,
        appConfig
      });
      let pipeline = null;
      console.log("⏳ Initializing refresh job...");
      let unsubscribeProgress = null;
      let unsubscribeStatus = null;
      if (!serverUrl) {
        unsubscribeProgress = eventBus.on(EventType.JOB_PROGRESS, (event) => {
          const { job, progress } = event;
          console.log(
            `📄 Refreshing ${job.library}${job.version ? ` v${job.version}` : ""}: ${progress.pagesScraped}/${progress.totalPages} pages`
          );
        });
        unsubscribeStatus = eventBus.on(EventType.JOB_STATUS_CHANGE, (event) => {
          if (event.status === PipelineJobStatus.RUNNING) {
            console.log(
              `🚀 Refreshing ${event.library}${event.version ? ` v${event.version}` : ""}...`
            );
          }
        });
      }
      try {
        const pipelineOptions = {
          recoverJobs: false,
          serverUrl,
          appConfig
        };
        pipeline = serverUrl ? await PipelineFactory2.createPipeline(void 0, eventBus, {
          serverUrl,
          ...pipelineOptions
        }) : await PipelineFactory2.createPipeline(
          docService,
          eventBus,
          pipelineOptions
        );
        await pipeline.start();
        const refreshTool = new RefreshVersionTool(pipeline);
        const result = await refreshTool.execute({
          library,
          version,
          waitForCompletion: true
          // Always wait for completion in CLI
        });
        if ("pagesRefreshed" in result) {
          console.log(`✅ Successfully refreshed ${result.pagesRefreshed} pages`);
        } else {
          console.log(`✅ Refresh job started with ID: ${result.jobId}`);
        }
      } catch (error) {
        console.error(
          `❌ Refresh failed: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      } finally {
        if (unsubscribeProgress) unsubscribeProgress();
        if (unsubscribeStatus) unsubscribeStatus();
        if (pipeline) await pipeline.stop();
        await docService.shutdown();
      }
    }
  );
}
function createRemoveCommand(cli) {
  cli.command(
    "remove <library>",
    "Delete a library's documentation from the index",
    (yargs2) => {
      return yargs2.version(false).positional("library", {
        type: "string",
        description: "Library name to remove",
        demandOption: true
      }).option("version", {
        type: "string",
        description: "Version to remove (optional, removes latest if omitted)",
        alias: "v"
      }).option("server-url", {
        type: "string",
        description: "URL of external pipeline worker RPC (e.g., http://localhost:8080/api)",
        alias: "serverUrl"
      });
    },
    async (argv) => {
      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "remove",
        library: argv.library,
        version: argv.version,
        useServerUrl: !!argv.serverUrl
      });
      const library = argv.library;
      const version = argv.version;
      const serverUrl = argv.serverUrl;
      const appConfig = loadConfig(argv, {
        configPath: argv.config,
        searchDir: argv.storePath
        // resolved globally
      });
      const eventBus = getEventBus(argv);
      const docService = await createDocumentManagement({
        serverUrl,
        eventBus,
        appConfig
      });
      try {
        await docService.removeAllDocuments(library, version);
        console.log(`✅ Successfully removed ${library}${version ? `@${version}` : ""}.`);
      } catch (error) {
        console.error(
          `❌ Failed to remove ${library}${version ? `@${version}` : ""}:`,
          error instanceof Error ? error.message : String(error)
        );
        throw error;
      } finally {
        await docService.shutdown();
      }
    }
  );
}
function createScrapeCommand(cli) {
  cli.command(
    "scrape <library> <url>",
    "Download and index documentation from a URL or local directory",
    (yargs2) => {
      return yargs2.version(false).positional("library", {
        type: "string",
        description: "Library name",
        demandOption: true
      }).positional("url", {
        type: "string",
        description: "URL or file:// path to scrape",
        demandOption: true
      }).option("version", {
        type: "string",
        description: "Version of the library (optional)",
        alias: "v"
      }).option("max-pages", {
        type: "number",
        description: "Maximum pages to scrape",
        alias: ["p", "maxPages"]
      }).option("max-depth", {
        type: "number",
        description: "Maximum navigation depth",
        alias: ["d", "maxDepth"]
      }).option("max-concurrency", {
        type: "number",
        description: "Maximum concurrent page requests",
        alias: ["c", "maxConcurrency"]
      }).option("ignore-errors", {
        type: "boolean",
        description: "Ignore errors during scraping",
        default: true,
        alias: "ignoreErrors"
      }).option("scope", {
        choices: ["subpages", "hostname", "domain"],
        description: "Crawling boundary",
        default: "subpages"
      }).option("follow-redirects", {
        type: "boolean",
        description: "Follow HTTP redirects",
        default: true,
        alias: "followRedirects"
      }).option("no-follow-redirects", {
        type: "boolean",
        description: "Disable following HTTP redirects",
        hidden: true
      }).option("scrape-mode", {
        choices: Object.values(ScrapeMode),
        description: "HTML processing strategy",
        default: ScrapeMode.Auto,
        alias: "scrapeMode"
      }).option("include-pattern", {
        type: "string",
        array: true,
        description: "Glob or regex pattern for URLs to include (can be specified multiple times). Regex patterns must be wrapped in slashes, e.g. /pattern/.",
        alias: "includePattern",
        default: []
      }).option("exclude-pattern", {
        type: "string",
        array: true,
        description: "Glob or regex pattern for URLs to exclude (can be specified multiple times, takes precedence over include). Regex patterns must be wrapped in slashes, e.g. /pattern/.",
        alias: "excludePattern",
        default: []
      }).option("header", {
        type: "string",
        array: true,
        description: "Custom HTTP header to send with each request (can be specified multiple times)",
        default: []
      }).option("embedding-model", {
        type: "string",
        description: "Embedding model configuration (e.g., 'openai:text-embedding-3-small')",
        alias: "embeddingModel"
      }).option("server-url", {
        type: "string",
        description: "URL of external pipeline worker RPC (e.g., http://localhost:8080/api)",
        alias: "serverUrl"
      }).usage(
        "$0 scrape <library> <url> [options]\n\nScrape and index documentation from a URL or local folder.\n\nTo scrape local files or folders, use a file:// URL.\nExamples:\n  scrape mylib https://react.dev/reference/react\n  scrape mylib file:///Users/me/docs/index.html\n  scrape mylib file:///Users/me/docs/my-library\n\nNote: For local files/folders, you must use the file:// prefix. If running in Docker, mount the folder and use the container path. See README for details."
      );
    },
    async (argv) => {
      const library = argv.library;
      const url = argv.url;
      const serverUrl = argv.serverUrl;
      const appConfig = loadConfig(argv, {
        configPath: argv.config,
        searchDir: argv.storePath
        // resolved globally
      });
      const maxPages = argv.maxPages ?? appConfig.scraper.maxPages;
      const maxDepth = argv.maxDepth ?? appConfig.scraper.maxDepth;
      const maxConcurrency = argv.maxConcurrency ?? appConfig.scraper.maxConcurrency;
      appConfig.scraper.maxPages = maxPages;
      appConfig.scraper.maxDepth = maxDepth;
      appConfig.scraper.maxConcurrency = maxConcurrency;
      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "scrape",
        library,
        version: argv.version,
        url,
        maxPages,
        maxDepth,
        maxConcurrency,
        scope: argv.scope,
        scrapeMode: argv.scrapeMode,
        followRedirects: argv.followRedirects,
        hasHeaders: argv.header.length > 0,
        hasIncludePatterns: argv.includePattern.length > 0,
        hasExcludePatterns: argv.excludePattern.length > 0,
        useServerUrl: !!serverUrl
      });
      const eventBus = getEventBus(argv);
      const docService = await createDocumentManagement({
        serverUrl,
        eventBus,
        appConfig
      });
      let pipeline = null;
      console.log("⏳ Initializing scraping job...");
      let unsubscribeProgress = null;
      let unsubscribeStatus = null;
      if (!serverUrl) {
        unsubscribeProgress = eventBus.on(EventType.JOB_PROGRESS, (event) => {
          const { job, progress } = event;
          console.log(
            `📄 Scraping ${job.library}${job.version ? ` v${job.version}` : ""}: ${progress.pagesScraped}/${progress.totalPages} pages`
          );
        });
        unsubscribeStatus = eventBus.on(EventType.JOB_STATUS_CHANGE, (event) => {
          if (event.status === PipelineJobStatus.RUNNING) {
            console.log(
              `🚀 Scraping ${event.library}${event.version ? ` v${event.version}` : ""}...`
            );
          }
        });
      }
      try {
        const pipelineOptions = {
          recoverJobs: false,
          serverUrl,
          appConfig
        };
        pipeline = serverUrl ? await PipelineFactory2.createPipeline(void 0, eventBus, {
          serverUrl,
          ...pipelineOptions
        }) : await PipelineFactory2.createPipeline(
          docService,
          eventBus,
          pipelineOptions
        );
        await pipeline.start();
        const scrapeTool = new ScrapeTool(pipeline, appConfig.scraper);
        const headers = parseHeaders(argv.header || []);
        const result = await scrapeTool.execute({
          url,
          library,
          version: argv.version,
          options: {
            maxPages,
            maxDepth,
            maxConcurrency,
            ignoreErrors: argv.ignoreErrors,
            scope: argv.scope,
            followRedirects: argv.followRedirects,
            scrapeMode: argv.scrapeMode,
            includePatterns: argv.includePattern?.length > 0 ? argv.includePattern : void 0,
            excludePatterns: argv.excludePattern?.length > 0 ? argv.excludePattern : void 0,
            headers: Object.keys(headers).length > 0 ? headers : void 0
          }
        });
        if ("pagesScraped" in result) {
          console.log(`✅ Successfully scraped ${result.pagesScraped} pages`);
        } else {
          console.log(`✅ Scraping job started with ID: ${result.jobId}`);
        }
      } catch (error) {
        console.error(
          `❌ Scraping failed: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      } finally {
        if (unsubscribeProgress) unsubscribeProgress();
        if (unsubscribeStatus) unsubscribeStatus();
        if (pipeline) await pipeline.stop();
        await docService.shutdown();
      }
    }
  );
}
function createSearchCommand(cli) {
  cli.command(
    "search <library> <query>",
    "Query the documentation index used by the MCP server",
    (yargs2) => {
      return yargs2.version(false).positional("library", {
        type: "string",
        description: "Library name",
        demandOption: true
      }).positional("query", {
        type: "string",
        description: "Search query",
        demandOption: true
      }).option("version", {
        type: "string",
        description: "Version of the library (optional, supports ranges)",
        alias: "v"
      }).option("limit", {
        type: "number",
        description: "Maximum number of results",
        alias: "l",
        default: 5
      }).option("exact-match", {
        type: "boolean",
        description: "Only use exact version match",
        default: false,
        alias: ["e", "exactMatch"]
      }).option("embedding-model", {
        type: "string",
        description: "Embedding model configuration (e.g., 'openai:text-embedding-3-small')",
        alias: "embeddingModel"
      }).option("server-url", {
        type: "string",
        description: "URL of external pipeline worker RPC (e.g., http://localhost:8080/api)",
        alias: "serverUrl"
      }).usage(
        "$0 search <library> <query> [options]\n\nSearch documents in a library. Version matching examples:\n  - search react --version 18.0.0 'hooks' -> matches docs for React 18.0.0 or earlier versions\n  - search react --version 18.0.0 'hooks' --exact-match -> only matches React 18.0.0\n  - search typescript --version 5.x 'types' -> matches any TypeScript 5.x.x version\n  - search typescript --version 5.2.x 'types' -> matches any TypeScript 5.2.x version"
      );
    },
    async (argv) => {
      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "search",
        library: argv.library,
        version: argv.version,
        query: argv.query,
        limit: argv.limit,
        exactMatch: argv.exactMatch,
        useServerUrl: !!argv.serverUrl
      });
      const library = argv.library;
      const query = argv.query;
      const limit = argv.limit;
      const serverUrl = argv.serverUrl;
      const appConfig = loadConfig(argv, {
        configPath: argv.config,
        searchDir: argv.storePath
        // resolved globally
      });
      const eventBus = getEventBus(argv);
      const docService = await createDocumentManagement({
        serverUrl,
        eventBus,
        appConfig
      });
      try {
        const searchTool = new SearchTool(docService);
        const result = await searchTool.execute({
          library,
          version: argv.version,
          query,
          limit,
          exactMatch: argv.exactMatch
        });
        console.log(formatOutput(result.results));
      } finally {
        await docService.shutdown();
      }
    }
  );
}
function createWebCommand(cli) {
  cli.command(
    "web",
    "Start the web dashboard (Standalone Mode)",
    (yargs2) => {
      return yargs2.option("port", {
        type: "string",
        description: "Port for the web interface"
      }).option("host", {
        type: "string",
        description: "Host to bind the web interface to"
      }).option("embedding-model", {
        type: "string",
        description: "Embedding model configuration (e.g., 'openai:text-embedding-3-small')",
        alias: "embeddingModel"
      }).option("server-url", {
        type: "string",
        description: "URL of external pipeline worker RPC (e.g., http://localhost:8080/api)",
        alias: "serverUrl"
      });
    },
    async (argv) => {
      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "web",
        port: argv.port,
        host: argv.host,
        useServerUrl: !!argv.serverUrl
      });
      validatePort(argv.port || "6281");
      validateHost(argv.host || "127.0.0.1");
      const serverUrl = argv.serverUrl;
      const appConfig = loadConfig(argv, {
        configPath: argv.config,
        // searchDir resolved via globalStorePath in index.ts -> available in appConfig?
        // loadConfig needs options to find file.
        searchDir: argv.storePath
      });
      try {
        const eventBus = getEventBus(argv);
        const docService = await createDocumentManagement({
          serverUrl,
          eventBus,
          appConfig
        });
        const pipelineOptions = {
          recoverJobs: false,
          // Web command doesn't support job recovery
          serverUrl,
          appConfig
        };
        const pipeline = serverUrl ? await PipelineFactory2.createPipeline(void 0, eventBus, {
          serverUrl,
          ...pipelineOptions
        }) : await PipelineFactory2.createPipeline(
          docService,
          eventBus,
          pipelineOptions
        );
        const config = createAppServerConfig({
          enableWebInterface: true,
          enableMcpServer: false,
          enableApiServer: false,
          enableWorker: !serverUrl,
          port: appConfig.server.ports.web,
          externalWorkerUrl: serverUrl,
          startupContext: {
            cliCommand: "web"
          }
        });
        const appServer = await startAppServer(
          docService,
          pipeline,
          eventBus,
          config,
          appConfig
        );
        registerGlobalServices({
          appServer,
          docService
        });
        await new Promise(() => {
        });
      } catch (error) {
        logger.error(`❌ Failed to start web interface: ${error}`);
        process.exit(1);
      }
    }
  );
}
function createWorkerCommand(cli) {
  cli.command(
    "worker",
    "Start a background worker for processing scraping jobs",
    (yargs2) => {
      return yargs2.option("port", {
        type: "string",
        description: "Port for worker API"
      }).option("host", {
        type: "string",
        description: "Host to bind the worker API to"
      }).option("embedding-model", {
        type: "string",
        description: "Embedding model configuration (e.g., 'openai:text-embedding-3-small')",
        alias: "embeddingModel"
      }).option("resume", {
        type: "boolean",
        description: "Resume interrupted jobs on startup",
        default: true
      }).option("no-resume", {
        type: "boolean",
        // Yargs handles boolean flags specially, --no-resume implies resume=false
        // But strict mode might complain if we don't define 'resume'
        // 'resume' defaulting to true handles --no-resume correctly in Yargs
        hidden: true
      });
    },
    async (argv) => {
      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "worker",
        port: argv.port,
        host: argv.host,
        resume: argv.resume
      });
      validatePort(argv.port || "8080");
      validateHost(argv.host || "127.0.0.1");
      const appConfig = loadConfig(argv, {
        configPath: argv.config,
        searchDir: argv.storePath
        // resolved globally in index.ts middleware
      });
      try {
        ensurePlaywrightBrowsersInstalled();
        const eventBus = getEventBus(argv);
        const docService = await createLocalDocumentManagement(eventBus, appConfig);
        const pipelineOptions = {
          recoverJobs: argv.resume ?? true,
          appConfig
        };
        const pipeline = await PipelineFactory2.createPipeline(
          docService,
          eventBus,
          pipelineOptions
        );
        const config = createAppServerConfig({
          enableWebInterface: false,
          enableMcpServer: false,
          enableApiServer: true,
          enableWorker: true,
          port: appConfig.server.ports.worker,
          startupContext: {
            cliCommand: "worker"
          }
        });
        const appServer = await startAppServer(
          docService,
          pipeline,
          eventBus,
          config,
          appConfig
        );
        registerGlobalServices({
          appServer,
          docService
        });
        await new Promise(() => {
        });
      } catch (error) {
        logger.error(`❌ Failed to start external pipeline worker: ${error}`);
        process.exit(1);
      }
    }
  );
}
function createCli(argv) {
  let globalEventBus = null;
  let globalTelemetryService = null;
  const commandStartTimes = /* @__PURE__ */ new Map();
  const cli = yargs(hideBin(argv)).scriptName("docs-mcp-server").strict().usage("Usage: $0 <command> [options]").version("1.33.1").option("verbose", {
    type: "boolean",
    description: "Enable verbose (debug) logging",
    default: false
  }).option("silent", {
    type: "boolean",
    description: "Disable all logging except errors",
    default: false
  }).option("telemetry", {
    type: "boolean",
    description: "Enable/disable telemetry collection",
    // yargs handles boolean logic for --no-telemetry automatically if strictly typed
    // but we want tri-state or env var handling.
    // Yargs doesn't naturally do "default: true, but respecting env var DOCS_MCP_TELEMETRY"
    // without middleware overriding.
    default: void 0
    // Let config loader handle defaults
  }).option("store-path", {
    type: "string",
    description: "Custom path for data storage directory",
    alias: "storePath"
  }).option("config", {
    type: "string",
    description: "Path to configuration file"
  }).middleware(async (argv2) => {
    if (argv2.verbose && argv2.silent) {
      throw new Error("Arguments verbose and silent are mutually exclusive");
    }
    const rawStorePath = argv2.storePath || process.env.DOCS_MCP_STORE_PATH;
    const resolvedStorePath = resolveStorePath(rawStorePath);
    argv2.storePath = resolvedStorePath;
    const appConfig = loadConfig(argv2, {
      configPath: argv2.config
    });
    if (argv2.telemetry === void 0) {
      argv2.telemetry = appConfig.app.telemetryEnabled;
    }
    setupLogging({
      verbose: argv2.verbose,
      silent: argv2.silent
    });
    initTelemetry({
      enabled: !!argv2.telemetry,
      storePath: resolvedStorePath
    });
    if (!globalEventBus) {
      globalEventBus = new EventBusService();
    }
    if (!globalTelemetryService) {
      globalTelemetryService = new TelemetryService(globalEventBus);
      registerGlobalServices({ telemetryService: globalTelemetryService });
    }
    argv2._eventBus = globalEventBus;
    if (shouldEnableTelemetry() && telemetry.isEnabled()) {
      const commandName = argv2._[0]?.toString() || "default";
      telemetry.setGlobalContext({
        appVersion: "1.33.1",
        appPlatform: process.platform,
        appNodeVersion: process.version,
        appInterface: "cli",
        cliCommand: commandName
      });
      const commandKey = `${commandName}-${Date.now()}`;
      commandStartTimes.set(commandKey, Date.now());
      argv2._trackingKey = commandKey;
    }
  }).alias("help", "h").showHelpOnFail(true);
  createConfigCommand(cli);
  createDefaultAction(cli);
  createFetchUrlCommand(cli);
  createFindVersionCommand(cli);
  createListCommand(cli);
  createMcpCommand(cli);
  createRefreshCommand(cli);
  createRemoveCommand(cli);
  createScrapeCommand(cli);
  createSearchCommand(cli);
  createWebCommand(cli);
  createWorkerCommand(cli);
  return cli;
}
let isShuttingDown = false;
const sigintHandler = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.debug("Received SIGINT. Shutting down gracefully...");
  try {
    const appServer = getActiveAppServer();
    if (appServer) {
      logger.debug("SIGINT: Stopping AppServer...");
      await appServer.stop();
      setActiveAppServer(null);
      logger.debug("SIGINT: AppServer stopped.");
    }
    const mcpServer = getActiveMcpStdioServer();
    if (mcpServer) {
      logger.debug("SIGINT: Stopping MCP server...");
      await mcpServer.close();
      setActiveMcpStdioServer(null);
      logger.debug("SIGINT: MCP server stopped.");
    }
    logger.debug("SIGINT: Shutting down active services...");
    const pipeline = getActivePipelineManager();
    if (pipeline && !appServer) {
      await pipeline.stop();
      setActivePipelineManager(null);
      logger.debug("SIGINT: PipelineManager stopped.");
    }
    const docService = getActiveDocService();
    if (docService) {
      await docService.shutdown();
      setActiveDocService(null);
      logger.debug("SIGINT: DocumentManagementService shut down.");
    }
    const telemetryService = getActiveTelemetryService();
    if (telemetryService) {
      telemetryService.shutdown();
      setActiveTelemetryService(null);
      logger.debug("SIGINT: TelemetryService shut down.");
    }
    if (!appServer && telemetry.isEnabled()) {
      await telemetry.shutdown();
      logger.debug("SIGINT: Analytics shut down.");
    }
    logger.info("✅ Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    logger.error(`❌ Error during graceful shutdown: ${error}`);
    process.exit(1);
  }
};
async function cleanupCliCommand() {
  if (!isShuttingDown) {
    logger.debug("CLI command executed. Cleaning up...");
    process.removeListener("SIGINT", sigintHandler);
    await telemetry.shutdown();
    process.exit(0);
  }
}
async function runCli() {
  let commandExecuted = false;
  isShuttingDown = false;
  process.removeListener("SIGINT", sigintHandler);
  process.on("SIGINT", sigintHandler);
  try {
    const cli = createCli(process.argv);
    commandExecuted = true;
    await cli.parse();
  } catch (error) {
    if (error instanceof ModelConfigurationError || error instanceof UnsupportedProviderError) {
      logger.error(error.message);
    } else {
      logger.error(`❌ Error in CLI: ${error}`);
    }
    if (!isShuttingDown) {
      isShuttingDown = true;
      const shutdownPromises = [];
      const appServer2 = getActiveAppServer();
      if (appServer2) {
        shutdownPromises.push(
          appServer2.stop().then(() => {
            setActiveAppServer(null);
          }).catch((e) => logger.error(`❌ Error stopping AppServer: ${e}`))
        );
      }
      const mcpServer = getActiveMcpStdioServer();
      if (mcpServer) {
        shutdownPromises.push(
          mcpServer.close().then(() => {
            setActiveMcpStdioServer(null);
          }).catch((e) => logger.error(`❌ Error stopping MCP server: ${e}`))
        );
      }
      const pipeline = getActivePipelineManager();
      if (pipeline && !appServer2) {
        shutdownPromises.push(
          pipeline.stop().then(() => {
            setActivePipelineManager(null);
          }).catch((e) => logger.error(`❌ Error stopping pipeline: ${e}`))
        );
      }
      const docService = getActiveDocService();
      if (docService) {
        shutdownPromises.push(
          docService.shutdown().then(() => {
            setActiveDocService(null);
          }).catch((e) => logger.error(`❌ Error shutting down doc service: ${e}`))
        );
      }
      await Promise.allSettled(shutdownPromises);
    }
    process.exit(1);
  }
  const appServer = getActiveAppServer();
  if (commandExecuted && !appServer) {
    await cleanupCliCommand();
  }
}
process.setSourceMapsEnabled(true);
ensurePlaywrightBrowsersInstalled();
runCli().catch((error) => {
  console.error(`🔥 Fatal error in main execution: ${error}`);
  process.exit(1);
});
//# sourceMappingURL=index.js.map
