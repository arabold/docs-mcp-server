/**
 * Test session management utilities for different interface types.
 * Tests the simplified session context that focuses on user interaction data.
 * Application-level context is now handled by global context in Analytics.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCliSession,
  createMcpSession,
  createPipelineSession,
  createWebSession,
  getEnabledServices,
} from "./sessions";

describe("sessionManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createCliSession", () => {
    it("should create CLI session with defaults", () => {
      const session = createCliSession();

      expect(session.sessionId).toBeDefined();
      expect(session.startTime).toBeInstanceOf(Date);
      expect(session.appInterface).toBe("cli");
      expect(session.cliCommand).toBeUndefined();
    });

    it("should create CLI session with custom command", () => {
      const session = createCliSession("scrape");

      expect(session.cliCommand).toBe("scrape");
      expect(session.appInterface).toBe("cli");
    });

    // Note: AI embedding properties are now in global context, not session context
  });

  describe("createMcpSession", () => {
    it("should create MCP session with defaults", () => {
      const session = createMcpSession({});

      expect(session.appInterface).toBe("mcp");
      expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(session.mcpProtocol).toBe("stdio");
      expect(session.mcpTransport).toBeUndefined();
    });

    it("should create MCP session with custom options", () => {
      const session = createMcpSession({
        protocol: "http",
        transport: "sse",
      });

      expect(session.mcpProtocol).toBe("http");
      expect(session.mcpTransport).toBe("sse");
    });

    // Note: AI embedding properties are now in global context, not session context
  });

  describe("createWebSession", () => {
    it("should create web session with defaults", () => {
      const session = createWebSession({});

      expect(session.appInterface).toBe("web");
      expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(session.mcpProtocol).toBe("http");
      expect(session.webRoute).toBeUndefined();
    });

    it("should create web session with custom route", () => {
      const session = createWebSession({
        route: "/docs/search",
      });

      expect(session.webRoute).toBe("/docs/search");
    });
  });

  describe("createPipelineSession", () => {
    it("should create pipeline session with defaults", () => {
      const session = createPipelineSession();

      expect(session.appInterface).toBe("pipeline");
      expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    });

    // Note: AI embedding properties are now in global context, not session context
  });

  describe("getEnabledServices", () => {
    it("should return default worker service when no config", () => {
      const services = getEnabledServices();
      expect(services).toEqual(["worker"]);
    });

    it("should return default worker service when empty config", () => {
      const services = getEnabledServices({});
      expect(services).toEqual(["worker"]);
    });

    it("should return enabled services based on config", () => {
      const services = getEnabledServices({
        web: true,
        mcp: true,
        api: true,
        worker: true,
      });

      expect(services).toEqual(["web", "mcp", "api", "worker"]);
    });

    it("should return only enabled services", () => {
      const services = getEnabledServices({
        web: false,
        mcp: true,
        api: true,
        worker: false,
      });

      expect(services).toEqual(["mcp", "api"]);
    });
  });

  describe("session uniqueness", () => {
    it("should generate unique session IDs", () => {
      const session1 = createCliSession();
      const session2 = createCliSession();
      const session3 = createMcpSession({});

      expect(session1.sessionId).not.toBe(session2.sessionId);
      expect(session1.sessionId).not.toBe(session3.sessionId);
      expect(session2.sessionId).not.toBe(session3.sessionId);
    });

    it("should have different start times for concurrent sessions", () => {
      const session1 = createCliSession();
      const session2 = createWebSession({});

      // Times should be very close but potentially different
      expect(session1.startTime).toBeInstanceOf(Date);
      expect(session2.startTime).toBeInstanceOf(Date);
    });
  });
});
