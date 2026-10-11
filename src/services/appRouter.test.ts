import { describe, expect, it, vi } from "vitest";
import { EventBusService } from "../events/EventBusService";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import { PipelineJobStatus } from "../pipeline/types";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { appRouter, createAppRouterContext } from "./appRouter";
import type { SystemInfo } from "./systemInfo";

describe("appRouter.removeDocs", () => {
  it("cancels a running job for the version before removing it", async () => {
    const calls: string[] = [];
    const pipeline = {
      getJobs: vi.fn(async () => [
        {
          id: "job-1",
          library: "react",
          version: "19.0",
          status: PipelineJobStatus.RUNNING,
        },
      ]),
      cancelJob: vi.fn(async () => {
        calls.push("cancel");
      }),
      waitForJobCompletion: vi.fn(async () => {
        calls.push("wait");
      }),
    } as unknown as IPipeline;
    const docService = {
      validateLibraryExists: vi.fn(async () => {}),
      removeVersion: vi.fn(async () => {
        calls.push("remove");
      }),
    } as unknown as IDocumentManagement;
    const caller = appRouter.createCaller(
      createAppRouterContext({
        pipeline,
        docService,
        eventBus: new EventBusService(),
        systemInfo: {} as SystemInfo,
      }),
    );

    const result = await caller.removeDocs({ library: "react", version: "19.0" });

    expect(calls).toEqual(["cancel", "wait", "remove"]);
    expect(docService.removeVersion).toHaveBeenCalledWith("react", "19.0");
    expect(result.message).toBe("Successfully removed react@19.0.");
  });
});
