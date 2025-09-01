/**
 * ProgressBar component displays indexing progress.
 * Shows pages processed out of total discovered pages with visual progress bar.
 * The progress reflects actual queue-based progress: processed vs. discovered pages.
 */

interface ProgressBarProps {
  progress: {
    pages: number;
    totalPages: number; // Effective total pages (limited by maxPages config)
    totalDiscovered: number; // Total pages actually discovered
  };
  showText?: boolean;
}

const ProgressBar = ({ progress, showText = true }: ProgressBarProps) => {
  // Handle the initial case where we only know about 1 page (starting URL)
  // and haven't discovered any additional pages yet.
  const isIndeterminate = progress.totalDiscovered === 1;

  const percentage =
    progress.totalPages > 0
      ? Math.round((progress.pages / progress.totalPages) * 100)
      : 0;

  // Create the progress text
  const getProgressText = () => {
    if (isIndeterminate) {
      return "Discovering pages...";
    }

    const baseText = `${progress.pages}/${progress.totalPages} pages (${percentage}%)`;

    // If we discovered more pages than the limit, show the total discovered
    if (progress.totalDiscovered > progress.totalPages) {
      return `${baseText} • ${progress.totalDiscovered} total`;
    }

    return baseText;
  };

  return (
    <div class="w-full">
      {showText && (
        <div class="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
          <span>Progress</span>
          <span safe>{getProgressText()}</span>
        </div>
      )}
      <div class="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
        {isIndeterminate ? (
          // Indeterminate progress bar with animation
          <div
            class="bg-blue-600 h-2 rounded-full animate-pulse"
            style="width: 30%"
          ></div>
        ) : (
          <div
            class="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={`width: ${percentage}%`}
          ></div>
        )}
      </div>
    </div>
  );
};

export default ProgressBar;
