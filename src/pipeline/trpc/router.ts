/**
 * tRPC router exposing pipeline procedures for external workers.
 * Provides a minimal RPC surface to replace legacy REST endpoints.
 *
 * This module now exports a factory to build the router from a provided t instance,
 * allowing us to compose multiple routers under a single /api endpoint.
 */

import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import type { ScraperOptions } from "../../scraper/types";
import {
  InvalidLibraryNameError,
  LibraryAlreadyExistsError,
  LibraryNotFoundInStoreError,
  VersionAlreadyExistsError,
  VersionNotFoundInStoreError,
} from "../../store/errors";
import { EXISTING_TARGET_POLICIES } from "../../store/types";
import { PipelineJobStatus } from "../types";
import type { IPipeline } from "./interfaces";

// Context carries the pipeline instance
export interface PipelineTrpcContext {
  pipeline: IPipeline;
}

const t = initTRPC.context<PipelineTrpcContext>().create({
  transformer: superjson,
});

// Schemas
const nonEmptyTrimmed = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => s.length > 0, "must not be empty");

// Optional library version. An empty or whitespace-only string is the domain's
// representation of "unversioned" (see VersionRef), so it is coerced to
// undefined rather than rejected — callers (CLI, web UI) can pass "" for an
// unversioned library and the pipeline treats it the same as omitting it.
const optionalTrimmed = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().min(1).optional().nullable());

const enqueueScrapeInput = z.object({
  library: nonEmptyTrimmed,
  version: optionalTrimmed,
  options: z.custom<ScraperOptions>(),
  // Omitted means "reject-version"; the default is applied by the pipeline.
  onExisting: z.enum(EXISTING_TARGET_POLICIES).optional(),
});

/**
 * Maps the enqueue errors a caller can act on to tRPC codes (409, 400, 404 over
 * HTTP), keeping their messages. Anything else, including a `TRPCError` relayed
 * from a remote worker, passes through unchanged.
 */
function toEnqueueError(error: unknown): unknown {
  if (
    error instanceof LibraryAlreadyExistsError ||
    error instanceof VersionAlreadyExistsError
  ) {
    return new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
  }
  if (error instanceof InvalidLibraryNameError) {
    return new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  if (
    error instanceof LibraryNotFoundInStoreError ||
    error instanceof VersionNotFoundInStoreError
  ) {
    return new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
  }
  return error;
}

const enqueueRefreshInput = z.object({
  library: nonEmptyTrimmed,
  version: optionalTrimmed,
  options: z
    .object({
      preserveHashes: z.boolean().optional(),
    })
    .optional(),
});

const jobIdInput = z.object({ id: z.string().min(1) });

const getJobsInput = z.object({
  status: z.nativeEnum(PipelineJobStatus).optional(),
});

// Factory to create a pipeline router from any t instance whose context contains `pipeline`
export function createPipelineRouter(trpc: unknown) {
  const tt = trpc as typeof t;
  return tt.router({
    ping: tt.procedure.query(async () => ({ status: "ok", ts: Date.now() })),

    enqueueScrapeJob: tt.procedure
      .input(enqueueScrapeInput)
      .mutation(
        async ({
          ctx,
          input,
        }: {
          ctx: PipelineTrpcContext;
          input: z.infer<typeof enqueueScrapeInput>;
        }) => {
          try {
            const jobId = await ctx.pipeline.enqueueScrapeJob(
              input.library,
              input.version ?? null,
              input.options,
              { onExisting: input.onExisting },
            );
            return { jobId };
          } catch (error) {
            throw toEnqueueError(error);
          }
        },
      ),

    enqueueRefreshJob: tt.procedure
      .input(enqueueRefreshInput)
      .mutation(
        async ({
          ctx,
          input,
        }: {
          ctx: PipelineTrpcContext;
          input: z.infer<typeof enqueueRefreshInput>;
        }) => {
          try {
            const jobId = await ctx.pipeline.enqueueRefreshJob(
              input.library,
              input.version ?? null,
              input.options,
            );
            return { jobId };
          } catch (error) {
            throw toEnqueueError(error);
          }
        },
      ),

    getJob: tt.procedure
      .input(jobIdInput)
      .query(
        async ({
          ctx,
          input,
        }: {
          ctx: PipelineTrpcContext;
          input: z.infer<typeof jobIdInput>;
        }) => {
          return ctx.pipeline.getJob(input.id);
        },
      ),

    getJobs: tt.procedure
      .input(getJobsInput.optional())
      .query(
        async ({
          ctx,
          input,
        }: {
          ctx: PipelineTrpcContext;
          input: z.infer<typeof getJobsInput> | undefined;
        }) => {
          const jobs = await ctx.pipeline.getJobs(input?.status);
          return { jobs };
        },
      ),

    cancelJob: tt.procedure
      .input(jobIdInput)
      .mutation(
        async ({
          ctx,
          input,
        }: {
          ctx: PipelineTrpcContext;
          input: z.infer<typeof jobIdInput>;
        }) => {
          await ctx.pipeline.cancelJob(input.id);
          return { success: true } as const;
        },
      ),

    clearCompletedJobs: tt.procedure.mutation(
      async ({ ctx }: { ctx: PipelineTrpcContext }) => {
        const count = await ctx.pipeline.clearCompletedJobs();
        return { count };
      },
    ),
  });
}

// Default router for standalone usage (keeps existing imports working)
export const pipelineRouter = createPipelineRouter(t);

export type PipelineRouter = typeof pipelineRouter;
