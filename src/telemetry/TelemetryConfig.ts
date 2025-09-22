/**
 * Telemetry configuration management for enabling/disabling analytics collection.
 * Handles CLI flags, environment variables, and default settings.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import envPaths from "env-paths";

export class TelemetryConfig {
  private static instance?: TelemetryConfig;
  private enabled: boolean = true; // Default to enabled

  private constructor() {
    // Private constructor for singleton pattern
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  static getInstance(): TelemetryConfig {
    if (!TelemetryConfig.instance) {
      TelemetryConfig.instance = new TelemetryConfig();
    }
    return TelemetryConfig.instance;
  }
}

/**
 * Generate or retrieve a persistent installation identifier.
 * Creates a UUID and stores it in a file in the user data directory.
 * Supports custom store path override for Docker deployments.
 * This ensures truly unique identification that persists across runs.
 */
export function generateInstallationId(storePath?: string): string {
  try {
    // Use storePath if provided, otherwise use standard paths
    const dataDir = storePath || envPaths("docs-mcp-server", { suffix: "" }).data;
    const installationIdPath = path.join(dataDir, "installation.id");

    // Try to read existing installation ID
    if (fs.existsSync(installationIdPath)) {
      const existingId = fs.readFileSync(installationIdPath, "utf8").trim();
      if (existingId) {
        return existingId;
      }
    }

    // Generate new UUID and store it
    const newId = randomUUID();

    // Ensure directory exists
    fs.mkdirSync(dataDir, { recursive: true });

    // Write the installation ID
    fs.writeFileSync(installationIdPath, newId, "utf8");

    return newId;
  } catch {
    // Fallback to a session-only UUID if file operations fail
    // This ensures analytics always has a valid distinct ID
    return randomUUID();
  }
}

/**
 * Check if telemetry should be enabled based on environment and CLI flags.
 */
export function shouldEnableTelemetry(): boolean {
  return TelemetryConfig.getInstance().isEnabled();
}
