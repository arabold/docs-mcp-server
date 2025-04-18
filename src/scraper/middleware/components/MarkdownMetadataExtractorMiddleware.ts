import type { ContentProcessingContext, ContentProcessorMiddleware } from "../types";

/**
 * Middleware to extract the title (first H1 heading) from Markdown content.
 */
export class MarkdownMetadataExtractorMiddleware implements ContentProcessorMiddleware {
  /**
   * Processes the context to extract the title from Markdown.
   * @param context The current processing context.
   * @param next Function to call the next middleware.
   */
  async process(
    context: ContentProcessingContext,
    next: () => Promise<void>,
  ): Promise<void> {
    // Process both markdown and plain text for title extraction (or default)
    if (context.contentType === "text/markdown" || context.contentType === "text/plain") {
      try {
        // Ensure content is a string
        const textContent =
          typeof context.content === "string"
            ? context.content
            : Buffer.from(context.content).toString("utf-8"); // Assume utf-8 if buffer
        // Update context content to string if it was a buffer
        if (typeof context.content !== "string") {
          context.content = textContent;
        }

        let title = "Untitled"; // Default title
        // Only look for H1 if it's actually markdown
        if (context.contentType === "text/markdown") {
          const match = textContent.match(/^#\s+(.*)$/m);
          if (match?.[1]) {
            title = match[1].trim();
          }
        }
        // Set title (either extracted H1 or the default "Untitled")
        context.metadata.title = title;
      } catch (error) {
        context.errors.push(
          new Error(
            `Failed to extract metadata from Markdown: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        // Decide if pipeline should stop
      }
    }

    // Call the next middleware in the chain
    await next();

    // No cleanup needed
  }
}
