import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBusService } from "../../events/EventBusService";
import type { ScraperOptions } from "../../scraper/types";
import { DocumentManagementService } from "../../store/DocumentManagementService";
import {
  InvalidLibraryNameError,
  LibraryAlreadyExistsError,
  LibraryNotFoundInStoreError,
  VersionAlreadyExistsError,
  VersionNotFoundInStoreError,
} from "../../store/errors";
import { MAX_LIBRARY_NAME_LENGTH, VersionStatus } from "../../store/types";
import { loadConfig } from "../../utils/config";
import { PipelineManager } from "../PipelineManager";
import type { IPipeline } from "./interfaces";
import { pipelineRouter } from "./router";

const OPTIONS: ScraperOptions = { url: "https://x.dev", library: "x", version: "" };

describe("pipelineRouter", () => {
  let store: DocumentManagementService;
  let manager: PipelineManager;
  let caller: ReturnType<typeof pipelineRouter.createCaller>;

  beforeEach(async () => {
    const appConfig = loadConfig();
    appConfig.app.storePath = ":memory:";
    appConfig.app.embeddingModel = "";
    const eventBus = new EventBusService();
    store = new DocumentManagementService(eventBus, appConfig);
    await store.initialize();
    // Never started, so an enqueued job stays queued and nothing is scraped.
    manager = new PipelineManager(store, eventBus, {
      interruptedJobs: "fail",
      appConfig,
    });
    caller = pipelineRouter.createCaller({ pipeline: manager });
  });

  afterEach(async () => {
    await manager.stop();
    await store.shutdown();
  });

  /** Seeds a completed version with one page and the options it was scraped with. */
  async function seedVersion(library: string, version: string): Promise<void> {
    const versionId = await store.ensureVersion({ library, version });
    await store.addEmptyPage(library, version, 0, {
      url: `https://x.dev/${library}`,
      title: library,
      sourceContentType: "text/html",
      contentType: "text/html",
      etag: null,
      lastModified: null,
    });
    await store.storeScraperOptions(versionId, { ...OPTIONS, library, version });
    await store.updateVersionStatus(versionId, VersionStatus.COMPLETED);
  }

  /** Checks that `error` is a tRPC error carrying `expected` and its cause's message. */
  function expectEnqueueError(error: unknown, label: string, expected: object): void {
    expect.soft(error, label).toBeInstanceOf(TRPCError);
    expect.soft(error, label).toMatchObject(expected);
    if (error instanceof TRPCError && error.cause) {
      expect.soft(error.message, label).toBe(error.cause.message);
    }
  }

  // Regression: an empty `version` is the domain's "unversioned" marker, so the
  // router must accept it rather than reject it with a Zod `too_small` error,
  // the bug that broke "Refresh" for unversioned libraries.
  it("accepts an empty-string version for enqueueRefreshJob, treated as unversioned (null)", async () => {
    await seedVersion("pydantic", "");

    const { jobId } = await caller.enqueueRefreshJob({
      library: "pydantic",
      version: "",
    });

    expect((await manager.getJob(jobId))?.version).toBeNull();
  });

  it("forwards onExisting, and leaves it undefined when omitted so the pipeline default applies", async () => {
    await seedVersion("x", "");

    // The default refuses an existing version.
    await expect(
      caller.enqueueScrapeJob({ library: "x", options: OPTIONS }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      caller.enqueueScrapeJob({ library: "x", options: OPTIONS, onExisting: "replace" }),
    ).resolves.toHaveProperty("jobId");
  });

  it("maps a scrape rejection to its error code with the original message", async () => {
    await seedVersion("React", "19.0.0");
    const relaying = {
      enqueueScrapeJob: async () => {
        throw new TRPCError({ code: "CONFLICT", message: "relayed conflict" });
      },
    } as unknown as IPipeline;
    const cases = [
      {
        label: "an existing version",
        input: { library: "react", version: "19.0.0", options: OPTIONS },
        expected: { code: "CONFLICT", cause: expect.any(VersionAlreadyExistsError) },
      },
      {
        label: "an existing library the caller refuses",
        input: {
          library: "React",
          version: "20.0.0",
          options: OPTIONS,
          onExisting: "reject-library" as const,
        },
        expected: { code: "CONFLICT", cause: expect.any(LibraryAlreadyExistsError) },
      },
      {
        label: "an invalid library name",
        input: { library: "x".repeat(MAX_LIBRARY_NAME_LENGTH + 1), options: OPTIONS },
        expected: { code: "BAD_REQUEST", cause: expect.any(InvalidLibraryNameError) },
      },
      {
        // A remote worker's router already chose the code, so it passes unchanged.
        label: "a TRPCError relayed from a remote worker",
        pipeline: relaying,
        input: { library: "x", options: OPTIONS },
        expected: { code: "CONFLICT", message: "relayed conflict" },
      },
    ];

    for (const { label, pipeline, input, expected } of cases) {
      const via = pipeline ? pipelineRouter.createCaller({ pipeline }) : caller;
      const error = await via.enqueueScrapeJob(input).catch((caught: unknown) => caught);
      expectEnqueueError(error, label, expected);
    }
  });

  it("maps a refresh of an unknown library or version to NOT_FOUND with the original message", async () => {
    await seedVersion("React", "18.0.0");
    const cases = [
      {
        label: "an unknown library",
        input: { library: "Reakt" },
        cause: LibraryNotFoundInStoreError,
      },
      {
        label: "an unknown version",
        input: { library: "React", version: "99.0.0" },
        cause: VersionNotFoundInStoreError,
      },
    ];

    for (const { label, input, cause } of cases) {
      const error = await caller
        .enqueueRefreshJob(input)
        .catch((caught: unknown) => caught);
      expectEnqueueError(error, label, { code: "NOT_FOUND", cause: expect.any(cause) });
    }
  });
});
