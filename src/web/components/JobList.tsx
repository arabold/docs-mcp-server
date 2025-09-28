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
 * Adds a listener for the 'job-list-refresh' event to trigger a reload of the job list using HTMX.
 * @param props - Component props including the array of jobs.
 */
const JobList = ({ jobs }: JobListProps) => (
  <div id="job-list" class="space-y-2">
    {jobs.length === 0 ? (
      <p class="text-center text-gray-500 dark:text-gray-400">
        No pending jobs.
      </p>
    ) : (
      jobs.map((job) => <JobItem job={job} />)
    )}
    {/* NOTE: To enable live job list refresh after stopping a job, add the following script to your main HTML layout or main.client.ts:
        document.addEventListener('job-list-refresh', function () {
          if (window.htmx) {
            window.htmx.ajax('GET', '/web/jobs', '#job-list');
          } else {
            window.location.reload();
          }
        });
    */}
  </div>
);

export default JobList;
