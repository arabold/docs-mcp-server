import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import {
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
    publicHostname: "example.com",
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

  it("allows the public URL's host on any scheme and port", () => {
    expect(policy.check("https://example.com")).toBe("allowed");
    expect(policy.check("http://example.com:8080")).toBe("allowed");
  });

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
