import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../utils/logger";
import { DocumentManagementClient } from "./DocumentManagementClient";

const ping = vi.hoisted(() => vi.fn());

vi.mock("@trpc/client", () => ({
  createTRPCProxyClient: vi.fn(() => ({ ping: { query: ping } })),
  httpBatchLink: vi.fn(() => ({})),
}));

vi.mock("../utils/logger", () => ({
  logger: { debug: vi.fn() },
}));

describe("DocumentManagementClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not expose the configured endpoint or raw failure during initialization", async () => {
    const endpoint = "http://private-worker.internal:8080/api";
    const rawFailure = "raw connection cause";
    ping.mockRejectedValue(new Error(rawFailure));
    const client = new DocumentManagementClient(endpoint);

    const error = await client.initialize().catch((caughtError: unknown) => caughtError);

    const output = JSON.stringify({
      error: error instanceof Error ? error.message : error,
      logs: vi.mocked(logger.debug).mock.calls,
    });
    expect(output).not.toContain(endpoint);
    expect(output).not.toContain(rawFailure);
    expect(output).not.toContain("private-worker.internal");
  });
});
