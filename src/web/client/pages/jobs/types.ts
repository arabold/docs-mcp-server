/**
 * Shared `Job` type for the Jobs & Queue page, derived from the tRPC router's
 * actual output (rather than importing the server-side `PipelineJob` type
 * directly) so it always matches exactly what the client receives after
 * superjson deserialization (e.g. `Date` objects, not ISO strings).
 */
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../services/appRouter";

type RouterOutputs = inferRouterOutputs<AppRouter>;

/** A single pipeline job as returned by `getJobs`. */
export type Job = RouterOutputs["getJobs"]["jobs"][number];
