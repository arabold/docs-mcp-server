import { describe, expect, it } from "vitest";
import { normalizeEnvValue, sanitizeEnvironment } from "./env";

describe("normalizeEnvValue", () => {
  it("strips surrounding double quotes", () => {
    expect(normalizeEnvValue('"http://localhost:11434/v1"')).toBe(
      "http://localhost:11434/v1",
    );
  });

  it("strips surrounding single quotes", () => {
    expect(normalizeEnvValue("'http://localhost:11434/v1'")).toBe(
      "http://localhost:11434/v1",
    );
  });

  it("leaves unquoted strings unchanged", () => {
    expect(normalizeEnvValue("http://localhost:11434/v1")).toBe(
      "http://localhost:11434/v1",
    );
  });

  it("trims whitespace before checking quotes", () => {
    expect(normalizeEnvValue('  "http://localhost:11434/v1"  ')).toBe(
      "http://localhost:11434/v1",
    );
  });

  it("does not strip mismatched quotes", () => {
    expect(normalizeEnvValue("\"http://localhost:11434/v1'")).toBe(
      "\"http://localhost:11434/v1'",
    );
  });

  it("does not strip quotes that only appear on one side", () => {
    expect(normalizeEnvValue('"only-start')).toBe('"only-start');
    expect(normalizeEnvValue('only-end"')).toBe('only-end"');
  });

  it("handles empty string", () => {
    expect(normalizeEnvValue("")).toBe("");
  });

  it("handles string that is just quotes", () => {
    expect(normalizeEnvValue('""')).toBe("");
    expect(normalizeEnvValue("''")).toBe("");
  });

  it("preserves internal quotes", () => {
    expect(normalizeEnvValue('value with "internal" quotes')).toBe(
      'value with "internal" quotes',
    );
  });
});

describe("sanitizeEnvironment", () => {
  it("sanitizes all string values in place", () => {
    const env = {
      OPENAI_API_BASE: '"http://localhost:11434/v1"',
      GITHUB_TOKEN: '"ghp_test_token"',
      PLAIN_VALUE: "plain",
      WHITESPACE_VALUE: "  value  ",
      EMPTY_VALUE: "",
      UNDEFINED_VALUE: undefined,
    };

    const sanitizedKeys = sanitizeEnvironment(env);

    expect(env.OPENAI_API_BASE).toBe("http://localhost:11434/v1");
    expect(env.GITHUB_TOKEN).toBe("ghp_test_token");
    expect(env.PLAIN_VALUE).toBe("plain");
    expect(env.WHITESPACE_VALUE).toBe("value");
    expect(env.EMPTY_VALUE).toBe("");
    expect(env.UNDEFINED_VALUE).toBeUndefined();
    expect(sanitizedKeys).toEqual([
      "OPENAI_API_BASE",
      "GITHUB_TOKEN",
      "WHITESPACE_VALUE",
    ]);
  });

  it("is idempotent", () => {
    const env = {
      OPENAI_API_BASE: '"http://localhost:11434/v1"',
    };

    expect(sanitizeEnvironment(env)).toEqual(["OPENAI_API_BASE"]);
    expect(sanitizeEnvironment(env)).toEqual([]);
    expect(env.OPENAI_API_BASE).toBe("http://localhost:11434/v1");
  });
});
