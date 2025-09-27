import type { LibraryInfo } from "../../tools/ListLibrariesTool";
import type { VersionSummary } from "../../store/types";
import VersionDetailsRow from "./VersionDetailsRow"; // Adjusted import path

/**
 * Props for the LibraryDetailCard component.
 */
interface LibraryDetailCardProps {
  library: LibraryInfo;
}

/**
 * Renders a card displaying library details and its versions.
 * Uses VersionDetailsRow without the delete button.
 * @param props - Component props including the library information.
 */
const LibraryDetailCard = ({ library }: LibraryDetailCardProps) => {
  const versions = library.versions?.reverse() || [];
  const latestVersion = versions[0];
  return (
    // Use Flowbite Card structure with updated padding and border, and white background
    <div class="block p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-300 dark:border-gray-600 mb-4">
      <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-1">
        <span safe>{library.name}</span>
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
              <VersionDetailsRow
                libraryName={library.name}
                version={adapted}
                showDelete={false}
              />
            );
          })
        ) : (
          <p class="text-sm text-gray-500 dark:text-gray-400 italic">
            No versions indexed.
          </p>
        )}
      </div>
    </div>
  );
};

export default LibraryDetailCard;
