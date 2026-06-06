import { describe, expect, it } from "vitest";
import type { AppConfig } from "./config";
import {
  buildBindOrigin,
  getCanonicalServerOrigin,
  isWildcardBindHost,
  normalizePublicOrigin,
} from "./serverOrigin";

describe("server origin helpers", () => {
  it("normalizes absent and empty public origins", () => {
    expect(normalizePublicOrigin(undefined)).toBeUndefined();
    expect(normalizePublicOrigin("")).toBeUndefined();
    expect(normalizePublicOrigin("   ")).toBeUndefined();
  });

  it("normalizes public origins and preserves non-default ports", () => {
    expect(normalizePublicOrigin("https://docs.example.com/")).toBe(
      "https://docs.example.com",
    );
    expect(normalizePublicOrigin("https://docs.example.com:8443")).toBe(
      "https://docs.example.com:8443",
    );
  });

  it.each([
    "ftp://docs.example.com",
    "https://docs.example.com/path",
    "https://docs.example.com?x=1",
    "https://docs.example.com#fragment",
    "not a url",
  ])("rejects invalid public origin %s", (origin) => {
    expect(() => normalizePublicOrigin(origin)).toThrow();
  });

  it("builds bind-derived origins for hostnames and IPv4 addresses", () => {
    expect(buildBindOrigin("localhost", 6280)).toBe("http://localhost:6280");
    expect(buildBindOrigin("0.0.0.0", 6280)).toBe("http://0.0.0.0:6280");
  });

  it("builds bind-derived origins for IPv6 addresses", () => {
    expect(buildBindOrigin("::", 6280)).toBe("http://[::]:6280");
    expect(buildBindOrigin("[::1]", 6280)).toBe("http://[::1]:6280");
  });

  it("prefers public origin over bind-derived origin", () => {
    const config = {
      server: {
        host: "0.0.0.0",
        publicOrigin: "https://docs.example.com",
      },
    } as AppConfig;

    expect(getCanonicalServerOrigin(config, 6280)).toBe("https://docs.example.com");
  });

  it("falls back to bind-derived origin when public origin is absent", () => {
    const config = {
      server: {
        host: "0.0.0.0",
      },
    } as AppConfig;

    expect(getCanonicalServerOrigin(config, 6280)).toBe("http://0.0.0.0:6280");
  });

  it("detects wildcard bind hosts", () => {
    expect(isWildcardBindHost("0.0.0.0")).toBe(true);
    expect(isWildcardBindHost("::")).toBe(true);
    expect(isWildcardBindHost("[::]")).toBe(true);
    expect(isWildcardBindHost("::0")).toBe(true);
    expect(isWildcardBindHost("127.0.0.1")).toBe(false);
    expect(isWildcardBindHost("localhost")).toBe(false);
  });
});
