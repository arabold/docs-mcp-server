import type { LibraryInfo } from "../../tools/ListLibrariesTool";
import LoadingSpinner from "./LoadingSpinner"; // Import spinner

/**
 * Props for the LibrarySearchCard component.
 */
interface LibrarySearchCardProps {
  library: LibraryInfo;
}

/**
 * Renders the search form card for a specific library.
 * Includes a version dropdown and query input.
 * @param props - Component props including the library information.
 */
const LibrarySearchCard = ({ library }: LibrarySearchCardProps) => {
  return (
    <div class="block p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-300 dark:border-gray-600 mb-4">
      <h2 class="text-xl font-semibold mb-2 text-gray-900 dark:text-white" safe>
        Search {library.name} Documentation
      </h2>
      <form
        hx-get={`/web/libraries/${encodeURIComponent(library.name)}/search`}
        hx-target="#searchResultsContainer .search-results"
        hx-swap="innerHTML"
        hx-indicator="#searchResultsContainer"
        class="flex space-x-2"
      >
        <select
          name="version"
          class="w-40 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
        >
          <option value="">Latest</option> {/* Default to latest */}
          {library.versions.map((version) => (
            <option value={version.version || "latest"} safe>
              {version.version || "Latest"}
            </option>
          ))}
        </select>
        <input
          type="text"
          name="query"
          placeholder="Search query..."
          required
          class="flex-grow bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
        />
        <button
          type="submit"
          class="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800 relative"
        >
          <span class="search-text">Search</span>
          {/* Spinner for HTMX loading - shown via htmx-indicator class on parent */}
          <span class="spinner absolute inset-0 flex items-center justify-center">
            <LoadingSpinner />
          </span>
        </button>
      </form>
      {/* Add style for htmx-indicator behavior on button */}
      {/* Styles moved to Layout.tsx */}
    </div>
  );
};

export default LibrarySearchCard;
