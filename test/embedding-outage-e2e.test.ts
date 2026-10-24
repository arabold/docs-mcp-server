/**
 * End-to-end tests for indexing while the embedding service fails.
 *
 * A page whose chunks cannot be embedded stores nothing, and when the provider
 * is down or its key revoked, no other page can be stored either. A job that
 * carries on past that ends with the pages missing yet reports success, so the
 * job fails at the first such page instead.
 *
 * These tests run real scrapes against a mock site while `server.use(...)`
 * makes the OpenAI embeddings endpoint fail, and assert on the job status and
 * on how far the crawl went.
 */

import { HttpResponse, http } from "msw";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PipelineJobStatus } from "../src/pipeline/types";
import { server } from "./mock-server";
import { hubPage, leafPage, mockSite } from "./mock-site";
import { usePipelineHarness } from "./pipeline-harness";

const EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

/** Answers the embeddings endpoint the way OpenAI does once a key is revoked. */
function rejectCredentials(): Response {
  return HttpResponse.json(
    {
      error: {
        message: "Incorrect API key provided",
        type: "invalid_request_error",
        code: "invalid_api_key",
      },
    },
    { status: 401 },
  );
}

describe("Embedding service outage E2E", () => {
  const site = mockSite("http://embed-docs.example.com");
  const h = usePipelineHarness({
    library: "embed-lib",
    version: "1.0.0",
    defaults: { url: site.url("/"), maxDepth: 1 },
    embeddingModel: "openai:text-embedding-3-small",
  });

  beforeAll(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_API_BASE", undefined);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("fails a re-scrape when the embedding service is down", async () => {
    site
      .page("/", hubPage(["/alpha", "/beta"]))
      .page("/alpha", leafPage("Alpha"))
      .page("/beta", leafPage("Beta"));
    expect((await h.scrape()).status).toBe(PipelineJobStatus.COMPLETED);

    server.use(http.post(EMBEDDINGS_URL, rejectCredentials));
    const job = await h.scrape({}, { onExisting: "replace" });

    expect(job.status).toBe(PipelineJobStatus.FAILED);
    expect(job.error?.message).toContain("Failed to generate embeddings");
  });

  it("stops the scrape at the first page that cannot be embedded", async () => {
    let serviceDown = false;
    // Returning nothing passes the request on to the working default handler.
    server.use(
      http.post(EMBEDDINGS_URL, () => (serviceDown ? rejectCredentials() : undefined)),
    );
    site
      .page("/", hubPage(["/alpha", "/beta", "/gamma"]))
      .page("/alpha", leafPage("Alpha"))
      .respond("/beta", () => {
        serviceDown = true;
        return new HttpResponse(leafPage("Beta"), {
          headers: { "Content-Type": "text/html" },
        });
      })
      .page("/gamma", leafPage("Gamma"));

    const job = await h.scrape();

    expect(job.status).toBe(PipelineJobStatus.FAILED);
    expect(job.error?.message).toContain(`Failed to generate embeddings for ${site.url("/beta")}`);
    expect(site.wasRequested("/gamma")).toBe(false);
  });
});
