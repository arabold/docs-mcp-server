/**
 * Unit tests for EventBusService.
 *
 * Tests the core pub/sub functionality of the event bus, including:
 * - Listener registration and event emission
 * - Unsubscribing listeners
 * - One-time listeners with once()
 * - Removing all listeners
 * - Listener count tracking
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { type InternalPipelineJob, PipelineJobStatus } from "../pipeline/types";
import type { ScraperProgressEvent } from "../scraper/types";
import { EventBusService } from "./EventBusService";
import { EventType } from "./types";

describe("EventBusService", () => {
  let eventBus: EventBusService;

  beforeEach(() => {
    eventBus = new EventBusService();
  });

  describe("on() and emit()", () => {
    it("should register a listener and receive events", () => {
      const listener = vi.fn();
      const mockJob: InternalPipelineJob = {
        id: "test-job-1",
        status: PipelineJobStatus.COMPLETED,
        library: "test-lib",
        version: "1.0.0",
        progress: null,
        error: null,
        createdAt: new Date(),
        startedAt: new Date(),
        finishedAt: new Date(),
        sourceUrl: "https://example.com",
        scraperOptions: {
          url: "https://example.com",
          library: "test-lib",
          version: "1.0.0",
          maxPages: 100,
          maxDepth: 3,
          scope: "subpages",
          followRedirects: true,
        },
        abortController: new AbortController(),
        completionPromise: Promise.resolve(),
        resolveCompletion: () => {},
        rejectCompletion: () => {},
      };

      eventBus.on(EventType.JOB_STATUS_CHANGE, listener);
      eventBus.emit(EventType.JOB_STATUS_CHANGE, mockJob);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(mockJob);
    });

    it("should support multiple listeners for the same event", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      eventBus.on(EventType.LIBRARY_CHANGE, listener1);
      eventBus.on(EventType.LIBRARY_CHANGE, listener2);
      eventBus.emit(EventType.LIBRARY_CHANGE, undefined);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it("should isolate events by type", () => {
      const jobListener = vi.fn();
      const libraryListener = vi.fn();
      const mockJob: InternalPipelineJob = {
        id: "test-job-2",
        status: PipelineJobStatus.RUNNING,
        library: "test-lib",
        version: "1.0.0",
        progress: null,
        error: null,
        createdAt: new Date(),
        startedAt: new Date(),
        finishedAt: null,
        sourceUrl: "https://example.com",
        scraperOptions: {
          url: "https://example.com",
          library: "test-lib",
          version: "1.0.0",
          maxPages: 100,
          maxDepth: 3,
          scope: "subpages",
          followRedirects: true,
        },
        abortController: new AbortController(),
        completionPromise: Promise.resolve(),
        resolveCompletion: () => {},
        rejectCompletion: () => {},
      };

      eventBus.on(EventType.JOB_STATUS_CHANGE, jobListener);
      eventBus.on(EventType.LIBRARY_CHANGE, libraryListener);

      eventBus.emit(EventType.JOB_STATUS_CHANGE, mockJob);

      expect(jobListener).toHaveBeenCalledTimes(1);
      expect(libraryListener).not.toHaveBeenCalled();
    });

    it("should return an unsubscribe function", () => {
      const listener = vi.fn();
      const mockJob: InternalPipelineJob = {
        id: "test-job-3",
        status: PipelineJobStatus.QUEUED,
        library: "test-lib",
        version: "1.0.0",
        progress: null,
        error: null,
        createdAt: new Date(),
        startedAt: null,
        finishedAt: null,
        sourceUrl: "https://example.com",
        scraperOptions: {
          url: "https://example.com",
          library: "test-lib",
          version: "1.0.0",
          maxPages: 100,
          maxDepth: 3,
          scope: "subpages",
          followRedirects: true,
        },
        abortController: new AbortController(),
        completionPromise: Promise.resolve(),
        resolveCompletion: () => {},
        rejectCompletion: () => {},
      };

      const unsubscribe = eventBus.on(EventType.JOB_STATUS_CHANGE, listener);
      eventBus.emit(EventType.JOB_STATUS_CHANGE, mockJob);
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      eventBus.emit(EventType.JOB_STATUS_CHANGE, mockJob);
      expect(listener).toHaveBeenCalledTimes(1); // Still 1, not 2
    });
  });

  describe("off()", () => {
    it("should remove a specific listener", () => {
      const listener = vi.fn();

      eventBus.on(EventType.LIBRARY_CHANGE, listener);
      eventBus.off(EventType.LIBRARY_CHANGE, listener);
      eventBus.emit(EventType.LIBRARY_CHANGE, undefined);

      expect(listener).not.toHaveBeenCalled();
    });

    it("should only remove the specified listener, not others", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      eventBus.on(EventType.LIBRARY_CHANGE, listener1);
      eventBus.on(EventType.LIBRARY_CHANGE, listener2);
      eventBus.off(EventType.LIBRARY_CHANGE, listener1);
      eventBus.emit(EventType.LIBRARY_CHANGE, undefined);

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe("once()", () => {
    it("should trigger listener only once", () => {
      const listener = vi.fn();
      const mockJob: InternalPipelineJob = {
        id: "test-job-4",
        status: PipelineJobStatus.COMPLETED,
        library: "test-lib",
        version: "1.0.0",
        progress: null,
        error: null,
        createdAt: new Date(),
        startedAt: new Date(),
        finishedAt: new Date(),
        sourceUrl: "https://example.com",
        scraperOptions: {
          url: "https://example.com",
          library: "test-lib",
          version: "1.0.0",
          maxPages: 100,
          maxDepth: 3,
          scope: "subpages",
          followRedirects: true,
        },
        abortController: new AbortController(),
        completionPromise: Promise.resolve(),
        resolveCompletion: () => {},
        rejectCompletion: () => {},
      };

      eventBus.once(EventType.JOB_STATUS_CHANGE, listener);
      eventBus.emit(EventType.JOB_STATUS_CHANGE, mockJob);
      eventBus.emit(EventType.JOB_STATUS_CHANGE, mockJob);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should auto-remove listener after first event", () => {
      const listener = vi.fn();

      eventBus.once(EventType.LIBRARY_CHANGE, listener);
      expect(eventBus.listenerCount(EventType.LIBRARY_CHANGE)).toBe(1);

      eventBus.emit(EventType.LIBRARY_CHANGE, undefined);
      expect(eventBus.listenerCount(EventType.LIBRARY_CHANGE)).toBe(0);
    });
  });

  describe("removeAllListeners()", () => {
    it("should remove all listeners for a specific event type", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      eventBus.on(EventType.LIBRARY_CHANGE, listener1);
      eventBus.on(EventType.LIBRARY_CHANGE, listener2);
      eventBus.removeAllListeners(EventType.LIBRARY_CHANGE);
      eventBus.emit(EventType.LIBRARY_CHANGE, undefined);

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });

    it("should not affect listeners of other event types", () => {
      const jobListener = vi.fn();
      const libraryListener = vi.fn();
      const mockJob: InternalPipelineJob = {
        id: "test-job-5",
        status: PipelineJobStatus.FAILED,
        library: "test-lib",
        version: "1.0.0",
        progress: null,
        error: new Error("Test error"),
        createdAt: new Date(),
        startedAt: new Date(),
        finishedAt: new Date(),
        sourceUrl: "https://example.com",
        scraperOptions: {
          url: "https://example.com",
          library: "test-lib",
          version: "1.0.0",
          maxPages: 100,
          maxDepth: 3,
          scope: "subpages",
          followRedirects: true,
        },
        abortController: new AbortController(),
        completionPromise: Promise.resolve(),
        resolveCompletion: () => {},
        rejectCompletion: () => {},
      };

      eventBus.on(EventType.JOB_STATUS_CHANGE, jobListener);
      eventBus.on(EventType.LIBRARY_CHANGE, libraryListener);
      eventBus.removeAllListeners(EventType.LIBRARY_CHANGE);

      eventBus.emit(EventType.JOB_STATUS_CHANGE, mockJob);
      eventBus.emit(EventType.LIBRARY_CHANGE, undefined);

      expect(jobListener).toHaveBeenCalledTimes(1);
      expect(libraryListener).not.toHaveBeenCalled();
    });

    it("should remove all listeners for all event types when no type specified", () => {
      const jobListener = vi.fn();
      const libraryListener = vi.fn();

      eventBus.on(EventType.JOB_STATUS_CHANGE, jobListener);
      eventBus.on(EventType.LIBRARY_CHANGE, libraryListener);
      expect(eventBus.listenerCount(EventType.JOB_STATUS_CHANGE)).toBe(1);
      expect(eventBus.listenerCount(EventType.LIBRARY_CHANGE)).toBe(1);

      eventBus.removeAllListeners();
      expect(eventBus.listenerCount(EventType.JOB_STATUS_CHANGE)).toBe(0);
      expect(eventBus.listenerCount(EventType.LIBRARY_CHANGE)).toBe(0);

      const mockJob: InternalPipelineJob = {
        id: "test-job-6",
        status: PipelineJobStatus.RUNNING,
        library: "test-lib",
        version: "1.0.0",
        progress: null,
        error: null,
        createdAt: new Date(),
        startedAt: new Date(),
        finishedAt: null,
        sourceUrl: "https://example.com",
        scraperOptions: {
          url: "https://example.com",
          library: "test-lib",
          version: "1.0.0",
          maxPages: 100,
          maxDepth: 3,
          scope: "subpages",
          followRedirects: true,
        },
        abortController: new AbortController(),
        completionPromise: Promise.resolve(),
        resolveCompletion: () => {},
        rejectCompletion: () => {},
      };

      eventBus.emit(EventType.JOB_STATUS_CHANGE, mockJob);
      eventBus.emit(EventType.LIBRARY_CHANGE, undefined);

      expect(jobListener).not.toHaveBeenCalled();
      expect(libraryListener).not.toHaveBeenCalled();
    });
  });

  describe("listenerCount()", () => {
    it("should return 0 when no listeners are registered", () => {
      expect(eventBus.listenerCount(EventType.LIBRARY_CHANGE)).toBe(0);
    });

    it("should return correct count after adding listeners", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      eventBus.on(EventType.LIBRARY_CHANGE, listener1);
      expect(eventBus.listenerCount(EventType.LIBRARY_CHANGE)).toBe(1);

      eventBus.on(EventType.LIBRARY_CHANGE, listener2);
      expect(eventBus.listenerCount(EventType.LIBRARY_CHANGE)).toBe(2);
    });

    it("should return correct count after removing listeners", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      eventBus.on(EventType.LIBRARY_CHANGE, listener1);
      eventBus.on(EventType.LIBRARY_CHANGE, listener2);
      eventBus.off(EventType.LIBRARY_CHANGE, listener1);

      expect(eventBus.listenerCount(EventType.LIBRARY_CHANGE)).toBe(1);
    });

    it("should track counts independently for different event types", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      eventBus.on(EventType.JOB_STATUS_CHANGE, listener1);
      eventBus.on(EventType.LIBRARY_CHANGE, listener2);

      expect(eventBus.listenerCount(EventType.JOB_STATUS_CHANGE)).toBe(1);
      expect(eventBus.listenerCount(EventType.LIBRARY_CHANGE)).toBe(1);
    });
  });

  describe("JOB_PROGRESS event", () => {
    it("should emit and receive JOB_PROGRESS events with correct payload structure", () => {
      const listener = vi.fn();
      const mockJob: InternalPipelineJob = {
        id: "test-job-7",
        status: PipelineJobStatus.RUNNING,
        library: "test-lib",
        version: "1.0.0",
        progress: null,
        error: null,
        createdAt: new Date(),
        startedAt: new Date(),
        finishedAt: null,
        sourceUrl: "https://example.com",
        scraperOptions: {
          url: "https://example.com",
          library: "test-lib",
          version: "1.0.0",
          maxPages: 100,
          maxDepth: 3,
          scope: "subpages",
          followRedirects: true,
        },
        abortController: new AbortController(),
        completionPromise: Promise.resolve(),
        resolveCompletion: () => {},
        rejectCompletion: () => {},
      };
      const mockProgress: ScraperProgressEvent = {
        pagesScraped: 10,
        totalPages: 100,
        totalDiscovered: 150,
        currentUrl: "https://example.com/page-10",
        depth: 1,
        maxDepth: 3,
        result: null,
      };

      eventBus.on(EventType.JOB_PROGRESS, listener);
      eventBus.emit(EventType.JOB_PROGRESS, { job: mockJob, progress: mockProgress });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ job: mockJob, progress: mockProgress });
    });
  });
});
