/**
 * Unit tests for CLI utilities
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOptionWithEnv } from "./utils";

describe("createOptionWithEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Clear environment variables before each test
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should create an option with default value when no env vars are set", () => {
    const option = createOptionWithEnv(
      "--test-option <value>",
      "Test option description",
      ["TEST_VAR"],
      "default-value",
    );

    expect(option.flags).toBe("--test-option <value>");
    expect(option.description).toBe("Test option description");
    expect(option.defaultValue).toBe("default-value");
  });

  it("should use environment variable value when set", () => {
    process.env.TEST_VAR = "env-value";

    const option = createOptionWithEnv(
      "--test-option <value>",
      "Test option description",
      ["TEST_VAR"],
      "default-value",
    );

    expect(option.defaultValue).toBe("env-value");
  });

  it("should use first available environment variable with priority", () => {
    process.env.SECOND_VAR = "second-value";
    process.env.THIRD_VAR = "third-value";

    const option = createOptionWithEnv(
      "--test-option <value>",
      "Test option description",
      ["FIRST_VAR", "SECOND_VAR", "THIRD_VAR"],
      "default-value",
    );

    expect(option.defaultValue).toBe("second-value");
  });

  it("should use first environment variable when multiple are set", () => {
    process.env.FIRST_VAR = "first-value";
    process.env.SECOND_VAR = "second-value";

    const option = createOptionWithEnv(
      "--test-option <value>",
      "Test option description",
      ["FIRST_VAR", "SECOND_VAR"],
      "default-value",
    );

    expect(option.defaultValue).toBe("first-value");
  });

  it("should fall back to default when no environment variables are set", () => {
    const option = createOptionWithEnv(
      "--test-option <value>",
      "Test option description",
      ["NON_EXISTENT_VAR"],
      "default-value",
    );

    expect(option.defaultValue).toBe("default-value");
  });

  it("should work without a default value", () => {
    process.env.TEST_VAR = "env-value";

    const option = createOptionWithEnv(
      "--test-option <value>",
      "Test option description",
      ["TEST_VAR"],
    );

    expect(option.defaultValue).toBe("env-value");
  });

  it("should return undefined when no env vars are set and no default provided", () => {
    const option = createOptionWithEnv(
      "--test-option <value>",
      "Test option description",
      ["NON_EXISTENT_VAR"],
    );

    expect(option.defaultValue).toBeUndefined();
  });

  it("should preserve other option methods", () => {
    const option = createOptionWithEnv(
      "--test-option <value>",
      "Test option description",
      ["TEST_VAR"],
      "default-value",
    );

    // Should be able to chain other methods
    const chainedOption = option.argParser((val) => val.toUpperCase());
    expect(chainedOption).toBeDefined();
    expect(typeof chainedOption.argParser).toBe("function");
  });

  it("should handle empty environment variable arrays", () => {
    const option = createOptionWithEnv(
      "--test-option <value>",
      "Test option description",
      [],
      "default-value",
    );

    expect(option.defaultValue).toBe("default-value");
  });
});
