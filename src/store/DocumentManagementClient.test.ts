import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../services/apiClient";
import { DocumentManagementClient } from "./DocumentManagementClient";

function clientAnswering(query: ReturnType<typeof vi.fn>) {
  return new DocumentManagementClient({
    getEmbeddingConfig: { query },
  } as unknown as ApiClient);
}

describe("DocumentManagementClient.getEmbeddingConfigInfo", () => {
  const config = {
    provider: "openai",
    model: "text-embedding-3-small",
    dimensions: 1536,
  };

  it("reports the worker's last known config while the worker does not answer", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(config)
      .mockRejectedValue(new Error("down"));
    const client = clientAnswering(query);

    await client.getEmbeddingConfigInfo();

    await expect(client.getEmbeddingConfigInfo()).resolves.toEqual(config);
  });

  it("gives up on a worker that does not answer in time", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(config)
      .mockImplementation(
        (_input: unknown, opts: { signal: AbortSignal }) =>
          new Promise((_, reject) =>
            opts.signal.addEventListener("abort", () => reject(opts.signal.reason)),
          ),
      );
    const client = clientAnswering(query);
    await client.getEmbeddingConfigInfo();
    vi.useFakeTimers();

    try {
      const lookup = client.getEmbeddingConfigInfo();
      await vi.advanceTimersByTimeAsync(3000);

      await expect(lookup).resolves.toEqual(config);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails when the worker has never answered", async () => {
    const client = clientAnswering(vi.fn().mockRejectedValue(new Error("down")));

    await expect(client.getEmbeddingConfigInfo()).rejects.toThrow("down");
  });
});
