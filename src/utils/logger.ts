/**
 * Defines the available log levels.
 */
export const LogLevel = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

/**
 * Maps string log level names to their numeric values.
 */
const LOG_LEVEL_MAP: Record<string, LogLevel> = {
  ERROR: LogLevel.ERROR,
  WARN: LogLevel.WARN,
  INFO: LogLevel.INFO,
  DEBUG: LogLevel.DEBUG,
};

function suppressLogsInTests(): boolean {
  return !!process.env.VITEST_WORKER_ID && process.env.ENABLE_TEST_LOGS !== "1";
}

function isInteractiveSession(): boolean {
  return !!process.stdout.isTTY && !!process.stderr.isTTY;
}

function writeToStderr(message: string): void {
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
}

/**
 * Gets the log level from environment variable or returns default.
 */
export function getLogLevelFromEnv(): LogLevel | null {
  const envLevel = process.env.LOG_LEVEL?.toUpperCase();
  return envLevel && envLevel in LOG_LEVEL_MAP ? LOG_LEVEL_MAP[envLevel] : null;
}

let currentLogLevel: LogLevel =
  getLogLevelFromEnv() ?? (isInteractiveSession() ? LogLevel.INFO : LogLevel.ERROR);

/**
 * Sets the current logging level for the application.
 */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

/**
 * Returns the current logging level for the application.
 */
export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

/**
 * Provides logging functionalities with level control.
 */
export const logger = {
  /**
   * Logs a debug message if the current log level is DEBUG or higher.
   * @param message - The message to log.
   */
  debug: (message: string) => {
    if (currentLogLevel >= LogLevel.DEBUG && !suppressLogsInTests()) {
      writeToStderr(message);
    }
  },
  /**
   * Logs an info message if the current log level is INFO or higher.
   * @param message - The message to log.
   */
  info: (message: string) => {
    if (currentLogLevel >= LogLevel.INFO && !suppressLogsInTests()) {
      writeToStderr(message);
    }
  },
  /**
   * Logs a warning message if the current log level is WARN or higher.
   * @param message - The message to log.
   */
  warn: (message: string) => {
    if (currentLogLevel >= LogLevel.WARN && !suppressLogsInTests()) {
      writeToStderr(message);
    }
  },
  /**
   * Logs an error message if the current log level is ERROR or higher (always logs).
   * @param message - The message to log.
   */
  error: (message: string) => {
    if (currentLogLevel >= LogLevel.ERROR && !suppressLogsInTests()) {
      writeToStderr(message);
    }
  },
};
