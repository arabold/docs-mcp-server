/**
 * Normalize a single environment variable value by trimming surrounding whitespace
 * and removing matching outer quotes. Internal quotes are preserved.
 */
export function normalizeEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Normalize all string values in process.env in place.
 * Returns the names of environment variables that changed.
 */
export function sanitizeEnvironment(env: NodeJS.ProcessEnv = process.env): string[] {
  const sanitizedKeys: string[] = [];

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue;
    }

    const normalized = normalizeEnvValue(value);
    if (normalized !== value) {
      env[key] = normalized;
      sanitizedKeys.push(key);
    }
  }

  return sanitizedKeys;
}
