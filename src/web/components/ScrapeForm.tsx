import type { AppConfig } from "../../utils/config";
import ScrapeFormContent from "./ScrapeFormContent";

interface ScrapeFormProps {
  defaultExcludePatterns?: string[];
  scraperConfig?: AppConfig["scraper"];
}

/**
 * Wrapper component for the ScrapeFormContent.
 * Provides a container div, often used as a target for HTMX OOB swaps.
 */
const ScrapeForm = ({
  defaultExcludePatterns,
  scraperConfig,
}: ScrapeFormProps) => (
  <div id="scrape-form-container" class="animate-[fadeSlideIn_0.2s_ease-out]">
    <ScrapeFormContent
      defaultExcludePatterns={defaultExcludePatterns}
      scraperConfig={scraperConfig}
    />
  </div>
);

export default ScrapeForm;
