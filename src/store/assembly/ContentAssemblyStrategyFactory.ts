import type { AppConfig } from "../../utils/config";
import { HierarchicalAssemblyStrategy } from "./strategies/HierarchicalAssemblyStrategy";
import { MarkdownAssemblyStrategy } from "./strategies/MarkdownAssemblyStrategy";
import type { ContentAssemblyStrategy } from "./types";

/**
 * Creates the appropriate assembly strategy based on content MIME type.
 *
 * @param mimeType The MIME type of the content (optional)
 * @param config Application configuration
 * @returns The appropriate strategy instance
 */
export function createContentAssemblyStrategy(
  mimeType: string | null | undefined,
  config: AppConfig,
): ContentAssemblyStrategy {
  // Default to MarkdownAssemblyStrategy for unknown or missing MIME types
  if (!mimeType) {
    return new MarkdownAssemblyStrategy(config); // Markdown strategy doesn't need config currently
  }

  // Try each strategy to see which one can handle the content type
  const strategies = [
    new HierarchicalAssemblyStrategy(config),
    new MarkdownAssemblyStrategy(config),
  ];

  for (const strategy of strategies) {
    if (strategy.canHandle(mimeType)) {
      return strategy;
    }
  }

  // Default fallback to MarkdownAssemblyStrategy
  return new MarkdownAssemblyStrategy(config);
}
