import { describe, expect, it } from "vitest";
import { normalizeEnvValue, sanitizeEnvironment } from "./env";

describe("normalizeEnvValue", () => {
  it("trims the value and strips one pair of matching outer quotes", () => {
    const cases: Array<[value: string, expected: string]> = [
      ['"http://localhost:11434/v1"', "http://localhost:11434/v1"],
      ["'http://localhost:11434/v1'", "http://localhost:11434/v1"],
      ["http://localhost:11434/v1", "http://localhost:11434/v1"],
      // Whitespace is trimmed before the quotes are checked
      ['  "http://localhost:11434/v1"  ', "http://localhost:11434/v1"],
      // Mismatched or one-sided quotes stay
      ["\"http://localhost:11434/v1'", "\"http://localhost:11434/v1'"],
      ['"only-start', '"only-start'],
      ['only-end"', 'only-end"'],
      ["", ""],
      ['""', ""],
      ["''", ""],
      ['value with "internal" quotes', 'value with "internal" quotes'],
    ];

    for (const [value, expected] of cases) {
      expect.soft(normalizeEnvValue(value), value).toBe(expected);
    }
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
