import type { ContentFetcher, RawContent } from "../fetcher/types";
import type { ContentProcessorMiddleware, MiddlewareContext } from "../middleware/types";
import type { ScraperOptions } from "../types";
import type { ContentPipeline, ProcessedContent } from "./types";

/**
 * Base class for content processing pipelines.
 * Provides common functionality for executing middleware stacks.
 */
export class BasePipeline implements ContentPipeline {
  /**
   * Determines if this pipeline can process the given content.
   * Must be implemented by derived classes.
   */
  public canProcess(_rawContent: RawContent): boolean {
    throw new Error("Method not implemented.");
  }

  /**
   * Processes the raw content through the pipeline.
   * Must be implemented by derived classes.
   */
  public async process(
    _rawContent: RawContent,
    _options: ScraperOptions,
    _fetcher?: ContentFetcher,
  ): Promise<ProcessedContent> {
    throw new Error("Method not implemented.");
  }

  /**
   * Cleanup resources used by this pipeline.
   * Default implementation does nothing - override in derived classes as needed.
   */
  public async close(): Promise<void> {
    // No-op by default
  }

  /**
   * Executes a middleware stack on the given context.
   * This is a utility method used by derived pipeline classes.
   *
   * @param middleware - The middleware stack to execute
   * @param context - The context to process
   */
  protected async executeMiddlewareStack(
    middleware: ContentProcessorMiddleware[],
    context: MiddlewareContext,
  ): Promise<void> {
    let index = -1;
    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) throw new Error("next() called multiple times");
      index = i;
      const mw = middleware[i];
      if (!mw) return;
      await mw.process(context, dispatch.bind(null, i + 1));
    };

    try {
      await dispatch(0);
    } catch (error) {
      context.errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
