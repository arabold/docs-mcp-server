import type { JobInfo } from "../../tools/GetJobInfoTool";
import { PipelineJobStatus } from "../../pipeline/types";
import { VersionStatus, isActiveStatus } from "../../store/types";
import VersionBadge from "./VersionBadge";
import StatusBadge from "./StatusBadge";
import ProgressBar from "./ProgressBar";
import LoadingSpinner from "./LoadingSpinner";

/**
 * Props for the JobItem component.
 */
interface JobItemProps {
  job: JobInfo;
}

/**
 * Renders a single job item with its details and status.
 * @param props - Component props including the job information.
 */
const JobItem = ({ job }: JobItemProps) => {
  // Use database status if available, fallback to pipeline status
  const displayStatus = job.dbStatus || job.status;
  const isActiveJob = job.dbStatus
    ? isActiveStatus(job.dbStatus)
    : job.status === PipelineJobStatus.QUEUED ||
      job.status === PipelineJobStatus.RUNNING;

  return (
    <div
      id={`job-item-${job.id}`}
      class="block p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600"
      data-job-id={job.id}
      x-data="{ jobId: $el.dataset.jobId }"
      x-bind:hx-preserve="$store.confirmingAction.type === 'job-cancel' && $store.confirmingAction.id === jobId"
    >
      <div class="flex items-start justify-between">
        <div class="flex-1">
          <p class="text-sm font-medium text-gray-900 dark:text-white">
            <span safe>{job.library}</span>{" "}
            <VersionBadge version={job.version} />
          </p>

          {/* Timestamps */}
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {job.startedAt ? (
              <div>
                Last Indexed:{" "}
                <span safe>{new Date(job.startedAt).toLocaleString()}</span>
              </div>
            ) : null}
          </div>

          {/* Progress bar for active jobs */}
          {job.progress && job.progress.totalPages > 0 && isActiveJob ? (
            <div class="mt-2">
              <ProgressBar progress={job.progress} />
            </div>
          ) : null}

          {/* Error message display */}
          {job.errorMessage || job.error ? (
            <div class="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-xs">
              <div class="font-medium text-red-800 dark:text-red-300 mb-1">
                Error:
              </div>
              <div safe class="text-red-700 dark:text-red-400">
                {job.errorMessage || job.error}
              </div>
            </div>
          ) : null}
        </div>

        <div class="flex flex-col items-end gap-2 ml-4">
          {/* Status badge */}
          <div class="flex items-center gap-2">
            {job.dbStatus ? (
              <StatusBadge status={job.dbStatus} />
            ) : (
              <span
                class={`px-1.5 py-0.5 text-xs font-medium rounded ${
                  job.status === PipelineJobStatus.COMPLETED
                    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
                    : job.error
                      ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300"
                      : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300"
                }`}
              >
                {job.status}
              </span>
            )}

            {/* Stop button for active jobs */}
            {isActiveJob && (
              <button
                type="button"
                class="font-medium rounded-lg text-xs p-1 text-center inline-flex items-center transition-colors duration-150 ease-in-out border border-gray-300 bg-white text-red-600 hover:bg-red-50 focus:ring-4 focus:outline-none focus:ring-red-100 dark:border-gray-600 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-gray-700 dark:focus:ring-red-900"
                title="Stop this job"
                x-on:click="
                if ($store.confirmingAction.type === 'job-cancel' && $store.confirmingAction.id === jobId) {
                  $store.confirmingAction.isStopping = true;
                  fetch('/web/jobs/' + jobId + '/cancel', {
                    method: 'POST',
                    headers: { 'Accept': 'application/json' },
                  })
                    .then(r => r.json())
                    .then(() => {
                      $store.confirmingAction.type = null;
                      $store.confirmingAction.id = null;
                      $store.confirmingAction.isStopping = false;
                      if ($store.confirmingAction.timeoutId) { clearTimeout($store.confirmingAction.timeoutId); $store.confirmingAction.timeoutId = null; }
                      document.dispatchEvent(new CustomEvent('job-list-refresh'));
                    })
                    .catch(() => { $store.confirmingAction.isStopping = false; });
                } else {
                  if ($store.confirmingAction.timeoutId) { clearTimeout($store.confirmingAction.timeoutId); $store.confirmingAction.timeoutId = null; }
                  $store.confirmingAction.type = 'job-cancel';
                  $store.confirmingAction.id = jobId;
                  $store.confirmingAction.isStopping = false;
                  $store.confirmingAction.timeoutId = setTimeout(() => {
                    $store.confirmingAction.type = null;
                    $store.confirmingAction.id = null;
                    $store.confirmingAction.isStopping = false;
                    $store.confirmingAction.timeoutId = null;
                  }, 3000);
                }
              "
                x-bind:disabled="$store.confirmingAction.type === 'job-cancel' && $store.confirmingAction.id === jobId && $store.confirmingAction.isStopping"
              >
                <span x-show="$store.confirmingAction.type !== 'job-cancel' || $store.confirmingAction.id !== jobId || $store.confirmingAction.isStopping">
                  {/* Red Stop Icon */}
                  <svg
                    class="w-4 h-4"
                    aria-hidden="true"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <rect x="5" y="5" width="10" height="10" rx="2" />
                  </svg>
                  <span class="sr-only">Stop job</span>
                </span>
                <span
                  x-show="$store.confirmingAction.type === 'job-cancel' && $store.confirmingAction.id === jobId && !$store.confirmingAction.isStopping"
                  class="px-2"
                >
                  Cancel?
                </span>
                <span x-show="$store.confirmingAction.type === 'job-cancel' && $store.confirmingAction.id === jobId && $store.confirmingAction.isStopping">
                  <LoadingSpinner />
                  <span class="sr-only">Stopping...</span>
                </span>
              </button>
            )}
          </div>
          {job.error ? (
            // Keep the error badge for clarity if an error occurred
            <span class="bg-red-100 text-red-800 text-xs font-medium px-1.5 py-0.5 rounded dark:bg-red-900 dark:text-red-300">
              Error
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default JobItem;
