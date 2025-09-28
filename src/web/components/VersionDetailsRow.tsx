import type { VersionSummary } from "../../store/types";
import VersionBadge from "./VersionBadge";
import LoadingSpinner from "./LoadingSpinner"; // Import spinner

/**
 * Props for the VersionDetailsRow component.
 */
interface VersionDetailsRowProps {
  version: VersionSummary;
  libraryName: string;
  showDelete?: boolean; // Optional prop to control delete button visibility
}

/**
 * Renders details for a single library version in a row format.
 * Includes version, stats, and an optional delete button.
 * @param props - Component props including version, libraryName, and showDelete flag.
 */
const VersionDetailsRow = ({
  version,
  libraryName,
  showDelete = true, // Default to true
}: VersionDetailsRowProps) => {
  // Format the indexed date nicely, handle null case
  const indexedDate = version.indexedAt
    ? new Date(version.indexedAt).toLocaleDateString()
    : "N/A";
  // Display 'Unversioned' if version string is empty
  const versionLabel = version.ref.version || "Unversioned";
  // Use empty string for unversioned in param and rowId
  const versionParam = version.ref.version || "";

  // Sanitize both libraryName and versionParam for valid CSS selector
  const sanitizedLibraryName = libraryName.replace(/[^a-zA-Z0-9-_]/g, "-");
  const sanitizedVersionParam = versionParam.replace(/[^a-zA-Z0-9-_]/g, "-");
  const rowId = `row-${sanitizedLibraryName}-${sanitizedVersionParam}`;

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
    >
      {/* Version Label */}
      <span
        class="text-sm text-gray-900 dark:text-white w-1/4 truncate"
        title={versionLabel}
      >
        {version.ref.version ? (
          <VersionBadge version={version.ref.version} />
        ) : (
          <span>Unversioned</span>
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
          Snippets:{" "}
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
          class="ml-2 font-medium rounded-lg text-sm p-1 text-center inline-flex items-center transition-colors duration-150 ease-in-out"
          title="Remove this version"
          x-data="{}"
          x-bind:class={`$store.confirmingAction.type === 'version-delete' && $store.confirmingAction.id === '${libraryName}:${versionParam}' ? '${confirmingStateClasses}' : '${defaultStateClasses}'`}
          x-bind:disabled={`$store.confirmingAction.type === 'version-delete' && $store.confirmingAction.id === '${libraryName}:${versionParam}' && $store.confirmingAction.isDeleting`}
          x-on:click={`
            if ($store.confirmingAction.type === 'version-delete' && $store.confirmingAction.id === '${libraryName}:${versionParam}') {
              $store.confirmingAction.isDeleting = true;
              $el.dispatchEvent(new CustomEvent('confirmed-delete', { bubbles: true }));
            } else {
              if ($store.confirmingAction.timeoutId) { clearTimeout($store.confirmingAction.timeoutId); $store.confirmingAction.timeoutId = null; }
              $store.confirmingAction.type = 'version-delete';
              $store.confirmingAction.id = '${libraryName}:${versionParam}';
              $store.confirmingAction.isDeleting = false;
              $store.confirmingAction.timeoutId = setTimeout(() => {
                $store.confirmingAction.type = null;
                $store.confirmingAction.id = null;
                $store.confirmingAction.isDeleting = false;
                $store.confirmingAction.timeoutId = null;
              }, 3000);
            }
          `}
          hx-delete={`/web/libraries/${encodeURIComponent(libraryName)}/versions/${encodeURIComponent(versionParam)}`}
          hx-target={`#${rowId}`}
          hx-swap="outerHTML"
          hx-trigger="confirmed-delete"
        >
          {/* Default State: Trash Icon */}
          <span
            x-show={`!($store.confirmingAction.type === 'version-delete' && $store.confirmingAction.id === '${libraryName}:${versionParam}' && $store.confirmingAction.isDeleting)`}
          >
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
          <span
            x-show={`$store.confirmingAction.type === 'version-delete' && $store.confirmingAction.id === '${libraryName}:${versionParam}' && !$store.confirmingAction.isDeleting`}
            class="mx-1"
          >
            Confirm?<span class="sr-only">Confirm delete</span>
          </span>

          {/* Deleting State: Spinner Icon */}
          <span
            x-show={`$store.confirmingAction.type === 'version-delete' && $store.confirmingAction.id === '${libraryName}:${versionParam}' && $store.confirmingAction.isDeleting`}
          >
            <LoadingSpinner />
            <span class="sr-only">Loading...</span>
          </span>
        </button>
      )}
    </div>
  );
};

export default VersionDetailsRow;
