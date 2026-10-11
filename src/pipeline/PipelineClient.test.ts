import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBusService } from "../events/EventBusService";
import type { RemoteEventProxy } from "../events/RemoteEventProxy";
import { EventType } from "../events/types";
import type { ApiClient } from "../services/apiClient";
import { logger } from "../utils/logger";
import { EVENTS_CONNECT_TIMEOUT_MS, PipelineClient } from "./PipelineClient";

// The worker's API client, as PipelineClient calls it
const mockClient: any = {
  ping: { query: vi.fn() },
  enqueueScrapeJob: { mutate: vi.fn() },
  enqueueRefreshJob: { mutate: vi.fn() },
  getJob: { query: vi.fn() },
  getJobs: { query: vi.fn() },
  cancelJob: { mutate: vi.fn() },
  clearCompletedJobs: { mutate: vi.fn() },
};

// The relay that brings the worker's events to the local bus
const mockRelay = {
  connect: vi.fn(),
  isActive: vi.fn(),
};

describe("PipelineClient", () => {
  let client: PipelineClient;
  let eventBus: EventBusService;
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
    mockRelay.connect.mockResolvedValue(true);
    mockRelay.isActive.mockReturnValue(false);
    eventBus = new EventBusService();
    client = new PipelineClient(
      mockClient as ApiClient,
      eventBus,
      mockRelay as unknown as RemoteEventProxy,
    );
  });

  describe("waiting for the worker's events before submitting", () => {
    it("submits the first job only once the event stream is live", async () => {
      let goLive: (live: boolean) => void = () => {};
      mockRelay.connect.mockReturnValueOnce(new Promise((resolve) => (goLive = resolve)));

      const enqueued = client.enqueueScrapeJob("react", null, {} as any);
      await Promise.resolve();
      expect(mockClient.enqueueScrapeJob.mutate).not.toHaveBeenCalled();

      goLive(true);
      await enqueued;
      expect(mockRelay.connect).toHaveBeenCalledWith(EVENTS_CONNECT_TIMEOUT_MS);
      expect(mockClient.enqueueScrapeJob.mutate).toHaveBeenCalledTimes(1);
    });

    it("warns once and submits anyway when the stream is not live in time", async () => {
      mockRelay.connect.mockResolvedValue(false);
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

      await client.enqueueScrapeJob("react", null, {} as any);
      await client.enqueueRefreshJob("react", null);

      expect(mockRelay.connect).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain(
        "Live job updates from the worker are unavailable",
      );
      expect(mockClient.enqueueRefreshJob.mutate).toHaveBeenCalledTimes(1);
      warn.mockRestore();
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

    it("should give up once lookups have failed for 30 seconds", async () => {
      vi.useFakeTimers();
      mockClient.getJob.query.mockRejectedValue(new Error("Connection refused"));
      let outcome: unknown;
      client.waitForJobCompletion("job-123").catch((error) => (outcome = error));

      await vi.advanceTimersByTimeAsync(29_000);
      expect(outcome).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1000);

      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).message).toContain("Connection refused");
    });

    it("should look up every second while the worker's events do not arrive", async () => {
      vi.useFakeTimers();
      void client.waitForJobCompletion("job-123");

      await vi.advanceTimersByTimeAsync(3000);

      expect(mockClient.getJob.query).toHaveBeenCalledTimes(4);
    });

    it("should look up only every 10 seconds while the worker's events arrive", async () => {
      vi.useFakeTimers();
      mockRelay.isActive.mockReturnValue(true);
      void client.waitForJobCompletion("job-123");

      await vi.advanceTimersByTimeAsync(9000);
      expect(mockClient.getJob.query).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockClient.getJob.query).toHaveBeenCalledTimes(2);
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
