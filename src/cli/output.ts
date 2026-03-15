import { encode as encodeToToon } from "@toon-format/toon";
import yaml from "yaml";
import type { Argv } from "yargs";
import { getLogLevelFromEnv, LogLevel, logger, setLogLevel } from "../utils/logger";

export type OutputFormat = "json" | "yaml" | "toon";
export type OutputKind = "structured" | "text";

export interface HasOutputOption {
  [key: string]: unknown;
  output?: unknown;
}

type PrimitiveValue = boolean | null | number | string;

export function isInteractiveOutput(): boolean {
  return !!process.stdout.isTTY && !!process.stderr.isTTY;
}

export function resolveOutputFormat(
  argv: HasOutputOption,
  _kind: OutputKind,
): OutputFormat {
  const requestedFormat = argv.output as OutputFormat | undefined;
  if (requestedFormat) {
    return requestedFormat;
  }

  return isInteractiveOutput() || _kind === "text" ? "json" : "json";
}

export function formatStructuredOutput(value: unknown, format: OutputFormat): string {
  if (format === "yaml") {
    return yaml.stringify(value).trimEnd();
  }

  if (format === "toon") {
    return encodeToToon(value).trimEnd();
  }

  return JSON.stringify(value, null, 2);
}

export function renderStructuredOutput(value: unknown, argv: HasOutputOption): void {
  const format = resolveOutputFormat(argv, "structured");
  process.stdout.write(`${formatStructuredOutput(value, format)}\n`);
}

export function renderTextOutput(value: string): void {
  process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
}

export function renderScalarOutput(value: PrimitiveValue, argv: HasOutputOption): void {
  const hasExplicitFormat = typeof argv.output === "string";
  if (!hasExplicitFormat) {
    renderTextOutput(String(value));
    return;
  }

  renderStructuredOutput(value, argv);
}

export function applyGlobalCliOutputMode(options: {
  verbose?: boolean;
  quiet?: boolean;
}): void {
  const interactive = isInteractiveOutput();
  const envLogLevel = getLogLevelFromEnv();

  if (options.verbose) {
    setLogLevel(LogLevel.DEBUG);
  } else if (options.quiet) {
    setLogLevel(LogLevel.ERROR);
  } else if (envLogLevel !== null && envLogLevel !== undefined) {
    setLogLevel(envLogLevel);
  } else if (interactive) {
    setLogLevel(LogLevel.INFO);
  } else {
    setLogLevel(LogLevel.ERROR);
  }
}

export function registerGlobalOutputOptions<T>(yargs: Argv<T>): Argv<T> {
  return yargs.option("output", {
    type: "string",
    choices: ["json", "yaml", "toon"],
    description: "Structured output format for commands that return data",
  });
}

export function reportCliError(message: string): void {
  logger.error(message);
}

export function reportCliWarning(message: string): void {
  logger.warn(message);
}

export function reportCliInfo(message: string): void {
  logger.info(message);
}
