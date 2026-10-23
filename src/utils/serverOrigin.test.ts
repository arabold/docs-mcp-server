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
  it("normalizes public origins, preserving non-default ports, and rejects anything but an origin", () => {
    const accepted: Array<{ input: string | undefined; origin: string | undefined }> = [
      // Absent and empty
      { input: undefined, origin: undefined },
      { input: "", origin: undefined },
      { input: "   ", origin: undefined },
      { input: "https://docs.example.com/", origin: "https://docs.example.com" },
      { input: "https://docs.example.com:8443", origin: "https://docs.example.com:8443" },
    ];
    const rejected = [
      "ftp://docs.example.com",
      "https://docs.example.com/path",
      "https://docs.example.com?x=1",
      "https://docs.example.com#fragment",
      "https://user@docs.example.com",
      "https://user:pass@docs.example.com",
      "not a url",
    ];

    for (const { input, origin } of accepted) {
      expect.soft(normalizePublicOrigin(input), String(input)).toBe(origin);
    }
    for (const input of rejected) {
      expect.soft(() => normalizePublicOrigin(input), input).toThrow();
    }
  });

  it("builds bind-derived origins for hostnames, IPv4 and IPv6 addresses", () => {
    const cases = [
      { host: "localhost", origin: "http://localhost:6280" },
      { host: "0.0.0.0", origin: "http://0.0.0.0:6280" },
      { host: "::", origin: "http://[::]:6280" },
      { host: "[::1]", origin: "http://[::1]:6280" },
    ];

    for (const { host, origin } of cases) {
      expect.soft(buildBindOrigin(host, 6280), host).toBe(origin);
    }
  });

  it("keeps the path of a public URL and drops a trailing slash", () => {
    const cases: Array<{ input: string | undefined; url: string | undefined }> = [
      // Absent and empty
      { input: undefined, url: undefined },
      { input: "  ", url: undefined },
      { input: "https://example.com/docs", url: "https://example.com/docs" },
      { input: "https://example.com/docs/", url: "https://example.com/docs" },
      { input: "https://example.com:8443/a/b/", url: "https://example.com:8443/a/b" },
      { input: "https://example.com/", url: "https://example.com" },
      // A first segment that merely starts like a route name
      { input: "https://example.com/mcp-docs", url: "https://example.com/mcp-docs" },
    ];

    for (const { input, url } of cases) {
      expect.soft(normalizePublicUrl(input), String(input)).toBe(url);
    }
  });

  it("rejects invalid public URLs and those whose first segment collides with a route or file", () => {
    const invalid = /server\.publicUrl/;
    const reserved = /reserves that path for its own routes and files/;
    const cases = [
      { input: "ftp://example.com/docs", error: invalid },
      { input: "https://example.com/docs?x=1", error: invalid },
      { input: "https://example.com/docs?", error: invalid },
      { input: "https://example.com/docs#top", error: invalid },
      { input: "https://user:pass@example.com/docs", error: invalid },
      { input: "not a url", error: invalid },
      { input: "https://example.com//docs", error: invalid },
      { input: "https://example.com/docs//api", error: invalid },
      { input: "https://example.com/docs//", error: invalid },
      { input: "https://example.com//", error: invalid },
      { input: "https://example.com/mcp", error: reserved },
      { input: "https://example.com/api/docs", error: reserved },
      { input: "https://example.com/assets", error: reserved },
      { input: "https://example.com/.well-known", error: reserved },
      { input: "https://example.com/MCP", error: reserved },
      { input: "https://example.com/favicon.ico", error: reserved },
      { input: "https://example.com/manifest.json/docs", error: reserved },
      { input: "https://example.com/oauth", error: reserved },
    ];

    for (const { input, error } of cases) {
      expect.soft(() => normalizePublicUrl(input), input).toThrow(error);
    }
  });

  it("resolves the public location from publicUrl, then publicOrigin, then the bind origin", () => {
    const cases: Array<{
      label: string;
      server: Partial<AppConfig["server"]>;
      location: unknown;
    }> = [
      {
        label: "publicUrl, including its base path",
        server: { host: "127.0.0.1", publicUrl: "https://example.com/docs/" },
        location: {
          configured: true,
          url: "https://example.com/docs",
          origin: "https://example.com",
          basePath: "/docs",
        },
      },
      {
        label: "publicOrigin, as a public URL without a path",
        server: { host: "127.0.0.1", publicOrigin: "https://docs.example.com" },
        location: {
          configured: true,
          url: "https://docs.example.com",
          origin: "https://docs.example.com",
          basePath: "",
        },
      },
      {
        label: "publicUrl over publicOrigin",
        server: {
          host: "127.0.0.1",
          publicUrl: "https://example.com/docs",
          publicOrigin: "https://old.example.com",
        },
        location: {
          configured: true,
          url: "https://example.com/docs",
          origin: "https://example.com",
          basePath: "/docs",
        },
      },
      {
        label: "the bind origin",
        server: { host: "0.0.0.0" },
        location: {
          configured: false,
          url: "http://0.0.0.0:6280",
          origin: "http://0.0.0.0:6280",
          basePath: "",
        },
      },
      {
        label: "the bind origin for IPv6",
        server: { host: "::" },
        location: {
          configured: false,
          url: "http://[::]:6280",
          origin: "http://[::]:6280",
          basePath: "",
        },
      },
    ];

    for (const { label, server, location } of cases) {
      expect
        .soft(resolvePublicLocation({ server } as AppConfig, 6280), label)
        .toEqual(location);
    }
  });

  it("warns about publicOrigin when it is in effect or ignored", () => {
    const cases: Array<{
      label: string;
      server: Partial<AppConfig["server"]>;
      warnings: RegExp[];
    }> = [
      {
        label: "deprecated publicOrigin in effect",
        server: { publicOrigin: "https://docs.example.com" },
        warnings: [/deprecated.*server\.publicUrl/],
      },
      {
        label: "publicOrigin ignored when both are set",
        server: {
          publicOrigin: "https://old.example.com",
          publicUrl: "https://example.com/docs",
        },
        warnings: [/publicOrigin is ignored/],
      },
      {
        label: "publicUrl alone",
        server: { publicUrl: "https://example.com/docs" },
        warnings: [],
      },
    ];

    for (const { label, server, warnings } of cases) {
      const actual = describePublicLocationWarnings({ server } as AppConfig);

      expect.soft(actual, label).toHaveLength(warnings.length);
      warnings.forEach((warning, index) => {
        expect.soft(actual[index], label).toMatch(warning);
      });
    }
  });
});
