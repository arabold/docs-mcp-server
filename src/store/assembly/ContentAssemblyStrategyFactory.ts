import { HierarchicalAssemblyStrategy } from "./strategies/HierarchicalAssemblyStrategy";
import { MarkdownAssemblyStrategy } from "./strategies/MarkdownAssemblyStrategy";
import type { ContentAssemblyStrategy } from "./types";

/**
 * Creates the appropriate assembly strategy based on content MIME type.
 *
 * @param mimeType The MIME type of the content (optional)
 * @param options Configuration options for the strategy
 * @returns The appropriate strategy instance
 */
export function createContentAssemblyStrategy(
  mimeType?: string,
): ContentAssemblyStrategy {
  // Default to MarkdownAssemblyStrategy for unknown or missing MIME types
  if (!mimeType) {
    return new MarkdownAssemblyStrategy();
  }

  // Try each strategy to see which one can handle the content type
  const strategies = [new HierarchicalAssemblyStrategy(), new MarkdownAssemblyStrategy()];

  for (const strategy of strategies) {
    if (strategy.canHandle(mimeType)) {
      return strategy;
    }
  }

  // Default fallback to MarkdownAssemblyStrategy
  return new MarkdownAssemblyStrategy();
}

/**
 * Gets a human-readable name for the strategy that would be selected.
 * Useful for logging and debugging.
 */
export function getStrategyName(mimeType?: string): string {
  if (!mimeType) {
    return "MarkdownAssemblyStrategy (default)";
  }

  const hierarchicalStrategy = new HierarchicalAssemblyStrategy();
  if (hierarchicalStrategy.canHandle(mimeType)) {
    return "HierarchicalAssemblyStrategy";
  }

  return "MarkdownAssemblyStrategy";
}
