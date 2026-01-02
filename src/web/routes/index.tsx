import type { FastifyInstance } from "fastify";
import AddJobButton from "../components/AddJobButton";
import Layout from "../components/Layout";

/**
 * Registers the root route that serves the main HTML page.
 * @param server - The Fastify instance.
 * @param externalWorkerUrl - Optional URL for external worker service.
 */
export function registerIndexRoute(
  server: FastifyInstance,
  externalWorkerUrl?: string
) {
  server.get("/", async (_, reply) => {
    reply.type("text/html");

    // Determine if we're using a remote worker
    const useRemoteWorker = Boolean(externalWorkerUrl);
    const trpcUrl = externalWorkerUrl ? `${externalWorkerUrl}/api` : undefined;

    // Use the Layout component and define the main content within it
    return (
      "<!DOCTYPE html>" +
      (
        <Layout
          title="MCP Docs"
          eventClientConfig={{
            useRemoteWorker,
            trpcUrl,
          }}
        >
          {/* Analytics Section */}
          <div
            id="analytics-stats"
            hx-get="/web/stats"
            hx-trigger="load, library-change from:body"
            hx-swap="morph:innerHTML"
          >
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4 animate-pulse">
              <div class="p-4 bg-white rounded-lg shadow dark:bg-gray-800 border border-gray-300 dark:border-gray-600 h-20" />
              <div class="p-4 bg-white rounded-lg shadow dark:bg-gray-800 border border-gray-300 dark:border-gray-600 h-20" />
              <div class="p-4 bg-white rounded-lg shadow dark:bg-gray-800 border border-gray-300 dark:border-gray-600 h-20" />
            </div>
          </div>
          {/* Job Queue Section */}
          <section class="mb-4 p-4 bg-white rounded-lg shadow dark:bg-gray-800 border border-gray-300 dark:border-gray-600">
            <div class="flex items-center justify-between mb-2">
              <h2 class="text-xl font-semibold text-gray-900 dark:text-white">
                Job Queue
              </h2>
              <button
                id="clear-completed-btn"
                type="button"
                class="text-xs px-3 py-1.5 text-gray-400 bg-gray-50 border border-gray-200 rounded-lg cursor-not-allowed focus:ring-4 focus:outline-none transition-colors duration-150 dark:bg-gray-700 dark:text-gray-500 dark:border-gray-600"
                title="Clear all completed, cancelled, and failed jobs"
                hx-post="/web/jobs/clear-completed"
                hx-trigger="click"
                hx-on="htmx:afterRequest: document.dispatchEvent(new Event('job-list-refresh'))"
                hx-swap="none"
                disabled
              >
                Clear Completed Jobs
              </button>
            </div>
            {/* Container for the job list, loaded via HTMX and updated via SSE */}
            <div
              id="job-queue"
              hx-get="/web/jobs"
              hx-trigger="load, job-status-change from:body, job-progress from:body, job-list-change from:body, job-list-refresh from:body"
              hx-swap="morph:innerHTML"
            >
              {/* Initial loading state */}
              <div class="animate-pulse">
                <div class="h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-48 mb-4" />
                <div class="h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-full mb-2.5" />
                <div class="h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-full mb-2.5" />
              </div>
            </div>
          </section>
          {/* Add New Job Section */}
          <section class="mb-8">
            {/* Button to reveal the scrape form, loaded via HTMX */}
            <div id="addJobForm">
              <AddJobButton />
            </div>
          </section>
          {/* Indexed Documentation Section */}
          <div>
            <h2 class="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
              Indexed Documentation
            </h2>
            <div
              id="indexed-docs"
              hx-get="/web/libraries"
              hx-trigger="load, library-change from:body"
              hx-swap="morph:innerHTML"
            >
              <div class="animate-pulse">
                <div class="h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-48 mb-4" />
                <div class="h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-full mb-2.5" />
                <div class="h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-full mb-2.5" />
              </div>
            </div>
          </div>
        </Layout>
      )
    );
  });
}
