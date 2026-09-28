import { describe, expect, it } from "vitest";
import type { AppConfig } from "./config";
import {
  buildBindOrigin,
  describePublicLocationWarnings,
  normalizePublicOrigin,
  normalizePublicUrl,
  resolvePublicLocation,
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
    "https://user@docs.example.com",
    "https://user:pass@docs.example.com",
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

  it("normalizes absent and empty public URLs", () => {
    expect(normalizePublicUrl(undefined)).toBeUndefined();
    expect(normalizePublicUrl("  ")).toBeUndefined();
  });

  it("keeps the path of a public URL and drops a trailing slash", () => {
    expect(normalizePublicUrl("https://example.com/docs")).toBe(
      "https://example.com/docs",
    );
    expect(normalizePublicUrl("https://example.com/docs/")).toBe(
      "https://example.com/docs",
    );
    expect(normalizePublicUrl("https://example.com:8443/a/b/")).toBe(
      "https://example.com:8443/a/b",
    );
    expect(normalizePublicUrl("https://example.com/")).toBe("https://example.com");
  });

  it.each([
    "ftp://example.com/docs",
    "https://example.com/docs?x=1",
    "https://example.com/docs?",
    "https://example.com/docs#top",
    "https://user:pass@example.com/docs",
    "not a url",
  ])("rejects invalid public URL %s", (value) => {
    expect(() => normalizePublicUrl(value)).toThrow(/server\.publicUrl/);
  });

  it.each([
    "https://example.com/mcp",
    "https://example.com/api/docs",
    "https://example.com/assets",
    "https://example.com/.well-known",
    "https://example.com/MCP",
  ])("rejects public URL %s whose first segment collides with a route", (value) => {
    expect(() => normalizePublicUrl(value)).toThrow(/serves its own route/);
  });

  it("accepts a first segment that merely starts like a route name", () => {
    expect(normalizePublicUrl("https://example.com/mcp-docs")).toBe(
      "https://example.com/mcp-docs",
    );
  });

  it("resolves the public location from publicUrl, including its base path", () => {
    const config = {
      server: { host: "127.0.0.1", publicUrl: "https://example.com/docs/" },
    } as AppConfig;

    expect(resolvePublicLocation(config, 6280)).toEqual({
      configured: true,
      url: "https://example.com/docs",
      origin: "https://example.com",
      basePath: "/docs",
    });
  });

  it("resolves publicOrigin as a public URL without a path", () => {
    const config = {
      server: { host: "127.0.0.1", publicOrigin: "https://docs.example.com" },
    } as AppConfig;

    expect(resolvePublicLocation(config, 6280)).toEqual({
      configured: true,
      url: "https://docs.example.com",
      origin: "https://docs.example.com",
      basePath: "",
    });
  });

  it("prefers publicUrl over publicOrigin", () => {
    const config = {
      server: {
        host: "127.0.0.1",
        publicUrl: "https://example.com/docs",
        publicOrigin: "https://old.example.com",
      },
    } as AppConfig;

    expect(resolvePublicLocation(config, 6280).url).toBe("https://example.com/docs");
  });

  it("falls back to the bind origin, including IPv6", () => {
    expect(
      resolvePublicLocation({ server: { host: "0.0.0.0" } } as AppConfig, 6280),
    ).toEqual({
      configured: false,
      url: "http://0.0.0.0:6280",
      origin: "http://0.0.0.0:6280",
      basePath: "",
    });
    expect(resolvePublicLocation({ server: { host: "::" } } as AppConfig, 6280).url).toBe(
      "http://[::]:6280",
    );
  });

  it("warns when the deprecated publicOrigin is in effect", () => {
    const warnings = describePublicLocationWarnings({
      server: { publicOrigin: "https://docs.example.com" },
    } as AppConfig);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/deprecated.*server\.publicUrl/);
  });

  it("warns that publicOrigin is ignored when both are set", () => {
    const warnings = describePublicLocationWarnings({
      server: {
        publicOrigin: "https://old.example.com",
        publicUrl: "https://example.com/docs",
      },
    } as AppConfig);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/publicOrigin is ignored/);
  });

  it("has no warnings for publicUrl alone", () => {
    expect(
      describePublicLocationWarnings({
        server: { publicUrl: "https://example.com/docs" },
      } as AppConfig),
    ).toEqual([]);
  });
});
