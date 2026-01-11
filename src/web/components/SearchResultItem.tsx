import { unified } from "unified"; // Import unified
import remarkParse from "remark-parse"; // Import unified plugins
import remarkGfm from "remark-gfm";
import remarkHtml from "remark-html";
import DOMPurify from "dompurify"; // Import DOMPurify
import type { StoreSearchResult } from "../../store/types";
import { createJSDOM } from "../../utils/dom"; // Import JSDOM helper
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import { escapeHtml } from "@kitajs/html";

/**
 * Props for the SearchResultItem component.
 */
interface SearchResultItemProps {
  result: StoreSearchResult;
}

/**
 * Renders a single search result item.
 * Converts markdown content to HTML using unified for markdown MIME types.
 * For other content types, renders as preformatted text.
 * @param props - Component props including the search result data.
 */
const SearchResultItem = async ({ result }: SearchResultItemProps) => {
  const isMarkdown = result.mimeType
    ? MimeTypeUtils.isMarkdown(result.mimeType) ||
      MimeTypeUtils.isSupportedDocument(result.mimeType)
    : true; // Default to true if mimeType is undefined (backward compatibility)

  // Create JSDOM instance and initialize DOMPurify (used for both markdown and non-markdown content)
  const jsdom = createJSDOM("");
  const purifier = DOMPurify(jsdom.window);

  let contentElement: JSX.Element;

  if (isMarkdown) {
    // Use unified pipeline to convert markdown to HTML
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkHtml);
    const file = await processor.process(result.content);
    const rawHtml = String(file);

    // Sanitize the HTML content
    const safeHtml = purifier.sanitize(rawHtml);
    contentElement = (
      <div class="format dark:format-invert max-w-none">{safeHtml}</div>
    );
  } else {
    // For non-markdown content, sanitize and render as preformatted text
    const safeContent = escapeHtml(result.content);
    contentElement = (
      <div class="format dark:format-invert max-w-none">
        <pre>
          <code>{safeContent}</code>
        </pre>
      </div>
    );
  }

  return (
    <div class="block px-4 py-2 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-300 dark:border-gray-600 mb-2">
      <div class="text-sm text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-2">
        <a
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          class="underline underline-offset-4 flex-1"
          safe
        >
          {result.url}
        </a>
        {result.mimeType ? (
          <span class="text-xs opacity-75 font-mono" safe>
            {result.mimeType}
          </span>
        ) : null}
      </div>
      {/* Render the content based on MIME type */}
      {contentElement}
    </div>
  );
};

export default SearchResultItem;
