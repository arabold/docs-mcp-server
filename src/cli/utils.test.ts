import { afterEach, describe, expect, it, vi } from "vitest";
import { checkAuthForProtocol } from "./utils";

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
