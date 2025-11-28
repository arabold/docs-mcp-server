import { ScrapeMode } from "../../scraper/types";
import Alert from "./Alert";
import Tooltip from "./Tooltip";

interface ScrapeFormContentProps {
  defaultExcludePatterns?: string[];
}

/**
 * Renders the form fields for queuing a new scrape job.
 * Includes basic fields (URL, Library, Version) and advanced options.
 */
const ScrapeFormContent = ({
  defaultExcludePatterns,
}: ScrapeFormContentProps) => {
  // Format default patterns for display in textarea (one per line)
  const defaultExcludePatternsText = defaultExcludePatterns?.join("\n") || "";

  return (
    <div class="mt-4 p-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-300 dark:border-gray-600 relative animate-[fadeSlideIn_0.2s_ease-out]">
      {/* Close button */}
      <button
        type="button"
        hx-get="/web/jobs/new-button"
        hx-target="#addJobForm"
        hx-swap="innerHTML"
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
        Queue New Scrape Job
      </h3>
      <form
        hx-post="/web/jobs/scrape"
        hx-target="#addJobForm"
        hx-swap="innerHTML"
        class="space-y-2"
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
      >
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
          <input
            type="text"
            name="library"
            id="library"
            required
            class="mt-0.5 block w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>
        <div>
          <div class="flex items-center">
            <label
              for="version"
              class="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Version (optional)
            </label>
            <Tooltip text="Specify the version of the library documentation you're indexing. This allows for version-specific searches." />
          </div>
          <input
            type="text"
            name="version"
            id="version"
            class="mt-0.5 block w-full max-w-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>

        {/* Advanced Options with slide animation */}
        <div
          class="bg-gray-50 dark:bg-gray-900 p-2 rounded-md"
          x-data="{ open: false, headers: [] }"
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
                <Tooltip text="The maximum number of pages to scrape. Default is 1000. Setting this too high may result in longer processing times." />
              </div>
              <input
                type="number"
                name="maxPages"
                id="maxPages"
                min="1"
                placeholder="1000"
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
                <Tooltip text="How many links deep the scraper should follow. Default is 3. Higher values capture more content but increase processing time." />
              </div>
              <input
                type="number"
                name="maxDepth"
                id="maxDepth"
                min="0"
                placeholder="3"
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
                <option value="subpages" selected>
                  Subpages (Default)
                </option>
                <option value="hostname">Hostname</option>
                <option value="domain">Domain</option>
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
              ></textarea>
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
                {defaultExcludePatternsText}
              </textarea>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Default patterns are pre-filled. Edit to customize or clear to
                exclude nothing.
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
                <option value={ScrapeMode.Auto} selected>
                  Auto (Default)
                </option>
                <option value={ScrapeMode.Fetch}>Fetch</option>
                <option value={ScrapeMode.Playwright}>Playwright</option>
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
                checked
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
                checked
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
            Queue Job
          </button>
        </div>
      </form>
      {/* Target div for HTMX response - now only used for success messages */}
      <div id="job-response" class="mt-2 text-sm"></div>
    </div>
  );
};

export default ScrapeFormContent;
