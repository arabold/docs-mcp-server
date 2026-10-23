/**
 * Unit tests for EventBusService: delivery to subscribers and unsubscribing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { type InternalPipelineJob, PipelineJobStatus } from "../pipeline/types";
import { PageOutcome, type ScraperProgressEvent } from "../scraper/types";
import { EventBusService } from "./EventBusService";
import { EventType } from "./types";

const job: InternalPipelineJob = {
  id: "test-job-1",
  status: PipelineJobStatus.RUNNING,
  library: "test-lib",
  version: "1.0.0",
  versionId: 1,
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

const progress: ScraperProgressEvent = {
  pagesScraped: 10,
  totalPages: 100,
  totalDiscovered: 150,
  pagesIndexed: 0,
  outcome: PageOutcome.Unchanged,
  currentUrl: "https://example.com/page-10",
  depth: 1,
  maxDepth: 3,
  result: null,
};

describe("EventBusService", () => {
  let eventBus: EventBusService;

  beforeEach(() => {
    eventBus = new EventBusService();
  });

  it("delivers each event to every subscriber of its type only", () => {
    const statusListener1 = vi.fn();
    const statusListener2 = vi.fn();
    const progressListener = vi.fn();
    const libraryListener = vi.fn();
    eventBus.on(EventType.JOB_STATUS_CHANGE, statusListener1);
    eventBus.on(EventType.JOB_STATUS_CHANGE, statusListener2);
    eventBus.on(EventType.JOB_PROGRESS, progressListener);
    eventBus.on(EventType.LIBRARY_CHANGE, libraryListener);

    eventBus.emit(EventType.JOB_STATUS_CHANGE, job);
    eventBus.emit(EventType.JOB_PROGRESS, { job, progress });

    expect(statusListener1).toHaveBeenCalledTimes(1);
    expect(statusListener1).toHaveBeenCalledWith(job);
    expect(statusListener2).toHaveBeenCalledTimes(1);
    expect(progressListener).toHaveBeenCalledTimes(1);
    expect(progressListener).toHaveBeenCalledWith({ job, progress });
    expect(libraryListener).not.toHaveBeenCalled();
  });

  it("stops delivering to a listener removed with its unsubscribe function or off()", () => {
    const unsubscribed = vi.fn();
    const removed = vi.fn();
    const kept = vi.fn();
    const unsubscribe = eventBus.on(EventType.LIBRARY_CHANGE, unsubscribed);
    eventBus.on(EventType.LIBRARY_CHANGE, removed);
    eventBus.on(EventType.LIBRARY_CHANGE, kept);
    eventBus.emit(EventType.LIBRARY_CHANGE, undefined);

    unsubscribe();
    eventBus.off(EventType.LIBRARY_CHANGE, removed);
    eventBus.emit(EventType.LIBRARY_CHANGE, undefined);

    expect(unsubscribed).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledTimes(1);
    expect(kept).toHaveBeenCalledTimes(2);
  });
});
