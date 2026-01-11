import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ScrapeTool } from "../../../tools/ScrapeTool";
import { ScrapeMode } from "../../../scraper/types";
import type { AppConfig } from "../../../utils/config";
import { logger } from "../../../utils/logger";
import AddJobButton from "../../components/AddJobButton";
import AddVersionButton from "../../components/AddVersionButton";
import Alert from "../../components/Alert";
import ScrapeForm from "../../components/ScrapeForm";
import { DEFAULT_EXCLUSION_PATTERNS } from "../../../scraper/utils/defaultPatterns";
import { ValidationError } from "../../../tools/errors";

/**
 * Registers the API routes for creating new jobs.
 * @param server - The Fastify instance.
 * @param scrapeTool - The tool instance for scraping documents.
 */
export function registerNewJobRoutes(
  server: FastifyInstance,
  scrapeTool: ScrapeTool,
  scraperConfig: AppConfig["scraper"]
) {
  // GET /web/jobs/new - Return the form component wrapped in its container
  server.get("/web/jobs/new", async () => {
    // Return the wrapper component which includes the container div
    return (
      <ScrapeForm
        defaultExcludePatterns={DEFAULT_EXCLUSION_PATTERNS}
        scraperConfig={scraperConfig}
      />
    );
  });

  // GET /web/jobs/new-button - Return just the button to collapse the form
  server.get("/web/jobs/new-button", async () => {
    return <AddJobButton />;
  });

  // POST /web/jobs/scrape - Queue a new scrape job
  server.post(
    "/web/jobs/scrape",
    async (
      request: FastifyRequest<{
        Body: {
          url: string;
          library: string;
          version?: string;
          formMode?: "new" | "add-version"; // Hidden field indicating form context
          maxPages?: string;
          maxDepth?: string;
          scope?: "subpages" | "hostname" | "domain";
          scrapeMode?: ScrapeMode;
          followRedirects?: "on" | undefined; // Checkbox value is 'on' if checked
          ignoreErrors?: "on" | undefined;
          includePatterns?: string;
          excludePatterns?: string;
          "header[]"?: string[] | string; // Added header field for custom headers
        };
      }>,
      reply
    ) => {
      const body = request.body;
      reply.type("text/html"); // Set content type for all responses from this handler
      try {
        // Basic validation
        if (!body.url || !body.library) {
          reply.status(400);
          // Use Alert component for validation error
          return (
            <Alert
              type="error"
              title="Validation Error:"
              message="URL and Library Name are required."
            />
          );
        }

        // Parse includePatterns and excludePatterns from textarea input
        function parsePatterns(input?: string): string[] | undefined {
          if (input === undefined) return undefined;
          if (input.trim() === "") return [];
          return input
            .split(/\n|,/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        }

        // Parse custom headers from repeated header[] fields (format: name:value)
        function parseHeaders(
          input?: string[] | string
        ): Record<string, string> | undefined {
          if (!input) return undefined;
          const arr = Array.isArray(input) ? input : [input];
          const headers: Record<string, string> = {};
          for (const entry of arr) {
            const idx = entry.indexOf(":");
            if (idx > 0) {
              const name = entry.slice(0, idx).trim();
              const value = entry.slice(idx + 1).trim();
              if (name) headers[name] = value;
            }
          }
          return Object.keys(headers).length > 0 ? headers : undefined;
        }

        // Normalize version: treat "latest", empty string, or whitespace-only as null (latest)
        const normalizedVersion =
          !body.version ||
          body.version.trim() === "" ||
          body.version.trim().toLowerCase() === "latest"
            ? null
            : body.version.trim();

        // Prepare options for ScrapeTool
        const scrapeOptions = {
          url: body.url,
          library: body.library,
          version: normalizedVersion,
          waitForCompletion: false, // Don't wait in UI
          options: {
            maxPages: body.maxPages
              ? Number.parseInt(body.maxPages, 10)
              : undefined,
            maxDepth: body.maxDepth
              ? Number.parseInt(body.maxDepth, 10)
              : undefined,
            scope: body.scope,
            scrapeMode: body.scrapeMode,
            // Checkboxes send 'on' when checked, otherwise undefined
            followRedirects: body.followRedirects === "on",
            ignoreErrors: body.ignoreErrors === "on",
            includePatterns: parsePatterns(body.includePatterns),
            excludePatterns: parsePatterns(body.excludePatterns),
            headers: parseHeaders(body["header[]"]), // <-- propagate custom headers from web UI
          },
        };

        // Execute the scrape tool
        const result = await scrapeTool.execute(scrapeOptions);

        if ("jobId" in result) {
          // Success: Collapse form back to button and show toast via HX-Trigger
          const versionDisplay = normalizedVersion || "latest";
          reply.header(
            "HX-Trigger",
            JSON.stringify({
              toast: {
                message: `Indexing started for ${body.library}@${versionDisplay}`,
                type: "success",
              },
            })
          );
          // Return the appropriate button based on the form mode
          if (body.formMode === "add-version") {
            return <AddVersionButton libraryName={body.library} />;
          }
          return <AddJobButton />;
        }

        // This case shouldn't happen with waitForCompletion: false, but handle defensively
        // Use Alert component for unexpected success
        return (
          <Alert type="warning" message="Job finished unexpectedly quickly." />
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        logger.error(`❌ Scrape job submission failed: ${error}`);

        // Use appropriate HTTP status code based on error type
        if (error instanceof ValidationError) {
          reply.status(400); // Bad Request for validation errors
        } else {
          reply.status(500); // Internal Server Error for other errors
        }

        // Return the error message directly - it's already user-friendly
        return (
          <Alert
            type="error"
            title="Error:"
            message={<span safe>{errorMessage}</span>}
          />
        );
      }
    }
  );
}
