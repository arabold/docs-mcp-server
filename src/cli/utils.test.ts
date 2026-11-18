import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddingModelChangedError } from "../store/errors";
import { checkAuthForProtocol, handleEmbeddingModelChange } from "./utils";

describe("handleEmbeddingModelChange without a terminal", () => {
  const change = new EmbeddingModelChangedError(
    "openai:embeddinggemma-2:270m",
    "768",
    "openai:nomic-embed-text:latest",
    null,
  );
  const savedTty = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY };
  const savedEnv = process.env.DOCS_MCP_ACCEPT_MODEL_CHANGE;
  const service = { resolveModelChange: vi.fn(async () => undefined) };

  beforeEach(() => {
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    delete process.env.DOCS_MCP_ACCEPT_MODEL_CHANGE;
    service.resolveModelChange.mockClear();
  });

  afterEach(() => {
    process.stdin.isTTY = savedTty.stdin;
    process.stdout.isTTY = savedTty.stdout;
    if (savedEnv === undefined) {
      delete process.env.DOCS_MCP_ACCEPT_MODEL_CHANGE;
    } else {
      process.env.DOCS_MCP_ACCEPT_MODEL_CHANGE = savedEnv;
    }
  });

  it("fails startup when the change is not accepted", async () => {
    await expect(handleEmbeddingModelChange(change, service)).rejects.toBe(change);
    expect(service.resolveModelChange).not.toHaveBeenCalled();
  });

  it("accepts the change with --accept-model-change", async () => {
    await handleEmbeddingModelChange(change, service, true);
    expect(service.resolveModelChange).toHaveBeenCalledOnce();
  });

  it("accepts the change with DOCS_MCP_ACCEPT_MODEL_CHANGE when the flag is omitted", async () => {
    process.env.DOCS_MCP_ACCEPT_MODEL_CHANGE = "true";
    await handleEmbeddingModelChange(change, service);
    expect(service.resolveModelChange).toHaveBeenCalledOnce();
  });

  it("lets --no-accept-model-change override the environment", async () => {
    process.env.DOCS_MCP_ACCEPT_MODEL_CHANGE = "true";
    await expect(handleEmbeddingModelChange(change, service, false)).rejects.toBe(change);
    expect(service.resolveModelChange).not.toHaveBeenCalled();
  });
});

describe("checkAuthForProtocol", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns over stdio only when auth is enabled, and ignores its settings", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    checkAuthForProtocol({ enabled: false }, "stdio", 6280);
    expect(errorSpy).not.toHaveBeenCalled();

    // An HTTP issuer would fail validation; over stdio it is never looked at.
    checkAuthForProtocol(
      { enabled: true, issuerUrl: "http://issuer.example" },
      "stdio",
      6280,
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Authentication does not apply to MCP over stdio"),
    );
  });

  it("validates auth settings over HTTP", () => {
    expect(() =>
      checkAuthForProtocol(
        { enabled: true, issuerUrl: "http://issuer.example" },
        "http",
        6280,
      ),
    ).toThrow(/Issuer URL must use HTTPS/);
  });
});
