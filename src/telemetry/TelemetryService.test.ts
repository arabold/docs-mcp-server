import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBusService } from "../events/EventBusService";
import { EventType } from "../events/types";
import { type PipelineJob, PipelineJobStatus } from "../pipeline/types";
import { TelemetryService } from "./TelemetryService";
import { telemetry } from "./telemetry";

vi.mock("./telemetry", () => ({
  telemetry: { track: vi.fn() },
  TelemetryEvent: { PIPELINE_JOB_STARTED: "pipeline_job_started" },
}));

const runningJob = {
  id: "job-1",
  library: "react",
  version: null,
  status: PipelineJobStatus.RUNNING,
  createdAt: new Date(),
  startedAt: new Date(),
} as unknown as PipelineJob;

describe("TelemetryService", () => {
  let eventBus: EventBusService;
  let service: TelemetryService;

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = new EventBusService();
    service = new TelemetryService(eventBus);
  });

  it("reports job events by default", () => {
    eventBus.emit(EventType.JOB_STATUS_CHANGE, runningJob);

    expect(telemetry.track).toHaveBeenCalledWith(
      "pipeline_job_started",
      expect.objectContaining({ jobId: "job-1" }),
    );
  });

  it("ignores job events when job tracking is off", () => {
    service.setJobTracking(false);

    eventBus.emit(EventType.JOB_STATUS_CHANGE, runningJob);

    expect(telemetry.track).not.toHaveBeenCalled();
  });
});
