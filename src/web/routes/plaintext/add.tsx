import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PlaintextTool } from "../../../tools/PlaintextTool";
import { logger } from "../../../utils/logger";
import PlaintextForm from "../../components/PlaintextForm";
import Alert from "../../components/Alert";
import PlaintextFormContent from "../../components/PlaintextFormContent";

/**
 * Registers the API routes for adding plaintext content.
 * @param server - The Fastify instance.
 * @param plaintextTool - The tool instance for adding plaintext documents.
 */
export function registerPlaintextRoutes(
  server: FastifyInstance,
  plaintextTool: PlaintextTool
) {
  // GET /web/plaintext/new - Return the form component wrapped in its container
  server.get("/web/plaintext/new", async () => {
    // Return the wrapper component which includes the container div
    return <PlaintextForm />;
  });

  // POST /web/plaintext/add - Add new plaintext content
  server.post(
    "/web/plaintext/add",
    async (
      request: FastifyRequest<{
        Body: {
          library: string;
          version?: string;
          title: string;
          content: string;
          url?: string;
          description?: string;
          tags?: string;
        };
      }>,
      reply
    ) => {
      const body = request.body;
      reply.type("text/html"); // Set content type for all responses from this handler
      
      try {
        // Basic validation
        if (!body.library || !body.library.trim()) {
          reply.status(400);
          return (
            <Alert
              type="error"
              title="Validation Error:"
              message="Library Name is required."
            />
          );
        }

        if (!body.title || !body.title.trim()) {
          reply.status(400);
          return (
            <Alert
              type="error"
              title="Validation Error:"
              message="Title is required."
            />
          );
        }

        if (!body.content || !body.content.trim()) {
          reply.status(400);
          return (
            <Alert
              type="error"
              title="Validation Error:"
              message="Content is required."
            />
          );
        }

        // Parse tags from comma-separated string
        function parseTags(input?: string): string[] | undefined {
          if (!input) return undefined;
          return input
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        }

        // Prepare options for PlaintextTool
        const plaintextOptions = {
          library: body.library.trim(),
          version: body.version?.trim() || null, // Handle empty string as null
          title: body.title.trim(),
          content: body.content.trim(),
          url: body.url?.trim() || undefined, // Optional custom URL
          metadata: {
            description: body.description?.trim() || undefined,
            tags: parseTags(body.tags),
            contentType: "text/plain",
          },
        };

        // Execute the plaintext tool
        const result = await plaintextTool.execute(plaintextOptions);

        // Success: Use Alert component and OOB swap
        return (
          <>
            {/* Main target response */}
            <Alert
              type="success"
              title="Content Added Successfully!"
              message={
                <>
                  <div class="space-y-1">
                    <p>
                      <strong>{result.documentsAdded}</strong> document(s) added to{" "}
                      <strong>{body.library}</strong>
                      {body.version ? ` v${body.version}` : ""}
                    </p>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      URL: <code class="text-xs">{result.url}</code>
                    </p>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      Content is now searchable and available for queries.
                    </p>
                  </div>
                </>
              }
            />
            {/* OOB target response - contains only the inner form content to reset form */}
            <div id="plaintext-form-container" hx-swap-oob="innerHTML">
              <PlaintextFormContent />
            </div>
          </>
        );

      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        logger.error(`Plaintext content submission failed: ${error}`);
        reply.status(500); // Keep status code for errors
        
        // Use Alert component for server error
        return (
          <Alert
            type="error"
            title="Submission Failed:"
            message={<>Failed to add content: {errorMessage}</>}
          />
        );
      }
    }
  );
}