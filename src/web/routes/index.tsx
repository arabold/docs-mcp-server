import type { FastifyInstance } from "fastify";
import Layout from "../components/Layout"; // Import the Layout component

/**
 * Registers the root route that serves the main HTML page.
 * @param server - The Fastify instance.
 * @param config - Optional configuration for the web UI.
 */
export function registerIndexRoute(
  server: FastifyInstance,
  config?: { externalWorkerUrl?: string }
) {
  server.get("/", async (_, reply) => {
    reply.type("text/html");

    // Determine if we're using a remote worker
    const useRemoteWorker = Boolean(config?.externalWorkerUrl);
    const trpcUrl = config?.externalWorkerUrl
      ? `${config.externalWorkerUrl}/api`
      : undefined;

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
          {/* Job Queue Section */}
          <section class="mb-4 p-4 bg-white rounded-lg shadow dark:bg-gray-800 border border-gray-300 dark:border-gray-600">
            <div class="flex items-center justify-between mb-2">
              <h2 class="text-xl font-semibold text-gray-900 dark:text-white">
                Job Queue
              </h2>
              <button
                type="button"
                class="text-xs px-3 py-1.5 text-gray-700 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 focus:ring-4 focus:outline-none focus:ring-gray-100 dark:bg-gray-600 dark:text-gray-300 dark:border-gray-500 dark:hover:bg-gray-700 dark:focus:ring-gray-700 transition-colors duration-150"
                title="Clear all completed, cancelled, and failed jobs"
                hx-post="/web/jobs/clear-completed"
                hx-trigger="click"
                hx-on="htmx:afterRequest: document.dispatchEvent(new Event('job-list-refresh'))"
                hx-swap="none"
              >
                Clear Completed Jobs
              </button>
            </div>
            {/* Container for the job list, loaded via HTMX and updated via SSE */}
            <div
              id="job-queue"
              hx-get="/web/jobs"
              hx-trigger="load, job-status-change from:body, job-progress from:body, job-list-change from:body"
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
            {/* Container for the add job form, loaded via HTMX */}
            <div id="addJobForm" hx-get="/web/jobs/new" hx-trigger="load">
              {/* Initial loading state (optional, could just be empty) */}
              <div class="p-6 bg-white rounded-lg shadow dark:bg-gray-800 animate-pulse">
                <div class="h-6 bg-gray-200 rounded-full dark:bg-gray-700 w-1/3 mb-4" />
                <div class="h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-full mb-2.5" />
                <div class="h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-full mb-2.5" />
              </div>
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
