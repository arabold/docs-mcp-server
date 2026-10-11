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

  it("fails when the worker has never answered", async () => {
    const client = clientAnswering(vi.fn().mockRejectedValue(new Error("down")));

    await expect(client.getEmbeddingConfigInfo()).rejects.toThrow("down");
  });
});
