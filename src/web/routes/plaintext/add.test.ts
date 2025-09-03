import formBody from "@fastify/formbody";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { PlaintextTool } from "../../../tools/PlaintextTool";
import { registerPlaintextRoutes } from "./add";

describe("Plaintext web routes", () => {
  it("GET /web/plaintext/new should return the embedded plaintext form", async () => {
    const server = Fastify({ logger: false });
    await server.register(formBody);

    // Dummy tool instance; not used by GET route but required by signature
    const dummyTool = { execute: vi.fn() } as unknown as PlaintextTool;
    registerPlaintextRoutes(server, dummyTool);

    const res = await server.inject({ method: "GET", url: "/web/plaintext/new" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain('id="plaintext-form-container"');
    expect(res.body).toContain('hx-post="/web/plaintext/add"');
  });

  it("POST /web/plaintext/add should validate required fields", async () => {
    const server = Fastify({ logger: false });
    await server.register(formBody);

    // Dummy tool instance; execute should not be called when validation fails
    const dummyTool = { execute: vi.fn() } as unknown as PlaintextTool;
    registerPlaintextRoutes(server, dummyTool);

    const res = await server.inject({
      method: "POST",
      url: "/web/plaintext/add",
      payload: { library: "", title: "", content: "" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Validation Error");
    expect(dummyTool.execute).not.toHaveBeenCalled();
  });
});
