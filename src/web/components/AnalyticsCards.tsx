interface AnalyticsCardsProps {
  totalChunks: number;
  activeLibraries: number;
  activeVersions: number;
  indexedPages: number;
}

/**
 * Formats a number for display, using K, M, B suffixes for large numbers.
 */
function formatNumber(num: number): string {
  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(1)}B`;
  }
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toString();
}

/**
 * Displays three analytics cards: Total Chunks, Active Libraries, and Indexed Pages.
 */
const AnalyticsCards = ({
  totalChunks,
  activeLibraries,
  activeVersions,
  indexedPages,
}: AnalyticsCardsProps) => (
  <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4 animate-[fadeSlideIn_0.2s_ease-out]">
    {/* Knowledge Base Card */}
    <div class="p-4 bg-white rounded-lg shadow dark:bg-gray-800 border border-gray-300 dark:border-gray-600">
      <div class="flex items-center">
        <div>
          <p class="text-sm font-medium text-gray-500 dark:text-gray-400">
            Total Knowledge Base
          </p>
          <p class="text-xl font-semibold text-gray-900 dark:text-white" safe>
            {formatNumber(totalChunks)} Chunks
          </p>
        </div>
      </div>
    </div>

    {/* Active Libraries Card */}
    <div class="p-4 bg-white rounded-lg shadow dark:bg-gray-800 border border-gray-300 dark:border-gray-600">
      <div class="flex items-center">
        <div>
          <p class="text-sm font-medium text-gray-500 dark:text-gray-400">
            Libraries / Versions
          </p>
          <p class="text-xl font-semibold text-gray-900 dark:text-white">
            {activeLibraries}
            {" / "}
            {activeVersions}
          </p>
        </div>
      </div>
    </div>

    {/* Indexed Pages Card */}
    <div class="p-4 bg-white rounded-lg shadow dark:bg-gray-800 border border-gray-300 dark:border-gray-600">
      <div class="flex items-center">
        <div>
          <p class="text-sm font-medium text-gray-500 dark:text-gray-400">
            Indexed Pages
          </p>
          <p class="text-xl font-semibold text-gray-900 dark:text-white" safe>
            {formatNumber(indexedPages)}
          </p>
        </div>
      </div>
    </div>
  </div>
);

export default AnalyticsCards;
