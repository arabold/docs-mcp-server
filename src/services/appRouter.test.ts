import { describe, expect, it, vi } from "vitest";
import { EventBusService } from "../events/EventBusService";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { appRouter, createAppRouterContext } from "./appRouter";
import type { SystemInfo } from "./systemInfo";

describe("appRouter.removeDocs", () => {
  it("removes through the request's pipeline, which cancels the version's job first", async () => {
    const pipeline = { removeVersion: vi.fn(async () => {}) } as unknown as IPipeline;
    const docService = {
      validateLibraryExists: vi.fn(async () => {}),
      removeVersion: vi.fn(async () => {}),
    } as unknown as IDocumentManagement;
    const caller = appRouter.createCaller(
      createAppRouterContext({
        pipeline,
        docService,
        eventBus: new EventBusService(),
        systemInfo: {} as SystemInfo,
      }),
    );

    const result = await caller.removeDocs({ library: "react", version: " 19.0 " });

    expect(pipeline.removeVersion).toHaveBeenCalledWith("react", "19.0");
    expect(docService.removeVersion).not.toHaveBeenCalled();
    expect(result.message).toBe("Successfully removed react@19.0.");
  });
});
