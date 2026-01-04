import type { AppConfig } from "../../utils/config";
import { ScrapeMode } from "../../scraper/types";
import Alert from "./Alert";
import Tooltip from "./Tooltip";

/**
 * Initial values for pre-filling the scrape form.
 * Used when adding a new version to an existing library.
 */
export interface ScrapeFormInitialValues {
  library?: string;
  url?: string;
  maxPages?: number;
  maxDepth?: number;
  scope?: string;
  includePatterns?: string;
  excludePatterns?: string;
  scrapeMode?: string;
  headers?: Array<{ name: string; value: string }>;
  followRedirects?: boolean;
  ignoreErrors?: boolean;
}

interface ScrapeFormContentProps {
  defaultExcludePatterns?: string[];
  /** Initial values for pre-filling the form (used in add-version mode) */
  initialValues?: ScrapeFormInitialValues;
  /** Mode of the form: 'new' for new library, 'add-version' for adding version to existing library */
  mode?: "new" | "add-version";
  /** Application configuration for scraper defaults */
  scraperConfig?: AppConfig["scraper"];
}

/**
 * Renders the form fields for queuing a new scrape job.
 * Includes basic fields (URL, Library, Version) and advanced options.
 * Supports pre-filling values when adding a new version to an existing library.
 */
const ScrapeFormContent = ({
  defaultExcludePatterns,
  initialValues,
  mode = "new",
  scraperConfig,
}: ScrapeFormContentProps) => {
  const isAddVersionMode = mode === "add-version";

  // Use initial values or defaults
  const urlValue = initialValues?.url || "";
  const libraryValue = initialValues?.library || "";
  const maxPagesValue = initialValues?.maxPages?.toString() || "";
  const maxDepthValue = initialValues?.maxDepth?.toString() || "";
  const scopeValue = initialValues?.scope || "subpages";
  const includePatternsValue = initialValues?.includePatterns || "";
  const scrapeModeValue = initialValues?.scrapeMode || ScrapeMode.Auto;
  const followRedirectsValue = initialValues?.followRedirects ?? true;
  const ignoreErrorsValue = initialValues?.ignoreErrors ?? true;

  // Format exclude patterns - use initial values if provided, otherwise use defaults
  const excludePatternsText =
    initialValues?.excludePatterns !== undefined
      ? initialValues.excludePatterns
      : defaultExcludePatterns?.join("\n") || "";

  // Serialize headers for Alpine.js initialization
  const headersJson = JSON.stringify(initialValues?.headers || []);

  // Determine the close button action based on mode
  const closeButtonAttrs = isAddVersionMode
    ? {
        "hx-get": `/web/libraries/${encodeURIComponent(libraryValue)}/add-version-button`,
        "hx-target": "#add-version-form-container",
        "hx-swap": "innerHTML",
      }
    : {
        "hx-get": "/web/jobs/new-button",
        "hx-target": "#addJobForm",
        "hx-swap": "innerHTML",
      };

  // Determine the form target based on mode
  const formTarget = isAddVersionMode
    ? "#add-version-form-container"
    : "#addJobForm";

  const title = isAddVersionMode ? "Add New Version" : "Add New Documentation";

  return (
    <div class="mt-4 p-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-300 dark:border-gray-600 relative animate-[fadeSlideIn_0.2s_ease-out]">
      {/* Close button */}
      <button
        type="button"
        {...closeButtonAttrs}
        class="absolute top-3 right-3 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-150"
        title="Close"
      >
        <svg
          class="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
      <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2 pr-8">
        {title}
      </h3>
      <form
        hx-post="/web/jobs/scrape"
        hx-target={formTarget}
        hx-swap="innerHTML"
        class="space-y-2"
        data-initial-url={urlValue}
        data-initial-headers={headersJson}
        x-data="{
          url: '',
          hasPath: false,
          headers: [],
          checkUrlPath() {
            try {
              const url = new URL(this.url);
              this.hasPath = url.pathname !== '/' && url.pathname !== '';
            } catch (e) {
              this.hasPath = false;
            }
          }
        }"
        x-init="
          url = $el.dataset.initialUrl || '';
          headers = JSON.parse($el.dataset.initialHeaders || '[]');
          checkUrlPath();
        "
      >
        {/* Hidden field to tell backend which button to return on success */}
        <input type="hidden" name="formMode" value={mode} />
        <div>
          <div class="flex items-center">
            <label
              for="url"
              class="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              URL
            </label>
            <Tooltip
              text={
                <div>
                  <p>Enter the URL of the documentation you want to scrape.</p>
                  <p class="mt-2">
                    For local files/folders, you must use the{" "}
                    <code>file://</code> prefix and ensure the path is
                    accessible to the server.
                  </p>
                  <p class="mt-2">
                    If running in Docker, <b>mount the folder</b> (see README
                    for details).
                  </p>
                </div>
              }
            />
          </div>
          <input
            type="url"
            name="url"
            id="url"
            required
            x-model="url"
            x-on:input="checkUrlPath"
            x-on:paste="$nextTick(() => checkUrlPath())"
            placeholder="https://docs.example.com/library/"
            class="mt-0.5 block w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
          <div
            x-show="hasPath && !(url.startsWith('file://'))"
            x-cloak
            x-transition:enter="transition ease-out duration-300"
            x-transition:enter-start="opacity-0 transform -translate-y-2"
            x-transition:enter-end="opacity-100 transform translate-y-0"
            class="mt-2"
          >
            <Alert
              type="info"
              message="By default, only subpages under the given URL will be scraped. To scrape the whole website, adjust the 'Scope' option in Advanced Options."
            />
          </div>
        </div>
        <div>
          <div class="flex items-center">
            <label
              for="library"
              class="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Library Name
            </label>
            <Tooltip text="The name of the library you're documenting. This will be used when searching." />
          </div>
          {isAddVersionMode ? (
            <>
              <input type="hidden" name="library" value={libraryValue} />
              <div class="mt-0.5 px-2 py-1 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md border border-gray-300 dark:border-gray-600">
                <span safe>{libraryValue}</span>
              </div>
            </>
          ) : (
            <input
              type="text"
              name="library"
              id="library"
              required
              value={libraryValue}
              placeholder="e.g. react, vue, express"
              class="mt-0.5 block w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          )}
        </div>
        <div>
          <div class="flex items-center">
            <label
              for="version"
              class="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Version (optional)
            </label>
            <Tooltip text="Specify the version of the library documentation you're indexing (e.g. 2.0.0). Leave empty or enter 'latest' to index without a specific version. This allows for version-specific searches." />
          </div>
          <input
            type="text"
            name="version"
            id="version"
            placeholder="e.g. 2.0.0 or leave empty for latest"
            class="mt-0.5 block w-full max-w-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>

        {/* Advanced Options with slide animation */}
        <div
          class="bg-gray-50 dark:bg-gray-900 p-2 rounded-md"
          data-should-open={
            isAddVersionMode &&
            (maxPagesValue ||
              maxDepthValue ||
              scopeValue !== "subpages" ||
              includePatternsValue ||
              excludePatternsText ||
              scrapeModeValue !== ScrapeMode.Auto)
              ? "true"
              : "false"
          }
          x-data="{ open: false }"
          x-init="open = $el.dataset.shouldOpen === 'true'"
        >
          <button
            type="button"
            class="w-full flex items-center gap-1.5 cursor-pointer text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
            x-on:click="open = !open"
          >
            <svg
              class="w-4 h-4 transform transition-transform duration-200"
              x-bind:class="{ 'rotate-90': open }"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 5l7 7-7 7"
              />
            </svg>
            <span>Advanced Options</span>
          </button>
          <div x-show="open" x-cloak x-collapse class="mt-2 space-y-2">
            <div>
              <div class="flex items-center">
                <label
                  for="maxPages"
                  class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Max Pages
                </label>
                <Tooltip
                  text={`The maximum number of pages to scrape. Default is ${scraperConfig?.maxPages ?? 1000}. Setting this too high may result in longer processing times.`}
                />
              </div>
              <input
                type="number"
                name="maxPages"
                id="maxPages"
                min="1"
                placeholder={scraperConfig?.maxPages?.toString() || "1000"}
                value={maxPagesValue}
                class="mt-0.5 block w-full max-w-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <div class="flex items-center">
                <label
                  for="maxDepth"
                  class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Max Depth
                </label>
                <Tooltip
                  text={`How many links deep the scraper should follow. Default is ${scraperConfig?.maxDepth || 3}. Higher values capture more content but increase processing time.`}
                />
              </div>
              <input
                type="number"
                name="maxDepth"
                id="maxDepth"
                min="0"
                placeholder={scraperConfig?.maxDepth?.toString() || "3"}
                value={maxDepthValue}
                class="mt-0.5 block w-full max-w-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <div class="flex items-center">
                <label
                  for="scope"
                  class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Scope
                </label>
                <Tooltip
                  text={
                    <div>
                      Controls which pages are scraped:
                      <ul class="list-disc pl-5">
                        <li>
                          'Subpages' only scrapes under the given URL path,
                        </li>
                        <li>
                          'Hostname' scrapes all content on the same host (e.g.,
                          all of docs.example.com),
                        </li>
                        <li>
                          'Domain' scrapes all content on the domain and its
                          subdomains (e.g., all of example.com).
                        </li>
                      </ul>
                    </div>
                  }
                />
              </div>
              <select
                name="scope"
                id="scope"
                class="mt-0.5 block w-full max-w-sm pl-2 pr-10 py-1 text-base border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="subpages" selected={scopeValue === "subpages"}>
                  Subpages (Default)
                </option>
                <option value="hostname" selected={scopeValue === "hostname"}>
                  Hostname
                </option>
                <option value="domain" selected={scopeValue === "domain"}>
                  Domain
                </option>
              </select>
            </div>
            <div>
              <div class="flex items-center">
                <label
                  for="includePatterns"
                  class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Include Patterns
                </label>
                <Tooltip text="Glob or regex patterns for URLs to include. One per line or comma-separated. Regex patterns must be wrapped in slashes, e.g. /pattern/." />
              </div>
              <textarea
                name="includePatterns"
                id="includePatterns"
                rows="2"
                placeholder="e.g. docs/* or /api\/v1.*/"
                class="mt-0.5 block w-full max-w-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                safe
              >
                {includePatternsValue}
              </textarea>
            </div>
            <div>
              <div class="flex items-center">
                <label
                  for="excludePatterns"
                  class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Exclude Patterns
                </label>
                <Tooltip text="Glob or regex patterns for URLs to exclude. One per line or comma-separated. Exclude takes precedence over include. Regex patterns must be wrapped in slashes, e.g. /pattern/. Edit or clear this field to customize exclusions." />
              </div>
              <textarea
                name="excludePatterns"
                id="excludePatterns"
                rows="5"
                safe
                class="mt-0.5 block w-full max-w-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-xs"
              >
                {excludePatternsText}
              </textarea>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {isAddVersionMode
                  ? "Patterns from previous version. Edit as needed."
                  : "Default patterns are pre-filled. Edit to customize or clear to exclude nothing."}
              </p>
            </div>
            <div>
              <div class="flex items-center">
                <label
                  for="scrapeMode"
                  class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Scrape Mode
                </label>
                <Tooltip
                  text={
                    <div>
                      <ul class="list-disc pl-5">
                        <li>'Auto' automatically selects the best method,</li>
                        <li>
                          'Fetch' uses simple HTTP requests (faster but may miss
                          dynamic content),
                        </li>
                        <li>
                          'Playwright' uses a headless browser (slower but
                          better for JS-heavy sites).
                        </li>
                      </ul>
                    </div>
                  }
                />
              </div>
              <select
                name="scrapeMode"
                id="scrapeMode"
                class="mt-0.5 block w-full max-w-sm pl-2 pr-10 py-1 text-base border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option
                  value={ScrapeMode.Auto}
                  selected={scrapeModeValue === ScrapeMode.Auto}
                >
                  Auto (Default)
                </option>
                <option
                  value={ScrapeMode.Fetch}
                  selected={scrapeModeValue === ScrapeMode.Fetch}
                >
                  Fetch
                </option>
                <option
                  value={ScrapeMode.Playwright}
                  selected={scrapeModeValue === ScrapeMode.Playwright}
                >
                  Playwright
                </option>
              </select>
            </div>
            <div>
              <div class="flex items-center mb-1">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Custom HTTP Headers
                </label>
                <Tooltip text="Add custom HTTP headers (e.g., for authentication). These will be sent with every HTTP request." />
              </div>
              <div>
                {/* AlpineJS dynamic header rows */}
                <template x-for="(header, idx) in headers">
                  <div class="flex space-x-2 mb-1">
                    <input
                      type="text"
                      class="w-1/3 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs"
                      placeholder="Header Name"
                      x-model="header.name"
                      required
                    />
                    <span class="text-gray-500">:</span>
                    <input
                      type="text"
                      class="w-1/2 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs"
                      placeholder="Header Value"
                      x-model="header.value"
                      required
                    />
                    <button
                      type="button"
                      class="text-red-500 hover:text-red-700 text-xs"
                      x-on:click="headers.splice(idx, 1)"
                    >
                      Remove
                    </button>
                    <input
                      type="hidden"
                      name="header[]"
                      x-bind:value="header.name && header.value ? header.name + ':' + header.value : ''"
                    />
                  </div>
                </template>
                <button
                  type="button"
                  class="mt-1 px-2 py-0.5 bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-200 rounded text-xs"
                  x-on:click="headers.push({ name: '', value: '' })"
                >
                  + Add Header
                </button>
              </div>
            </div>
            <div class="flex items-center">
              <input
                id="followRedirects"
                name="followRedirects"
                type="checkbox"
                checked={followRedirectsValue}
                class="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
              />
              <label
                for="followRedirects"
                class="ml-1 block text-sm text-gray-900 dark:text-gray-300"
              >
                Follow Redirects
              </label>
            </div>
            <div class="flex items-center">
              <input
                id="ignoreErrors"
                name="ignoreErrors"
                type="checkbox"
                checked={ignoreErrorsValue}
                class="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
              />
              <label
                for="ignoreErrors"
                class="ml-1 block text-sm text-gray-900 dark:text-gray-300"
              >
                Ignore Errors During Scraping
              </label>
            </div>
          </div>
        </div>

        <div>
          <button
            type="submit"
            class="w-full flex justify-center py-1.5 px-3 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
            Start Indexing
          </button>
        </div>
      </form>
      {/* Target div for HTMX response - now only used for success messages */}
      <div id="job-response" class="mt-2 text-sm"></div>
    </div>
  );
};

export default ScrapeFormContent;
