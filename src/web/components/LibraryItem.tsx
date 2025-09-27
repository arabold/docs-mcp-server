import type { LibraryInfo } from "../../tools/ListLibrariesTool";
import type { VersionSummary } from "../../store/types";
import VersionDetailsRow from "./VersionDetailsRow"; // Adjusted import path

/**
 * Props for the LibraryItem component.
 */
interface LibraryItemProps {
  library: LibraryInfo;
}

/**
 * Renders a card for a single library, listing its versions with details.
 * Uses VersionDetailsRow to display each version.
 * @param props - Component props including the library information.
 */
const LibraryItem = ({ library }: LibraryItemProps) => {
  const versions = library.versions?.reverse() || [];
  const latestVersion = versions[0];
  return (
    // Use Flowbite Card structure with updated padding and border, and white background
    <div class="block px-4 py-2 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-300 dark:border-gray-600">
      <h3 class="text-lg font-medium text-gray-900 dark:text-white">
        <a
          href={`/libraries/${encodeURIComponent(library.name)}`}
          class="hover:underline"
        >
          <span safe>{library.name}</span>
        </a>
      </h3>
      {latestVersion?.sourceUrl ? (
        <div class="text-sm text-gray-500 dark:text-gray-400">
          <a
            href={latestVersion.sourceUrl}
            target="_blank"
            class="hover:underline"
            safe
          >
            {latestVersion.sourceUrl}
          </a>
        </div>
      ) : null}
      {/* Container for version rows */}
      <div class="mt-2">
        {versions.length > 0 ? (
          versions.map((v) => {
            // Adapt simplified tool version shape to VersionSummary expected by VersionDetailsRow
            const adapted: VersionSummary = {
              id: -1,
              ref: { library: library.name, version: v.version },
              status: v.status,
              progress: v.progress,
              counts: {
                documents: v.documentCount,
                uniqueUrls: v.uniqueUrlCount,
              },
              indexedAt: v.indexedAt,
              sourceUrl: v.sourceUrl ?? undefined,
            };
            return (
              <VersionDetailsRow libraryName={library.name} version={adapted} />
            );
          })
        ) : (
          // Display message if no versions are indexed
          <p class="text-sm text-gray-500 dark:text-gray-400 italic">
            No versions indexed.
          </p>
        )}
      </div>
    </div>
  );
};

export default LibraryItem;
