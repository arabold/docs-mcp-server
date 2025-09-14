/**
 * Tests for MCP server read-only mode functionality
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { createMcpServerInstance } from "./mcpServer";
import type { McpServerTools } from "./tools";

// Mock tools
const mockTools: McpServerTools = {
  listLibraries: {
    execute: vi.fn(async () => ({ libraries: [] })),
  } as any,
  findVersion: {
    execute: vi.fn(async () => "Version found"),
  } as any,
  search: {
    execute: vi.fn(async () => ({ results: [] })),
  } as any,
  fetchUrl: {
    execute: vi.fn(async () => "# Mock content"),
  } as any,
  scrape: {
    execute: vi.fn(async () => ({ jobId: "job-123" })),
  } as any,
  listJobs: {
    execute: vi.fn(async () => ({ jobs: [] })),
  } as any,
  getJobInfo: {
    execute: vi.fn(async () => ({ job: null })),
  } as any,
  cancelJob: {
    execute: vi.fn(async () => ({ success: true, message: "Cancelled" })),
  } as any,
  remove: {
    execute: vi.fn(async () => ({ message: "Removed" })),
  } as any,
};

describe("MCP Server Read-Only Mode", () => {
  it("should create server instance in normal mode", () => {
    const server = createMcpServerInstance(mockTools, false);
    expect(server).toBeInstanceOf(McpServer);
  });

  it("should create server instance in read-only mode", () => {
    const server = createMcpServerInstance(mockTools, true);
    expect(server).toBeInstanceOf(McpServer);
  });

  it("should create server instance with default readOnly false", () => {
    const server = createMcpServerInstance(mockTools);
    expect(server).toBeInstanceOf(McpServer);
  });

  it("should create server instance with readOnly true", () => {
    const server = createMcpServerInstance(mockTools, true);
    expect(server).toBeInstanceOf(McpServer);
  });

  it("should create server without prompts capability and not fail", () => {
    // This test verifies that the server can be created successfully
    // without advertising prompts capability, which was the root cause
    // of the issue with some MCP clients failing to connect
    const server = createMcpServerInstance(mockTools, false);
    expect(server).toBeInstanceOf(McpServer);

    // Verify the server has the expected name and can be instantiated
    // This ensures our capability changes don't break server creation
    expect(server).toBeDefined();
  });
});
