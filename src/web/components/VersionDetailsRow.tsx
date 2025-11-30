import { type VersionSummary, isActiveStatus } from "../../store/types";
import VersionBadge from "./VersionBadge";
import LoadingSpinner from "./LoadingSpinner";

/**
 * Props for the VersionDetailsRow component.
 */
interface VersionDetailsRowProps {
  version: VersionSummary;
  libraryName: string;
  showDelete?: boolean;
  showRefresh?: boolean;
}

/**
 * Renders details for a single library version in a row format.
 * Includes version, stats, and optional delete/refresh buttons.
 * @param props - Component props including version, libraryName, showDelete, and showRefresh flags.
 */
const VersionDetailsRow = ({
  version,
  libraryName,
  showDelete = true,
  showRefresh = false,
}: VersionDetailsRowProps) => {
  // Format the indexed date nicely, handle null case
  const indexedDate = version.indexedAt
    ? new Date(version.indexedAt).toLocaleDateString()
    : "N/A";
  // Display 'Latest' if version string is empty
  const versionLabel = version.ref.version || "Latest";
  // Use empty string for latest version in param and rowId
  const versionParam = version.ref.version || "";

  // Sanitize both libraryName and versionParam for valid CSS selector
  const sanitizedLibraryName = libraryName.replace(/[^a-zA-Z0-9-_]/g, "-");
  const sanitizedVersionParam = versionParam.replace(/[^a-zA-Z0-9-_]/g, "-");
  const rowId = `row-${sanitizedLibraryName}-${sanitizedVersionParam}`;

  // Determine initial isRefreshing based on version status
  const initialIsRefreshing = isActiveStatus(version.status);

  // Define state-specific button classes for Alpine toggling
  const defaultStateClasses =
    "text-red-700 border border-red-700 hover:bg-red-700 hover:text-white focus:ring-4 focus:outline-none focus:ring-red-300 dark:border-red-500 dark:text-red-500 dark:hover:text-white dark:focus:ring-red-800 dark:hover:bg-red-500";
  const confirmingStateClasses =
    "bg-red-600 text-white border-red-600 focus:ring-4 focus:outline-none focus:ring-red-300 dark:bg-red-700 dark:border-red-700 dark:focus:ring-red-800";

  return (
    // Use flexbox for layout, add border between rows
    <div
      id={rowId}
      class="flex justify-between items-center py-1 border-b border-gray-200 dark:border-gray-600 last:border-b-0"
      data-library-name={libraryName}
      data-version-param={versionParam}
      data-is-refreshing={initialIsRefreshing ? "true" : "false"}
      x-data="{ 
        library: $el.dataset.libraryName, 
        version: $el.dataset.versionParam, 
        confirming: $el.dataset.confirming === 'true', 
        isDeleting: false,
        isRefreshing: $el.dataset.isRefreshing === 'true',
        setRefreshing(val) {
          this.isRefreshing = !!val;
          this.$el.dataset.isRefreshing = val ? 'true' : 'false';
        },
        init() {
          const rowId = this.$el.id;
          const myLibrary = this.library;
          const myVersion = this.version;
          
          document.body.addEventListener('job-status-change', (e) => {
            const job = e.detail;
            const jobVersion = job.version || '';
            if (job.library === myLibrary && jobVersion === myVersion) {
              const newValue = ['queued', 'running'].includes(job.status);
              const el = document.getElementById(rowId);
              if (el) {
                el.dispatchEvent(new CustomEvent('set-refreshing', { detail: newValue, bubbles: true }));
              }
            }
          });
        }
      }"
      x-on:set-refreshing="setRefreshing($event.detail)"
    >
      {/* Version Label */}
      <span
        class="text-sm text-gray-900 dark:text-white w-1/4 truncate"
        title={versionLabel}
      >
        {version.ref.version ? (
          <VersionBadge version={version.ref.version} />
        ) : (
          <span class="text-gray-600 dark:text-gray-400">Latest</span>
        )}
      </span>

      {/* Stats Group */}
      <div class="flex space-x-2 text-sm text-gray-600 dark:text-gray-400 w-3/4 justify-end items-center">
        <span title="Number of unique pages indexed">
          Pages:{" "}
          <span class="font-semibold" safe>
            {version.counts.uniqueUrls.toLocaleString()}
          </span>
        </span>
        <span title="Number of indexed snippets">
          Chunks:{" "}
          <span class="font-semibold" safe>
            {version.counts.documents.toLocaleString()}
          </span>
        </span>
        <span title="Date last indexed">
          Last Update:{" "}
          <span class="font-semibold" safe>
            {indexedDate}
          </span>
        </span>
      </div>

      {/* Action buttons container */}
      <div class="flex items-center ml-2 space-x-1">
        {/* Refresh Button - Icon shown inline based on state */}
        {showRefresh && (
          <>
            {/* Icon button - shown when NOT refreshing */}
            <template x-if="!isRefreshing">
              <button
                type="button"
                class="font-medium rounded-lg text-sm p-1 w-6 h-6 text-center inline-flex items-center justify-center transition-colors duration-150 ease-in-out text-gray-500 border border-gray-300 hover:bg-gray-100 hover:text-gray-700 focus:ring-4 focus:outline-none focus:ring-gray-200 dark:border-gray-600 dark:text-gray-400 dark:hover:text-white dark:focus:ring-gray-700 dark:hover:bg-gray-600"
                title="Refresh this version (re-scrape changed pages)"
                x-on:click="
                  isRefreshing = true;
                  $root.dataset.isRefreshing = 'true';
                  $el.dispatchEvent(new CustomEvent('trigger-refresh', { bubbles: true }));
                "
                hx-post={`/web/libraries/${encodeURIComponent(libraryName)}/versions/${encodeURIComponent(versionParam)}/refresh`}
                hx-swap="none"
                hx-trigger="trigger-refresh"
              >
                <svg
                  class="w-4 h-4"
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                <span class="sr-only">Refresh version</span>
              </button>
            </template>
            {/* Spinner button - shown when refreshing */}
            <template x-if="isRefreshing">
              <button
                type="button"
                class="font-medium rounded-lg text-sm p-1 w-6 h-6 text-center inline-flex items-center justify-center transition-colors duration-150 ease-in-out text-gray-500 border border-gray-300 dark:border-gray-600 dark:text-gray-400"
                title="Refresh in progress..."
                disabled
              >
                <LoadingSpinner class="text-gray-500 dark:text-gray-400" />
                <span class="sr-only">Refreshing...</span>
              </button>
            </template>
          </>
        )}

        {/**
         * Conditionally renders a delete button for the version row.
         * The button has three states:
         * 1. Default: Displays a trash icon.
         * 2. Confirming: Displays a confirmation text with an accessible label.
         * 3. Deleting: Displays a spinner icon indicating the deletion process.
         * The button uses AlpineJS for state management and htmx for server interaction.
         */}
        {showDelete && (
          <button
            type="button"
            class="font-medium rounded-lg text-sm p-1 min-w-6 h-6 text-center inline-flex items-center justify-center transition-colors duration-150 ease-in-out"
            title="Remove this version"
            x-bind:class={`confirming ? '${confirmingStateClasses}' : '${defaultStateClasses}'`}
            x-bind:disabled="isDeleting"
            x-on:click="
              if (confirming) {
                isDeleting = true;
                window.confirmationManager.clear($root.id);
                $el.dispatchEvent(new CustomEvent('confirmed-delete', { bubbles: true }));
              } else {
                confirming = true;
                isDeleting = false;
                window.confirmationManager.start($root.id);
              }
            "
            hx-delete={`/web/libraries/${encodeURIComponent(libraryName)}/versions/${encodeURIComponent(versionParam)}`}
            hx-target={`#${rowId}`}
            hx-swap="outerHTML"
            hx-trigger="confirmed-delete"
          >
            {/* Default State: Trash Icon */}
            <span x-show="!confirming && !isDeleting">
              <svg
                class="w-4 h-4"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 18 20"
              >
                <path
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M1 5h16M7 8v8m4-8v8M7 1h4a1 1 0 0 1 1 1v3H6V2a1 1 0 0 1-1-1ZM3 5h12v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5Z"
                />
              </svg>
              <span class="sr-only">Remove version</span>
            </span>

            {/* Confirming State: Text */}
            <span x-show="confirming && !isDeleting" class="mx-1">
              Confirm?<span class="sr-only">Confirm delete</span>
            </span>

            {/* Deleting State: Spinner Icon */}
            <span x-show="isDeleting">
              <LoadingSpinner />
              <span class="sr-only">Loading...</span>
            </span>
          </button>
        )}
      </div>
    </div>
  );
};

export default VersionDetailsRow;
