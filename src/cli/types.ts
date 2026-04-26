/**
 * CLI types and interfaces for command definitions and shared functionality.
 */

import type { IPipeline } from "../pipeline";
import type { IDocumentManagement } from "../store/trpc/interfaces";

/**
 * Global options available to all commands
 */
export interface GlobalOptions {
  verbose?: boolean;
  quiet?: boolean;
  telemetry?: boolean;
  storePath?: string;
  output?: "json" | "yaml" | "toon";
}

/**
 * Context passed to command handlers
 */
export interface CommandContext {
  globalOptions: GlobalOptions;
  docService?: IDocumentManagement;
  pipeline?: IPipeline;
}

/**
 * Base interface for command definitions
 */
export interface CommandDefinition {
  name: string;
  description: string;
  arguments?: string;
  options?: OptionDefinition[];
  action: (
    args: unknown[],
    options: Record<string, unknown>,
    context: CommandContext,
  ) => Promise<void>;
}

/**
 * Option definition for commands
 */
export interface OptionDefinition {
  flags: string;
  description: string;
  defaultValue?: string | boolean | number;
  parser?: (value: string, previous?: unknown) => unknown;
}
