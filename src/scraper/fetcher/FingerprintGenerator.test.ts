import { describe, expect, it } from "vitest";
import { FingerprintGenerator } from "./FingerprintGenerator";

describe("FingerprintGenerator", () => {
  it("should generate headers", () => {
    const generator = new FingerprintGenerator();
    const headers = generator.generateHeaders();
    expect(headers).toBeDefined();
    expect(typeof headers).toBe("object");
    expect(Object.keys(headers).length).toBeGreaterThan(0);
    expect(headers["user-agent"]).toBeDefined();
    expect(headers.accept).toBeDefined();
    expect(headers["accept-language"]).toBeDefined();
  });
});
