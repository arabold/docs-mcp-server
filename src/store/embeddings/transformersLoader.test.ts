import { describe, expect, it } from "vitest";
import {
  isCompanionMissingError,
  TransformersCompanionMissingError,
} from "./transformersLoader";

describe("isCompanionMissingError", () => {
  const COMPANION = "@arabold/docs-mcp-server-transformers";

  it("returns true for ERR_MODULE_NOT_FOUND referencing the companion", () => {
    const error = Object.assign(
      new Error(`Cannot find package '${COMPANION}' imported from ...`),
      { code: "ERR_MODULE_NOT_FOUND" },
    );
    expect(isCompanionMissingError(error)).toBe(true);
  });

  it("returns true for MODULE_NOT_FOUND referencing the companion", () => {
    const error = Object.assign(new Error(`Cannot find module '${COMPANION}'`), {
      code: "MODULE_NOT_FOUND",
    });
    expect(isCompanionMissingError(error)).toBe(true);
  });

  it("returns false when a different module is missing", () => {
    // A broken transitive dependency must not be reported as the companion missing.
    const error = Object.assign(new Error("Cannot find module 'some-other-dep'"), {
      code: "ERR_MODULE_NOT_FOUND",
    });
    expect(isCompanionMissingError(error)).toBe(false);
  });

  it("returns false when an internal companion file is missing (not the package)", () => {
    // A broken/missing file inside an installed companion quotes a file path, not the bare
    // package specifier, and must be rethrown rather than reported as "install the companion".
    const error = Object.assign(
      new Error(
        `Cannot find module '/app/node_modules/${COMPANION}/dist/index.js' imported from ...`,
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );
    expect(isCompanionMissingError(error)).toBe(false);
  });

  it("returns false for unrelated error codes even if message mentions the companion", () => {
    const error = Object.assign(new Error(`boom in ${COMPANION}`), {
      code: "ERR_SOMETHING_ELSE",
    });
    expect(isCompanionMissingError(error)).toBe(false);
  });

  it("returns false for non-object inputs", () => {
    expect(isCompanionMissingError(undefined)).toBe(false);
    expect(isCompanionMissingError(null)).toBe(false);
    expect(isCompanionMissingError("error")).toBe(false);
  });
});

describe("TransformersCompanionMissingError", () => {
  it("has a helpful name and install instructions", () => {
    const error = new TransformersCompanionMissingError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("TransformersCompanionMissingError");
    expect(error.message).toContain("@arabold/docs-mcp-server-transformers");
    expect(error.message).toContain("npm install");
  });

  it("preserves the underlying cause", () => {
    const cause = new Error("original");
    const error = new TransformersCompanionMissingError(cause);
    expect(error.cause).toBe(cause);
  });
});
