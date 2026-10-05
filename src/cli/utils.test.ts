import { afterEach, describe, expect, it, vi } from "vitest";
import { checkAuthForProtocol } from "./utils";

describe("checkAuthForProtocol", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ignores auth settings over stdio, with a warning on stderr", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

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

  it("does nothing when auth is disabled", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    checkAuthForProtocol({ enabled: false }, "stdio", 6280);

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
