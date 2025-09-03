import type { FastifyInstance } from "fastify";
import Layout from "../components/Layout"; // Import the Layout component

/**
 * Registers the root route that serves the main HTML page.
 * @param server - The Fastify instance.
 */
export function registerIndexRoute(server: FastifyInstance) {
  server.get("/", async (_, reply) => {
    reply.type("text/html");
    // Use the Layout component and define the main content within it
    return (
      "<!DOCTYPE html>" +
      (
        <Layout title="MCP Docs">
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
            {/* Container for the job list, loaded via HTMX */}
            <div id="job-queue" hx-get="/web/jobs" hx-trigger="load, every 1s">
              {/* Initial loading state */}
              <div class="animate-pulse">
                <div class="h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-48 mb-4" />
                <div class="h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-full mb-2.5" />
                <div class="h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-full mb-2.5" />
              </div>
            </div>
          </section>
          {/* Add Content Section - Tabbed Interface */}
          <section class="mb-8">
            <div class="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-300 dark:border-gray-600">
              {/* Tab Navigation */}
              <div class="border-b border-gray-200 dark:border-gray-600" x-data="{ activeTab: 'scrape' }">
                <nav class="-mb-px flex">
                  <button
                    class="py-3 px-6 text-sm font-medium border-b-2 transition-colors duration-150"
                    x-bind:class="activeTab === 'scrape' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'"
                    x-on:click="activeTab = 'scrape'"
                    type="button"
                  >
                    Scrape Documentation
                  </button>
                  <button
                    class="py-3 px-6 text-sm font-medium border-b-2 transition-colors duration-150"
                    x-bind:class="activeTab === 'plaintext' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'"
                    x-on:click="activeTab = 'plaintext'"
                    type="button"
                  >
                    Add Plaintext Content
                  </button>
                </nav>

                {/* Scrape Tab Content */}
                <div x-show="activeTab === 'scrape'" x-transition>
                  <div id="addJobForm" hx-get="/web/jobs/new" hx-trigger="load">
                    {/* Initial loading state for scrape form */}
                    <div class="p-6 animate-pulse">
                      <div class="h-6 bg-gray-200 rounded-full dark:bg-gray-700 w-1/3 mb-4" />
                      <div class="h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-full mb-2.5" />
                      <div class="h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-full mb-2.5" />
                    </div>
                  </div>
                </div>

                {/* Plaintext Tab Content */}
                <div x-show="activeTab === 'plaintext'" x-transition>
                  <div id="addPlaintextForm" hx-get="/web/plaintext/new" hx-trigger="intersect once">
                    {/* Initial loading state for plaintext form */}
                    <div class="p-6 animate-pulse">
                      <div class="h-6 bg-gray-200 rounded-full dark:bg-gray-700 w-1/3 mb-4" />
                      <div class="h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-full mb-2.5" />
                      <div class="h-[0.8em] bg-gray-200 rounded-full dark:bg-gray-700 w-full mb-2.5" />
                      <div class="h-20 bg-gray-200 rounded dark:bg-gray-700 mb-2.5" />
                    </div>
                  </div>
                </div>
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
              hx-trigger="load, every 10s"
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
