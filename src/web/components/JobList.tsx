import type { JobInfo } from "../../tools/GetJobInfoTool";
import JobItem from "./JobItem";

/**
 * Props for the JobList component.
 */
interface JobListProps {
  jobs: JobInfo[];
}

/**
 * Renders a list of JobItem components or a message if the list is empty.
 * Also renders an out-of-band swap for the "Clear Completed Jobs" button state.
 * @param props - Component props including the array of jobs.
 */
const JobList = ({ jobs }: JobListProps) => {
  const hasJobs = jobs.length > 0;

  return (
    <>
      <div id="job-list" class="space-y-2 animate-[fadeSlideIn_0.2s_ease-out]">
        {hasJobs ? (
          jobs.map((job) => <JobItem job={job} />)
        ) : (
          <p class="text-center text-gray-500 dark:text-gray-400">
            No pending jobs.
          </p>
        )}
      </div>
      {/* Out-of-band swap for the Clear Completed Jobs button */}
      <button
        id="clear-completed-btn"
        hx-swap-oob="true"
        type="button"
        class={`text-xs px-3 py-1.5 rounded-lg focus:ring-4 focus:outline-none transition-colors duration-150 ${
          hasJobs
            ? "text-gray-700 bg-gray-100 border border-gray-300 hover:bg-gray-200 focus:ring-gray-100 dark:bg-gray-600 dark:text-gray-300 dark:border-gray-500 dark:hover:bg-gray-700 dark:focus:ring-gray-700"
            : "text-gray-400 bg-gray-50 border border-gray-200 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500 dark:border-gray-600"
        }`}
        title="Clear all completed, cancelled, and failed jobs"
        hx-post="/web/jobs/clear-completed"
        hx-trigger="click"
        hx-on="htmx:afterRequest: document.dispatchEvent(new Event('job-list-refresh'))"
        hx-swap="none"
        disabled={!hasJobs}
      >
        Clear Completed Jobs
      </button>
    </>
  );
};

export default JobList;
