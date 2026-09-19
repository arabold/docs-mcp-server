import { describe, expect, it, vi } from "vitest";
import { CircuitBreakingReranker } from "./CircuitBreakingReranker";
import type { Reranker } from "./Reranker";

const candidates = [{ index: 0, content: "candidate" }];

describe("CircuitBreakingReranker", () => {
  it("opens after three consecutive runtime failures and immediately bypasses the provider", async () => {
    const rerank = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const circuit = new CircuitBreakingReranker({ rerank } satisfies Reranker);

    await openCircuit(circuit);
    await expect(circuit.rerank("query", candidates)).rejects.toThrow(
      "Reranking unavailable: circuit_open",
    );

    expect(rerank).toHaveBeenCalledTimes(3);
  });

  it("resets consecutive failures after a valid response", async () => {
    const validResult = { scores: [{ index: 0, score: 0.8 }] };
    const rerank = vi
      .fn()
      .mockRejectedValueOnce(new Error("failure one"))
      .mockRejectedValueOnce(new Error("failure two"))
      .mockResolvedValueOnce(validResult)
      .mockRejectedValueOnce(new Error("failure after reset one"))
      .mockRejectedValueOnce(new Error("failure after reset two"));
    const circuit = new CircuitBreakingReranker({ rerank } satisfies Reranker);

    await expect(circuit.rerank("query", candidates)).rejects.toThrow();
    await expect(circuit.rerank("query", candidates)).rejects.toThrow();
    await expect(circuit.rerank("query", candidates)).resolves.toEqual(validResult);
    await expect(circuit.rerank("query", candidates)).rejects.toThrow();
    await expect(circuit.rerank("query", candidates)).rejects.toThrow();

    expect(rerank).toHaveBeenCalledTimes(5);
  });

  it("keeps the provider bypassed for the full sixty-second pause", async () => {
    let now = 1_000;
    const rerank = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const circuit = new CircuitBreakingReranker({ rerank } satisfies Reranker, {
      now: () => now,
    });
    await openCircuit(circuit);

    now += 59_999;
    await expect(circuit.rerank("query", candidates)).rejects.toThrow(
      "Reranking unavailable: circuit_open",
    );

    expect(rerank).toHaveBeenCalledTimes(3);
  });

  it("allows exactly one concurrent probe after the pause", async () => {
    let now = 1_000;
    let resolveProbe:
      | ((result: { scores: { index: number; score: number }[] }) => void)
      | undefined;
    const probeResult = { scores: [{ index: 0, score: 0.9 }] };
    const rerank = vi
      .fn()
      .mockRejectedValueOnce(new Error("failure one"))
      .mockRejectedValueOnce(new Error("failure two"))
      .mockRejectedValueOnce(new Error("failure three"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveProbe = resolve;
          }),
      );
    const circuit = new CircuitBreakingReranker({ rerank } satisfies Reranker, {
      now: () => now,
    });
    await openCircuit(circuit);
    now += 60_000;

    const probe = circuit.rerank("probe query", candidates);
    await expect(circuit.rerank("concurrent query", candidates)).rejects.toThrow(
      "Reranking unavailable: probe_in_progress",
    );
    expect(rerank).toHaveBeenCalledTimes(4);
    resolveProbe?.(probeResult);
    await expect(probe).resolves.toEqual(probeResult);
  });

  it("closes the circuit after a successful probe", async () => {
    let now = 1_000;
    const validResult = { scores: [{ index: 0, score: 0.9 }] };
    const rerank = vi
      .fn()
      .mockRejectedValueOnce(new Error("failure one"))
      .mockRejectedValueOnce(new Error("failure two"))
      .mockRejectedValueOnce(new Error("failure three"))
      .mockResolvedValue(validResult);
    const circuit = new CircuitBreakingReranker({ rerank } satisfies Reranker, {
      now: () => now,
    });
    await openCircuit(circuit);
    now += 60_000;

    await expect(circuit.rerank("probe", candidates)).resolves.toEqual(validResult);
    await expect(circuit.rerank("normal query", candidates)).resolves.toEqual(
      validResult,
    );

    expect(rerank).toHaveBeenCalledTimes(5);
  });

  it("restarts the sixty-second pause after a failed probe", async () => {
    let now = 1_000;
    const rerank = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const circuit = new CircuitBreakingReranker({ rerank } satisfies Reranker, {
      now: () => now,
    });
    await openCircuit(circuit);
    now += 60_000;
    await expect(circuit.rerank("failed probe", candidates)).rejects.toThrow();
    now += 59_999;
    await expect(circuit.rerank("before next probe", candidates)).rejects.toThrow(
      "Reranking unavailable: circuit_open",
    );
    now += 1;
    await expect(circuit.rerank("next probe", candidates)).rejects.toThrow();

    expect(rerank).toHaveBeenCalledTimes(5);
  });

  it("keeps circuit state process-local to each wrapper instance", async () => {
    const failingRerank = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const firstCircuit = new CircuitBreakingReranker({
      rerank: failingRerank,
    } satisfies Reranker);
    await openCircuit(firstCircuit);
    const freshRerank = vi.fn().mockResolvedValue({
      scores: [{ index: 0, score: 0.7 }],
    });
    const freshCircuit = new CircuitBreakingReranker({
      rerank: freshRerank,
    } satisfies Reranker);

    await expect(freshCircuit.rerank("query", candidates)).resolves.toEqual({
      scores: [{ index: 0, score: 0.7 }],
    });

    expect(freshRerank).toHaveBeenCalledOnce();
  });
});

async function openCircuit(circuit: CircuitBreakingReranker): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await circuit.rerank("query", candidates).catch(() => undefined);
  }
}
