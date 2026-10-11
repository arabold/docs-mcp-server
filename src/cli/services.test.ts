import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBusService } from "../events/EventBusService";
import { EventType } from "../events/types";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import { type PipelineJob, PipelineJobStatus } from "../pipeline/types";
import type { Backend } from "../services/backend";
import { TelemetryService } from "../telemetry";
import { telemetry } from "../telemetry/telemetry";
import {
  registerGlobalServices,
  setActiveBackend,
  setActiveTelemetryService,
} from "./services";

vi.mock("../telemetry/telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../telemetry/telemetry")>()),
  telemetry: { track: vi.fn(), isEnabled: vi.fn(() => true) },
}));

const runningJob = {
  id: "job-1",
  library: "react",
  version: null,
  status: PipelineJobStatus.RUNNING,
  createdAt: new Date(),
  startedAt: new Date(),
} as unknown as PipelineJob;

describe("registerGlobalServices", () => {
  afterEach(() => {
    setActiveBackend(null);
    setActiveTelemetryService(null);
    vi.clearAllMocks();
  });

  /** Registers a telemetry service and a backend, emits a job event, and says whether it was reported. */
  function reportsJobEvents(
    backend: Pick<Backend, "mode" | "pipeline">,
    order: "telemetry first" | "backend first" = "telemetry first",
  ): boolean {
    const eventBus = new EventBusService();
    const telemetryService = new TelemetryService(eventBus);
    const asBackend = { ...backend, eventBus } as unknown as Backend;
    if (order === "telemetry first") {
      registerGlobalServices({ telemetryService });
      registerGlobalServices({ backend: asBackend });
    } else {
      registerGlobalServices({ backend: asBackend });
      registerGlobalServices({ telemetryService });
    }

    eventBus.emit(EventType.JOB_STATUS_CHANGE, runningJob);
    return vi.mocked(telemetry.track).mock.calls.length > 0;
  }

  it("reports the jobs of a local pipeline", () => {
    expect(reportsJobEvents({ mode: "local", pipeline: {} as IPipeline })).toBe(true);
  });

  it.each(["telemetry first", "backend first"] as const)(
    "leaves a remote worker's relayed jobs to the worker (%s)",
    (order) => {
      expect(reportsJobEvents({ mode: "remote", pipeline: {} as IPipeline }, order)).toBe(
        false,
      );
    },
  );
});
