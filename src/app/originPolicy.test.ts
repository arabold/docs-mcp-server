import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import {
  createHostPolicy,
  createOriginPolicy,
  isLoopbackBindHost,
  setCorsPreflightHeaders,
  setCorsResponseHeaders,
} from "./originPolicy";

function createResponse(): ServerResponse {
  return new ServerResponse(new IncomingMessage(new Socket()));
}

describe("createOriginPolicy", () => {
  it("allows loopback, the public URL's origin and listed origins, and denies the rest", () => {
    const policy = createOriginPolicy({
      publicOrigin: "https://example.com",
      allowedOrigins: ["https://inspector.example.com"],
    });
    const cases: Array<{ origin: string | undefined; expected: string }> = [
      { origin: undefined, expected: "absent" },
      // Loopback on any scheme and port
      { origin: "http://localhost:6274", expected: "allowed" },
      { origin: "http://127.0.0.1", expected: "allowed" },
      { origin: "https://localhost", expected: "allowed" },
      { origin: "http://[::1]:3000", expected: "allowed" },
      // The public URL's origin
      { origin: "https://example.com", expected: "allowed" },
      { origin: "https://example.com:443", expected: "allowed" },
      // The public host on another scheme or port
      { origin: "http://example.com", expected: "denied" },
      { origin: "https://example.com:8443", expected: "denied" },
      { origin: "http://example.com:8080", expected: "denied" },
      // A configured origin, only as an exact match
      { origin: "https://inspector.example.com", expected: "allowed" },
      { origin: "https://inspector.example.com:8443", expected: "denied" },
      { origin: "http://inspector.example.com", expected: "denied" },
      { origin: "null", expected: "denied" },
      { origin: "", expected: "denied" },
      { origin: "not a url", expected: "denied" },
      { origin: "file:///etc/passwd", expected: "denied" },
      { origin: "https://attacker.example", expected: "denied" },
      { origin: "https://example.com.attacker.example", expected: "denied" },
    ];

    for (const { origin, expected } of cases) {
      expect.soft(policy.check(origin), String(origin)).toBe(expected);
    }
  });

  it("allows only loopback and listed origins without a public URL", () => {
    const local = createOriginPolicy({ allowedOrigins: [] });
    expect(local.check("http://localhost:6274")).toBe("allowed");
    expect(local.check("https://example.com")).toBe("denied");
  });
});

describe("createHostPolicy", () => {
  it("accepts IPs, single-label names, the public host and listed hosts, and refuses the rest", () => {
    const policy = createHostPolicy({
      publicOrigin: "https://docs.example.com",
      allowedOrigins: ["http://nas.local:6280"],
    });
    const cases: Array<{ host: string | undefined; expected: boolean }> = [
      // A request without a Host header is served
      { host: undefined, expected: true },
      { host: "", expected: true },
      { host: "127.0.0.1:6280", expected: true },
      { host: "10.0.0.5", expected: true },
      { host: "192.168.1.20:6280", expected: true },
      { host: "[::1]:6280", expected: true },
      { host: "[fe80::1]", expected: true },
      { host: "localhost:6280", expected: true },
      { host: "LOCALHOST", expected: true },
      { host: "docs-mcp-server:6280", expected: true },
      { host: "docs.example.com", expected: true },
      { host: "DOCS.example.com:443", expected: true },
      { host: "nas.local:6280", expected: true },
      { host: "nas.local", expected: true },
      { host: "attacker.example:6280", expected: false },
      { host: "attacker.rebind.example", expected: false },
      { host: "docs.example.com.attacker.example", expected: false },
      { host: "localhost.", expected: false },
      { host: "localhost.attacker.example", expected: false },
      { host: "127.0.0.1.nip.io", expected: false },
      { host: "evil.example@127.0.0.1", expected: false },
      { host: "127.0.0.1/evil", expected: false },
      { host: "a b", expected: false },
      { host: "attacker.example:99999", expected: false },
      { host: "localhost:99999", expected: false },
      { host: "[::::]", expected: false },
    ];

    for (const { host, expected } of cases) {
      expect.soft(policy.isAllowed(host), String(host)).toBe(expected);
    }
  });

  it("refuses every dotted name without a public URL or allowed origins", () => {
    const local = createHostPolicy({ allowedOrigins: [] });
    expect(local.isAllowed("docs.example.com")).toBe(false);
    expect(local.isAllowed("localhost:6280")).toBe(true);
  });
});

describe("setCorsResponseHeaders", () => {
  it("echoes the origin, exposes the challenge header and varies on Origin", () => {
    const res = createResponse();
    res.setHeader("Vary", "Accept-Encoding");

    setCorsResponseHeaders(res, "http://localhost:6274");

    expect(res.getHeader("Access-Control-Allow-Origin")).toBe("http://localhost:6274");
    expect(res.getHeader("Access-Control-Expose-Headers")).toBe("WWW-Authenticate");
    expect(res.getHeader("Vary")).toBe("Accept-Encoding, Origin");
  });
});

describe("setCorsPreflightHeaders", () => {
  it("allows POST and echoes the requested headers", () => {
    const res = createResponse();

    setCorsPreflightHeaders(res, {
      origin: "http://localhost:6274",
      methods: "POST",
      requestedHeaders:
        "authorization, content-type, mcp-protocol-version, mcp-param-region",
    });

    expect(res.getHeader("Access-Control-Allow-Origin")).toBe("http://localhost:6274");
    expect(res.getHeader("Access-Control-Allow-Methods")).toBe("POST");
    expect(res.getHeader("Access-Control-Allow-Headers")).toBe(
      "authorization, content-type, mcp-protocol-version, mcp-param-region",
    );
    expect(res.getHeader("Access-Control-Max-Age")).toBe("600");
    expect(res.getHeader("Vary")).toBe("Origin, Access-Control-Request-Headers");
  });

  it("drops requested header names that are not valid tokens", () => {
    const res = createResponse();

    setCorsPreflightHeaders(res, {
      origin: "http://localhost:6274",
      methods: "POST",
      requestedHeaders: "content-type, bad header, x\r\ny",
    });

    expect(res.getHeader("Access-Control-Allow-Headers")).toBe("content-type");
  });
});

describe("isLoopbackBindHost", () => {
  it("tells loopback bind hosts from network-exposed ones", () => {
    const cases: Array<{ host: string; loopback: boolean }> = [
      { host: "127.0.0.1", loopback: true },
      { host: "127.0.1.1", loopback: true },
      { host: "localhost", loopback: true },
      { host: "::1", loopback: true },
      { host: "[::1]", loopback: true },
      { host: "0:0:0:0:0:0:0:1", loopback: true },
      { host: "[0:0:0:0:0:0:0:1]", loopback: true },
      { host: "::ffff:127.0.0.1", loopback: true },
      { host: "::1%lo0", loopback: true },
      { host: "0.0.0.0", loopback: false },
      { host: "::", loopback: false },
      { host: "0:0:0:0:0:0:0:0", loopback: false },
      { host: "::ffff:10.0.0.1", loopback: false },
      { host: "fe80::1%en0", loopback: false },
      { host: "192.168.1.10", loopback: false },
      { host: "docs.internal", loopback: false },
    ];

    for (const { host, loopback } of cases) {
      expect.soft(isLoopbackBindHost(host), host).toBe(loopback);
    }
  });
});
