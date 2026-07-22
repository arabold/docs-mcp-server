/**
 * Renders a Markdown string as React content with GitHub-Flavored Markdown
 * (tables, strikethrough, task lists) and fenced code blocks. The document
 * store returns search results and stored chunks as Markdown, so this is the
 * canonical way to display that content across the dashboard (search results,
 * chunk explorer).
 *
 * Output is wrapped in `.md` so it inherits the mockup's prose styling
 * (headings, inline code, code blocks, lists) from `../styles/components.css`.
 *
 * Raw/embedded HTML is intentionally NOT rendered (no `rehype-raw`), so scraped
 * documentation content cannot inject markup — the renderer is safe by
 * construction.
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface MarkdownProps {
  /** The Markdown source to render. */
  children: string;
  /** Optional extra class names applied to the `.md` wrapper. */
  className?: string;
}

/**
 * @example <Markdown>{result.content}</Markdown>
 */
export function Markdown({ children, className }: MarkdownProps) {
  const classes = className ? `md ${className}` : "md";
  return (
    <div className={classes}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
