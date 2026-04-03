import { describe, expect, it } from "vitest";
import { assertPublicUrl } from "./urlSsrfGuard";

describe("assertPublicUrl", () => {
  describe("should allow valid public URLs", () => {
    it.each([
      "https://docs.example.com/",
      "https://reactjs.org/docs",
      "http://docs.python.org/3/library/",
      "https://github.com/user/repo",
      "https://www.npmjs.com/package/express",
    ])("allows %s", (url) => {
      expect(() => assertPublicUrl(url)).not.toThrow();
    });
  });

  describe("should reject file:// URLs", () => {
    it.each([
      "file:///etc/passwd",
      "file:///Users/user/.ssh/id_rsa",
      "file:///proc/self/environ",
      "file://localhost/etc/passwd",
    ])("rejects %s", (url) => {
      expect(() => assertPublicUrl(url)).toThrow(/not allowed/i);
    });
  });

  describe("should reject non-HTTP schemes", () => {
    it.each([
      "ftp://example.com/file",
      "gopher://evil.com",
      "data:text/html,<h1>hello</h1>",
      "javascript:alert(1)",
    ])("rejects %s", (url) => {
      expect(() => assertPublicUrl(url)).toThrow();
    });
  });

  describe("should reject localhost and loopback", () => {
    it.each([
      "http://localhost/admin",
      "http://localhost:8080/admin",
      "http://127.0.0.1/",
      "http://127.0.0.1:3000/secret",
      "http://127.1/",
      "http://[::1]/",
      "http://[::1]:8080/",
      "http://0.0.0.0/",
    ])("rejects %s", (url) => {
      expect(() => assertPublicUrl(url)).toThrow(/not allowed/i);
    });
  });

  describe("should reject private network ranges", () => {
    it.each([
      "http://10.0.0.1/",
      "http://10.255.255.255/",
      "http://172.16.0.1/",
      "http://172.31.255.255/",
      "http://192.168.0.1/",
      "http://192.168.1.100:8080/internal",
    ])("rejects %s", (url) => {
      expect(() => assertPublicUrl(url)).toThrow(/not allowed/i);
    });
  });

  describe("should reject cloud metadata endpoints", () => {
    it.each([
      "http://169.254.169.254/latest/meta-data/",
      "http://169.254.169.254/metadata/instance",
      "http://169.254.0.1/",
    ])("rejects %s", (url) => {
      expect(() => assertPublicUrl(url)).toThrow(/not allowed/i);
    });
  });

  describe("should reject invalid/empty URLs", () => {
    it.each(["", "not-a-url", "://missing-scheme"])("rejects %s", (url) => {
      expect(() => assertPublicUrl(url)).toThrow();
    });
  });

  describe("should not be bypassed by tricks", () => {
    it("rejects decimal IP for 127.0.0.1", () => {
      // 2130706433 = 127.0.0.1 in decimal
      expect(() => assertPublicUrl("http://2130706433/")).toThrow();
    });

    it("rejects hex IP for 127.0.0.1", () => {
      expect(() => assertPublicUrl("http://0x7f000001/")).toThrow();
    });

    it("rejects octal IP", () => {
      expect(() => assertPublicUrl("http://0177.0.0.1/")).toThrow();
    });

    it("rejects 0 (all-zeros) IP", () => {
      expect(() => assertPublicUrl("http://0/")).toThrow();
    });
  });

  describe("edge cases for IP ranges", () => {
    it("allows 172.15.255.255 (just below private range)", () => {
      expect(() => assertPublicUrl("http://172.15.255.255/")).not.toThrow();
    });

    it("rejects 172.16.0.0 (start of private range)", () => {
      expect(() => assertPublicUrl("http://172.16.0.0/")).toThrow(/not allowed/i);
    });

    it("allows 172.32.0.0 (just above private range)", () => {
      expect(() => assertPublicUrl("http://172.32.0.0/")).not.toThrow();
    });
  });
});
