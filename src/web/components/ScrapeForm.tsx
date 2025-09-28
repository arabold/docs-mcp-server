import ScrapeFormContent from "./ScrapeFormContent";

interface ScrapeFormProps {
  defaultExcludePatterns?: string[];
}

/**
 * Wrapper component for the ScrapeFormContent.
 * Provides a container div, often used as a target for HTMX OOB swaps.
 */
const ScrapeForm = ({ defaultExcludePatterns }: ScrapeFormProps) => (
  <div id="scrape-form-container">
    <ScrapeFormContent defaultExcludePatterns={defaultExcludePatterns} />
  </div>
);

export default ScrapeForm;
