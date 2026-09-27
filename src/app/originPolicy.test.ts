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
  const policy = createOriginPolicy({
    publicOrigin: "https://example.com",
    allowedOrigins: ["https://inspector.example.com"],
  });

  it("reports a missing Origin as absent", () => {
    expect(policy.check(undefined)).toBe("absent");
  });

  it.each([
    "http://localhost:6274",
    "http://127.0.0.1",
    "https://localhost",
    "http://[::1]:3000",
  ])("allows loopback origin %s on any scheme and port", (origin) => {
    expect(policy.check(origin)).toBe("allowed");
  });

  it("allows the public URL's origin", () => {
    expect(policy.check("https://example.com")).toBe("allowed");
    expect(policy.check("https://example.com:443")).toBe("allowed");
  });

  it.each(["http://example.com", "https://example.com:8443", "http://example.com:8080"])(
    "denies the public host on another scheme or port: %s",
    (origin) => {
      expect(policy.check(origin)).toBe("denied");
    },
  );

  it("allows a configured origin only as an exact match", () => {
    expect(policy.check("https://inspector.example.com")).toBe("allowed");
    expect(policy.check("https://inspector.example.com:8443")).toBe("denied");
    expect(policy.check("http://inspector.example.com")).toBe("denied");
  });

  it.each([
    "null",
    "",
    "not a url",
    "file:///etc/passwd",
    "https://attacker.example",
    "https://example.com.attacker.example",
  ])("denies origin %s", (origin) => {
    expect(policy.check(origin)).toBe("denied");
  });

  it("allows only loopback and listed origins without a public URL", () => {
    const local = createOriginPolicy({ allowedOrigins: [] });
    expect(local.check("http://localhost:6274")).toBe("allowed");
    expect(local.check("https://example.com")).toBe("denied");
  });
});

describe("createHostPolicy", () => {
  const policy = createHostPolicy({
    publicHostname: "docs.example.com",
    allowedOrigins: ["http://nas.local:6280"],
  });

  it("serves a request without a Host header", () => {
    expect(policy.isAllowed(undefined)).toBe(true);
    expect(policy.isAllowed("")).toBe(true);
  });

  it.each([
    "127.0.0.1:6280",
    "10.0.0.5",
    "192.168.1.20:6280",
    "[::1]:6280",
    "[fe80::1]",
    "localhost:6280",
    "LOCALHOST",
    "docs-mcp-server:6280",
    "docs.example.com",
    "DOCS.example.com:443",
    "nas.local:6280",
    "nas.local",
  ])("accepts %s", (host) => {
    expect(policy.isAllowed(host)).toBe(true);
  });

  it.each([
    "attacker.example:6280",
    "attacker.rebind.example",
    "docs.example.com.attacker.example",
    "localhost.",
    "localhost.attacker.example",
    "127.0.0.1.nip.io",
    "evil.example@127.0.0.1",
    "127.0.0.1/evil",
    "a b",
  ])("refuses %s", (host) => {
    expect(policy.isAllowed(host)).toBe(false);
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

    setCorsPreflightHeaders(
      res,
      "http://localhost:6274",
      "authorization, content-type, mcp-protocol-version, mcp-param-region",
    );

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

    setCorsPreflightHeaders(
      res,
      "http://localhost:6274",
      "content-type, bad header, x\r\ny",
    );

    expect(res.getHeader("Access-Control-Allow-Headers")).toBe("content-type");
  });
});

describe("isLoopbackBindHost", () => {
  it.each(["127.0.0.1", "127.0.1.1", "localhost", "::1", "[::1]"])(
    "treats %s as loopback",
    (host) => {
      expect(isLoopbackBindHost(host)).toBe(true);
    },
  );

  it.each(["0.0.0.0", "::", "192.168.1.10", "docs.internal"])(
    "treats %s as network-exposed",
    (host) => {
      expect(isLoopbackBindHost(host)).toBe(false);
    },
  );
});
