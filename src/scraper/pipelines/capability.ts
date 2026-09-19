import type { ContentPipeline } from "./types";

/**
 * Answers whether the configured content pipelines can process a given MIME type.
 */
export type MimeTypeCapabilityPredicate = (mimeType: string) => boolean;

/**
 * Builds the single predicate used to decide whether content is worth fetching.
 *
 * The answer is derived from the pipelines themselves rather than from a list, so
 * support for a format is declared in exactly one place: the relevant pipeline's
 * `canProcess()`. Adding a pipeline widens every crawl gate automatically, and no
 * gate may hardcode extensions or MIME strings of its own.
 *
 * The predicate is evaluated without content, which makes it at least as permissive
 * as the pipeline-selection loop that later runs with content available. A resource
 * the predicate accepts may still be refused by a pipeline; a resource it rejects
 * would not have been accepted by any.
 *
 * @param pipelines The pipeline set whose capabilities define processability.
 * @returns A predicate that reports whether some pipeline claims the MIME type.
 */
export function createMimeTypeCapabilityPredicate(
  pipelines: ContentPipeline[],
): MimeTypeCapabilityPredicate {
  return (mimeType: string): boolean =>
    pipelines.some((pipeline) => pipeline.canProcess(mimeType));
}
