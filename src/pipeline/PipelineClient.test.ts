import { createWSClient } from "@trpc/client";
import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBusService } from "../events/EventBusService";
import { EventType } from "../events/types";
import { PipelineClient } from "./PipelineClient";

// Mock tRPC client factory
const mockClient: any = {
  ping: { query: vi.fn() },
  enqueueScrapeJob: { mutate: vi.fn() },
  enqueueRefreshJob: { mutate: vi.fn() },
  getJob: { query: vi.fn() },
  getJobs: { query: vi.fn() },
  cancelJob: { mutate: vi.fn() },
  clearCompletedJobs: { mutate: vi.fn() },
};

// Mock WebSocket client
const mockWsClient = {
  close: vi.fn(),
};

vi.mock("@trpc/client", () => {
  return {
    createTRPCProxyClient: () => mockClient,
    httpBatchLink: vi.fn(),
    createWSClient: vi.fn(() => mockWsClient),
    wsLink: vi.fn(),
    splitLink: vi.fn(),
  } as any;
});

describe("PipelineClient", () => {
  let client: PipelineClient;
  let eventBus: EventBusService;
  const serverUrl = "http://localhost:8080";

  beforeEach(() => {
    vi.resetAllMocks();
    // Reset default mock behaviors
    mockClient.ping.query.mockResolvedValue({ status: "ok" });
    mockClient.enqueueScrapeJob.mutate.mockResolvedValue({ jobId: "job-123" });
    mockClient.enqueueRefreshJob.mutate.mockResolvedValue({ jobId: "job-456" });
    mockClient.getJob.query.mockResolvedValue(undefined);
    mockClient.getJobs.query.mockResolvedValue({ jobs: [] });
    mockClient.cancelJob.mutate.mockResolvedValue({ success: true });
    mockClient.clearCompletedJobs.mutate.mockResolvedValue({ count: 5 });
    eventBus = new EventBusService();
    client = new PipelineClient(serverUrl, eventBus);
  });

  it("opens the WebSocket at the worker URL, path included", () => {
    new PipelineClient("https://example.com/docs/api", eventBus);

    expect(createWSClient).toHaveBeenLastCalledWith({
      url: "wss://example.com/docs/api",
    });
  });

  describe("start", () => {
    it("should succeed when external worker is healthy", async () => {
      await expect(client.start()).resolves.toBeUndefined();
      expect(mockClient.ping.query).toHaveBeenCalled();
    });

    it("should fail when external worker is unreachable", async () => {
      mockClient.ping.query.mockRejectedValueOnce(new Error("Connection refused"));
      await expect(client.start()).rejects.toThrow(
        "Failed to connect to external worker",
      );
    });
  });

  describe("enqueueScrapeJob", () => {
    it("should delegate job creation to external API", async () => {
      const mockJobId = "job-123";
      mockClient.enqueueScrapeJob.mutate.mockResolvedValueOnce({ jobId: mockJobId });
      const jobId = await client.enqueueScrapeJob("react", "18.0.0", {
        url: "https://react.dev",
        library: "react",
        version: "18.0.0",
      });

      expect(jobId).toBe(mockJobId);
      expect(mockClient.enqueueScrapeJob.mutate).toHaveBeenCalledWith({
        library: "react",
        version: "18.0.0",
        options: {
          url: "https://react.dev",
          library: "react",
          version: "18.0.0",
        },
      });
    });

    it("should handle API errors gracefully", async () => {
      mockClient.enqueueScrapeJob.mutate.mockRejectedValueOnce(new Error("Bad request"));

      await expect(client.enqueueScrapeJob("invalid", null, {} as any)).rejects.toThrow(
        "Failed to enqueue job: Bad request",
      );
    });
    it("should forward the overwrite intent", async () => {
      mockClient.enqueueScrapeJob.mutate.mockResolvedValueOnce({ jobId: "job-1" });

      await client.enqueueScrapeJob("react", null, { url: "https://react.dev" } as any, {
        onExisting: "replace",
      });

      expect(mockClient.enqueueScrapeJob.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ onExisting: "replace" }),
      );
    });

    it("should relay a worker conflict as a TRPCError with the same code and message", async () => {
      const workerError = Object.assign(new Error('Library "React" already exists.'), {
        data: { code: "CONFLICT" },
      });
      mockClient.enqueueScrapeJob.mutate.mockRejectedValueOnce(workerError);

      const failure = client.enqueueScrapeJob("react", null, {} as any);

      await expect(failure).rejects.toBeInstanceOf(TRPCError);
      await expect(failure).rejects.toMatchObject({
        code: "CONFLICT",
        message: 'Library "React" already exists.',
      });
    });

    it("should keep other worker codes in the generic enqueue error", async () => {
      const workerError = Object.assign(new Error("Unauthorized"), {
        data: { code: "UNAUTHORIZED" },
      });
      mockClient.enqueueScrapeJob.mutate.mockRejectedValueOnce(workerError);

      const failure = client.enqueueScrapeJob("react", null, {} as any);

      await expect(failure).rejects.not.toBeInstanceOf(TRPCError);
      await expect(failure).rejects.toThrow("Failed to enqueue job: Unauthorized");
    });

    it("should relay a refresh NOT_FOUND from the worker", async () => {
      const workerError = Object.assign(new Error("Library Reakt not found in store."), {
        data: { code: "NOT_FOUND" },
      });
      mockClient.enqueueRefreshJob.mutate.mockRejectedValueOnce(workerError);

      await expect(client.enqueueRefreshJob("reakt", null)).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Library Reakt not found in store.",
      });
    });
  });

  describe("waitForJobCompletion", () => {
    const runningJob = { id: "job-123", status: "running", error: null };

    beforeEach(() => {
      mockClient.getJob.query.mockResolvedValue(runningJob);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should resolve from the worker's job state when no event arrives", async () => {
      vi.useFakeTimers();
      mockClient.getJob.query
        .mockResolvedValueOnce(runningJob)
        .mockResolvedValueOnce({ ...runningJob, status: "completed" });

      const waitPromise = client.waitForJobCompletion("job-123");
      await vi.advanceTimersByTimeAsync(1000);

      await expect(waitPromise).resolves.toBeUndefined();
    });

    it("should resolve right away for a job that finished before the wait", async () => {
      mockClient.getJob.query.mockResolvedValue({ ...runningJob, status: "cancelled" });

      await expect(client.waitForJobCompletion("job-123")).resolves.toBeUndefined();
    });

    it("should reject with the job's error when the worker reports it failed", async () => {
      mockClient.getJob.query.mockResolvedValue({
        ...runningJob,
        status: "failed",
        error: { message: "Outside the allowed roots" },
      });

      await expect(client.waitForJobCompletion("job-123")).rejects.toThrow(
        "Outside the allowed roots",
      );
    });

    it("should reject with the worker's message from a relayed failure event", async () => {
      const waitPromise = client.waitForJobCompletion("job-123");

      // PipelineManager emits FAILED before it sets `error`; only `errorMessage` has the text
      eventBus.emit(EventType.JOB_STATUS_CHANGE, {
        ...runningJob,
        status: "failed",
        error: null,
        errorMessage: "Outside the allowed roots",
      } as any);

      await expect(waitPromise).rejects.toThrow("Outside the allowed roots");
    });

    it("should reject for a failed job that carries no error message", async () => {
      const waitPromise = client.waitForJobCompletion("job-123");

      eventBus.emit(EventType.JOB_STATUS_CHANGE, {
        ...runningJob,
        status: "failed",
      } as any);

      await expect(waitPromise).rejects.toThrow("Job job-123 failed");
    });

    it("should reject when the worker does not know the job", async () => {
      mockClient.getJob.query.mockResolvedValue(undefined);

      await expect(client.waitForJobCompletion("job-123")).rejects.toThrow(
        "Job not found: job-123",
      );
    });

    it("should keep waiting through a failed lookup", async () => {
      vi.useFakeTimers();
      mockClient.getJob.query
        .mockRejectedValueOnce(new Error("socket hang up"))
        .mockResolvedValueOnce({ ...runningJob, status: "completed" });

      const waitPromise = client.waitForJobCompletion("job-123");
      await vi.advanceTimersByTimeAsync(1000);

      await expect(waitPromise).resolves.toBeUndefined();
    });

    it("should give up after five failed lookups in a row", async () => {
      vi.useFakeTimers();
      mockClient.getJob.query.mockRejectedValue(new Error("Connection refused"));

      const waitPromise = client.waitForJobCompletion("job-123");
      const outcome = expect(waitPromise).rejects.toThrow("Connection refused");
      await vi.advanceTimersByTimeAsync(4000);

      await outcome;
      expect(mockClient.getJob.query).toHaveBeenCalledTimes(5);
    });

    it("should stop asking the worker once an event settles the wait", async () => {
      vi.useFakeTimers();
      const waitPromise = client.waitForJobCompletion("job-123");
      await vi.advanceTimersByTimeAsync(0);

      eventBus.emit(EventType.JOB_STATUS_CHANGE, {
        ...runningJob,
        status: "completed",
      } as any);
      await expect(waitPromise).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(5000);

      expect(mockClient.getJob.query).toHaveBeenCalledTimes(1);
    });

    it("should resolve when job completes successfully via event bus", async () => {
      const jobId = "job-123";

      // Start waiting
      const waitPromise = client.waitForJobCompletion(jobId);

      // Simulate event bus emitting status change
      setTimeout(() => {
        eventBus.emit(EventType.JOB_STATUS_CHANGE, {
          id: jobId,
          status: "completed",
          library: "test",
          version: null,
        } as any);
      }, 10);

      await expect(waitPromise).resolves.toBeUndefined();
    });

    it("should throw error when job fails via event bus", async () => {
      const jobId = "job-123";

      // Start waiting
      const waitPromise = client.waitForJobCompletion(jobId);

      // Simulate event bus emitting failure
      setTimeout(() => {
        eventBus.emit(EventType.JOB_STATUS_CHANGE, {
          id: jobId,
          status: "failed",
          library: "test",
          version: null,
          error: { message: "Scraping failed" },
        } as any);
      }, 10);

      await expect(waitPromise).rejects.toThrow("Scraping failed");
    });

    it("should ignore events for other jobs", async () => {
      const jobId = "job-123";

      // Start waiting
      const waitPromise = client.waitForJobCompletion(jobId);

      // Emit events for different job (should be ignored)
      setTimeout(() => {
        eventBus.emit(EventType.JOB_STATUS_CHANGE, {
          id: "other-job",
          status: "completed",
          library: "test",
          version: null,
        } as any);
      }, 10);

      // Emit event for our job
      setTimeout(() => {
        eventBus.emit(EventType.JOB_STATUS_CHANGE, {
          id: jobId,
          status: "completed",
          library: "test",
          version: null,
        } as any);
      }, 20);

      await expect(waitPromise).resolves.toBeUndefined();
    });
  });

  describe("getJob", () => {
    it("should return undefined for non-existent job", async () => {
      mockClient.getJob.query.mockResolvedValueOnce(undefined);

      const result = await client.getJob("non-existent");
      expect(result).toBeUndefined();
    });

    it("should return job data for existing job", async () => {
      // Mock returns a Date object (simulating superjson deserialization)
      const mockJob = {
        id: "job-123",
        status: "completed",
        createdAt: new Date("2023-01-01T00:00:00.000Z"),
        startedAt: null,
        finishedAt: null,
        updatedAt: undefined,
      };

      mockClient.getJob.query.mockResolvedValueOnce(mockJob);

      const result = await client.getJob("job-123");
      expect(result).toEqual(mockJob);
    });
  });
});
