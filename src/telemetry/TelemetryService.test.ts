import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBusService } from "../events/EventBusService";
import { EventType } from "../events/types";
import { type PipelineJob, PipelineJobStatus } from "../pipeline/types";
import { TelemetryService } from "./TelemetryService";
import { TelemetryEvent, telemetry } from "./telemetry";

vi.mock("./telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./telemetry")>()),
  telemetry: { track: vi.fn() },
}));

describe("TelemetryService", () => {
  let service: TelemetryService | undefined;

  afterEach(() => {
    service?.shutdown();
    vi.mocked(telemetry.track).mockClear();
  });

  it("should send failed job errors without URLs or paths", () => {
    const eventBus = new EventBusService();
    service = new TelemetryService(eventBus);
    const job = {
      id: "job-1",
      library: "react",
      version: "18.0.0",
      status: PipelineJobStatus.FAILED,
      progressPages: 3,
      startedAt: new Date(),
      createdAt: new Date(),
      error: new Error(
        "Failed to fetch https://intranet.example.com/team/page while writing /Users/john/store",
      ),
    } as unknown as PipelineJob;

    eventBus.emit(EventType.JOB_STATUS_CHANGE, job);

    expect(telemetry.track).toHaveBeenCalledWith(
      TelemetryEvent.PIPELINE_JOB_FAILED,
      expect.objectContaining({
        hasError: true,
        errorMessage: "Failed to fetch [url] while writing [path]",
      }),
    );
  });
});
