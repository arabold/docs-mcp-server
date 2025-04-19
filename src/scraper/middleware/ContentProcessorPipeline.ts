import { logger } from "../../utils/logger";
import type { ContentProcessingContext, ContentProcessorMiddleware } from "./types";

/**
 * Manages and executes a sequence of content processing middleware.
 */
export class ContentProcessingPipeline {
  private readonly middleware: ContentProcessorMiddleware[];

  /**
   * Creates an instance of ContentProcessingPipeline.
   * @param middleware An array of middleware instances to execute in order.
   */
  constructor(middleware: ContentProcessorMiddleware[]) {
    this.middleware = middleware;
  }

  /**
   * Executes the middleware pipeline with the given initial context.
   * @param initialContext The starting context for the pipeline.
   * @returns A promise that resolves with the final context after all middleware have executed.
   */
  async run(initialContext: ContentProcessingContext): Promise<ContentProcessingContext> {
    let index = -1;

    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) {
        // next() called multiple times within the same middleware
        throw new Error("next() called multiple times");
      }
      index = i;

      const mw: ContentProcessorMiddleware | undefined = this.middleware[i];
      if (!mw) {
        // End of the pipeline
        return;
      }

      // Bind the next function to the subsequent index
      const next = dispatch.bind(null, i + 1);

      try {
        await mw.process(initialContext, next);
      } catch (error) {
        // Add error to context and potentially stop pipeline or continue
        initialContext.errors.push(
          error instanceof Error ? error : new Error(String(error)),
        );
        // Depending on desired behavior, you might re-throw or just log
        logger.warn(`Error in middleware pipeline: ${error}`);
        // Decide if pipeline should stop on error. For now, let's continue.
        // If stopping is desired, uncomment the next line:
        // throw error;
      }
    };

    // Start the dispatch chain from the first middleware (index 0)
    await dispatch(0);

    // Return the final context after the chain completes
    return initialContext;
  }
}
